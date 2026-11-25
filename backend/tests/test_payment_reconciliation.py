from datetime import UTC, datetime
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.routes import maintenance
from app.core.config import Settings
from app.main import app
from app.services.payment_reconciliation import reconcile_payments
from app.services.razorpay import RazorpayClient, RazorpayRequestError
from app.services.supabase_gateway import SupabaseGateway

NOW = datetime(2026, 11, 24, 12, 0, tzinfo=UTC)


def order(order_id="order_1", amount=19900, paid_id=None, refunded=0):
    return {
        "provider_order_id": order_id,
        "provider_payment_id": paid_id,
        "amount_paise": amount,
        "currency": "INR",
        "refunded_paise": refunded,
        "workspace_id": "w",
    }


def captured(payment_id="pay_1", amount=19900, refunded=0):
    return {
        "id": payment_id,
        "status": "captured",
        "amount": amount,
        "currency": "INR",
        "amount_refunded": refunded,
    }


def setup(open_orders=(), paid_orders=(), payments=None, apply=None):
    gateway = SupabaseGateway(Settings(_env_file=None))

    async def between(**kwargs):
        return list(open_orders if kwargs["status"] == "created" else paid_orders)

    gateway.payment_orders_between = between
    gateway.apply_razorpay_payment = apply or AsyncMock(
        return_value={"already_processed": False}
    )
    razorpay = RazorpayClient(Settings(_env_file=None))
    found = payments or {}
    razorpay.order_payments = AsyncMock(side_effect=lambda oid: found.get(oid, []))
    razorpay.payment = AsyncMock(side_effect=lambda pid: found.get(pid, captured(pid)))
    return gateway, razorpay


@pytest.mark.asyncio
async def test_a_paid_order_stuck_as_created_is_recovered() -> None:
    gateway, razorpay = setup(open_orders=[order()], payments={"order_1": [captured()]})

    report = await reconcile_payments(gateway, razorpay, NOW)

    gateway.apply_razorpay_payment.assert_awaited_once_with(
        provider_order_id="order_1", provider_payment_id="pay_1"
    )
    assert report["recovered"] == [{"order_id": "order_1", "payment_id": "pay_1"}]


@pytest.mark.asyncio
async def test_unpaid_or_failed_orders_are_left_alone() -> None:
    failed = {"id": "pay_x", "status": "failed", "amount": 19900, "currency": "INR"}
    gateway, razorpay = setup(
        open_orders=[order("o1"), order("o2")], payments={"o2": [failed]}
    )

    report = await reconcile_payments(gateway, razorpay, NOW)

    assert gateway.apply_razorpay_payment.await_count == 0
    assert report["recovered"] == [] and report["checked_open_orders"] == 2


@pytest.mark.asyncio
async def test_amount_mismatch_is_reported_never_applied() -> None:
    gateway, razorpay = setup(
        open_orders=[order()], payments={"order_1": [captured(amount=100)]}
    )

    report = await reconcile_payments(gateway, razorpay, NOW)

    assert gateway.apply_razorpay_payment.await_count == 0
    assert report["amount_mismatches"] == [
        {"order_id": "order_1", "payment_id": "pay_1"}
    ]


@pytest.mark.asyncio
async def test_already_processed_payments_are_not_counted_as_recovered() -> None:
    gateway, razorpay = setup(
        open_orders=[order()],
        payments={"order_1": [captured()]},
        apply=AsyncMock(return_value={"already_processed": True}),
    )

    report = await reconcile_payments(gateway, razorpay, NOW)

    assert report["recovered"] == []


@pytest.mark.asyncio
async def test_refund_totals_that_disagree_are_reported() -> None:
    gateway, razorpay = setup(
        paid_orders=[
            order("o1", paid_id="p1", refunded=0),
            order("o2", paid_id="p2", refunded=5000),
        ],
        payments={
            "p1": captured("p1", refunded=19900),
            "p2": captured("p2", refunded=5000),
        },
    )

    report = await reconcile_payments(gateway, razorpay, NOW)

    assert report["checked_paid_orders"] == 2
    assert report["refund_mismatches"] == [
        {"order_id": "o1", "razorpay_refunded_paise": 19900, "chanax_refunded_paise": 0}
    ]


@pytest.mark.asyncio
async def test_one_failing_order_does_not_stop_the_rest() -> None:
    gateway, razorpay = setup(
        open_orders=[order("bad"), order("good")],
        payments={"good": [captured("pay_g")]},
    )
    good_answers = razorpay.order_payments.side_effect

    async def flaky(order_id):
        if order_id == "bad":
            raise RazorpayRequestError("Razorpay is down")
        return good_answers(order_id)

    razorpay.order_payments = AsyncMock(side_effect=flaky)

    report = await reconcile_payments(gateway, razorpay, NOW)

    assert report["errors"] == [{"order_id": "bad", "error": "Razorpay is down"}]
    assert [r["order_id"] for r in report["recovered"]] == ["good"]


@pytest.mark.asyncio
async def test_running_twice_credits_once() -> None:
    gateway, razorpay = setup(
        open_orders=[order()],
        payments={"order_1": [captured()]},
        apply=AsyncMock(
            side_effect=[{"already_processed": False}, {"already_processed": True}]
        ),
    )

    first = await reconcile_payments(gateway, razorpay, NOW)
    second = await reconcile_payments(gateway, razorpay, NOW)

    assert len(first["recovered"]) == 1 and second["recovered"] == []


@pytest.mark.asyncio
async def test_order_query_only_looks_at_a_settled_recent_window() -> None:
    gateway = SupabaseGateway(Settings(_env_file=None))
    gateway._get = AsyncMock(return_value=[])

    await gateway.payment_orders_between(
        status="created",
        created_after=datetime(2026, 11, 17, tzinfo=UTC),
        created_before=datetime(2026, 11, 24, tzinfo=UTC),
        limit=5,
    )

    params = gateway._get.await_args.args[1]
    assert params["status"] == "eq.created"
    assert "created_at.gt.2026-11-17" in params["and"]
    assert "created_at.lt.2026-11-24" in params["and"]


@pytest.mark.asyncio
async def test_razorpay_order_payments_reads_the_collection() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/orders/order_9/payments"
        return httpx.Response(
            200, json={"entity": "collection", "items": [captured("p9")]}
        )

    client = RazorpayClient(
        Settings(
            _env_file=None,
            razorpay_key_id="k",
            razorpay_key_secret="s",
            razorpay_webhook_secret="w",
        ),
        transport=httpx.MockTransport(handler),
    )

    assert [p["id"] for p in await client.order_payments("order_9")] == ["p9"]


def test_endpoint_needs_the_maintenance_secret(monkeypatch) -> None:
    monkeypatch.setattr(
        maintenance,
        "settings",
        Settings(_env_file=None, account_deletion_cron_secret="s3cret"),
    )
    run = AsyncMock(return_value={"recovered": []})
    monkeypatch.setattr(maintenance, "reconcile_payments", run)
    client = TestClient(app)
    path = "/api/v1/maintenance/reconcile-payments"

    assert client.post(path).status_code == 401
    assert client.post(path, headers={"X-ChanaX-Cron-Secret": "no"}).status_code == 401
    ok = client.post(path, headers={"X-ChanaX-Cron-Secret": "s3cret"})
    assert ok.status_code == 200 and ok.json() == {"recovered": []}
    assert run.await_count == 1
