import json
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.api.routes import admin as admin_routes
from app.api.routes import billing as billing_routes
from app.core.config import Settings, get_settings
from app.main import app
from app.services.razorpay import RazorpayClient, custom_quote_amounts
from app.services.supabase_gateway import SupabaseGateway

WORKSPACE = "00000000-0000-0000-0000-000000000001"
ADMIN = {"id": "admin-1", "email": "admin@chanax.in"}
TARGET = {
    "user_id": "u1",
    "email": "owner@acme.in",
    "phone": "+919876543210",
    "full_name": "Ravi",
    "workspace_id": WORKSPACE,
    "workspace_name": "Acme",
    "subscription_code": "ABC123",
    "workspace_status": "active",
}


def test_custom_quote_adds_18_percent_gst() -> None:
    assert custom_quote_amounts(100_000) == (100_000, 18_000, 118_000)
    assert custom_quote_amounts(99_999) == (99_999, 18_000, 117_999)


@pytest.mark.asyncio
async def test_razorpay_payment_link_request_notifies_customer() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200, json={"id": "plink_1", "short_url": "https://rzp.io/i/abc"}
        )

    client = RazorpayClient(
        Settings(
            _env_file=None,
            razorpay_key_id="rzp_test",
            razorpay_key_secret="secret",
            razorpay_webhook_secret="whsec",
        ),
        transport=httpx.MockTransport(handler),
    )
    link = await client.create_payment_link(
        reference_id="ref-1",
        amount_paise=118_000,
        description="Custom quote",
        customer={"name": "Ravi", "email": "owner@acme.in", "contact": "+91987"},
        notes={"credits": "500"},
        notify=True,
    )
    assert link["short_url"] == "https://rzp.io/i/abc"
    assert seen["url"].endswith("/v1/payment_links")
    body = seen["body"]
    assert body["amount"] == 118_000 and body["currency"] == "INR"
    assert body["notify"] == {"email": True, "sms": True}
    assert body["reference_id"] == "ref-1"


@pytest.fixture
def admin_client(monkeypatch):
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
    monkeypatch.setattr(
        SupabaseGateway, "authenticated_user", AsyncMock(return_value=ADMIN)
    )
    monkeypatch.setattr(admin_routes, "_require_platform_admin", lambda *_: None)
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_create_link_records_then_calls_razorpay(admin_client, monkeypatch) -> None:
    record = AsyncMock()
    update = AsyncMock()
    create = AsyncMock(
        return_value={"id": "plink_1", "short_url": "https://rzp.io/i/abc"}
    )
    monkeypatch.setattr(
        SupabaseGateway, "admin_setup_target", AsyncMock(return_value=TARGET)
    )
    monkeypatch.setattr(SupabaseGateway, "create_payment_link_record", record)
    monkeypatch.setattr(SupabaseGateway, "update_payment_link", update)
    monkeypatch.setattr(RazorpayClient, "create_payment_link", create)
    response = admin_client.post(
        "/api/v1/admin/payment-links",
        json={
            "subscription_code": "ABC123",
            "base_amount_paise": 500_000,
            "credits": 1000,
            "duration_months": 12,
            "description": "Custom annual plan for Acme",
        },
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == status.HTTP_200_OK, response.text
    body = response.json()
    assert body["amount_paise"] == 590_000 and body["gst_amount_paise"] == 90_000
    assert body["short_url"] == "https://rzp.io/i/abc" and body["status"] == "created"
    saved = record.await_args.args[0]
    assert saved["status"] == "creating" and saved["credits"] == 1000
    assert create.await_args.kwargs["reference_id"] == saved["id"]
    assert create.await_args.kwargs["customer"]["email"] == "owner@acme.in"


def test_razorpay_failure_marks_link_failed(admin_client, monkeypatch) -> None:
    from app.services.razorpay import RazorpayRequestError

    update = AsyncMock()
    monkeypatch.setattr(
        SupabaseGateway, "admin_setup_target", AsyncMock(return_value=TARGET)
    )
    monkeypatch.setattr(SupabaseGateway, "create_payment_link_record", AsyncMock())
    monkeypatch.setattr(SupabaseGateway, "update_payment_link", update)
    monkeypatch.setattr(
        RazorpayClient,
        "create_payment_link",
        AsyncMock(side_effect=RazorpayRequestError("Invalid contact")),
    )
    response = admin_client.post(
        "/api/v1/admin/payment-links",
        json={
            "subscription_code": "ABC123",
            "base_amount_paise": 10_000,
            "credits": 10,
            "duration_months": 1,
            "description": "Small quote",
        },
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert update.await_args.args[1] == {"status": "failed"}


def test_refresh_settles_a_paid_link(admin_client, monkeypatch) -> None:
    row = {"id": "l1", "provider_link_id": "plink_1", "status": "created"}
    settled = {
        **row,
        "status": "paid",
        "workspace_id": WORKSPACE,
        "description": "Quote",
        "base_amount_paise": 100,
        "gst_amount_paise": 18,
        "amount_paise": 118,
        "credits": 5,
        "duration_months": 1,
        "created_at": "2026-11-10T00:00:00Z",
    }
    monkeypatch.setattr(
        SupabaseGateway, "payment_link_record", AsyncMock(side_effect=[row, settled])
    )
    settle = AsyncMock(return_value={"credits_added": 5})
    monkeypatch.setattr(SupabaseGateway, "settle_payment_link", settle)
    monkeypatch.setattr(
        RazorpayClient,
        "payment_link",
        AsyncMock(
            return_value={
                "status": "paid",
                "order_id": "order_1",
                "amount_paid": 118,
                "payments": [{"payment_id": "pay_1", "status": "captured"}],
            }
        ),
    )
    response = admin_client.post(
        "/api/v1/admin/payment-links/l1/refresh",
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == status.HTTP_200_OK, response.text
    assert response.json()["status"] == "paid"
    assert settle.await_args.kwargs == {
        "provider_link_id": "plink_1",
        "provider_order_id": "order_1",
        "provider_payment_id": "pay_1",
        "amount_paise": 118,
        "event_type": "payment_link.status_check",
    }


def _webhook(monkeypatch, payload: dict):
    settings = Settings(
        _env_file=None,
        razorpay_key_id="k",
        razorpay_key_secret="s",
        razorpay_webhook_secret="whsec",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    monkeypatch.setattr(billing_routes, "verify_webhook_signature", lambda *_: True)
    try:
        return TestClient(app).post(
            "/api/v1/billing/webhook",
            content=json.dumps(payload).encode(),
            headers={"X-Razorpay-Signature": "sig", "X-Razorpay-Event-Id": "evt_1"},
        )
    finally:
        app.dependency_overrides.clear()


def test_payment_link_paid_webhook_fulfils_the_link(monkeypatch) -> None:
    settle = AsyncMock(return_value={})
    monkeypatch.setattr(SupabaseGateway, "settle_payment_link", settle)
    response = _webhook(
        monkeypatch,
        {
            "event": "payment_link.paid",
            "payload": {
                "payment_link": {"entity": {"id": "plink_1", "order_id": "order_1"}},
                "payment": {
                    "entity": {"id": "pay_1", "order_id": "order_1", "amount": 118}
                },
                "order": {"entity": {"id": "order_1"}},
            },
        },
    )
    assert response.status_code == status.HTTP_200_OK
    assert settle.await_args.kwargs["provider_link_id"] == "plink_1"
    assert settle.await_args.kwargs["provider_payment_id"] == "pay_1"
    assert settle.await_args.kwargs["event_id"] == "evt_1"


def test_unknown_order_payment_is_acknowledged(monkeypatch) -> None:
    from app.services.supabase_gateway import SupabaseGatewayError

    monkeypatch.setattr(
        SupabaseGateway,
        "payment_order",
        AsyncMock(side_effect=SupabaseGatewayError("not found")),
    )
    apply = AsyncMock()
    monkeypatch.setattr(SupabaseGateway, "apply_razorpay_payment", apply)
    response = _webhook(
        monkeypatch,
        {
            "event": "payment.captured",
            "payload": {"payment": {"entity": {"id": "pay_1", "order_id": "order_x"}}},
        },
    )
    assert response.status_code == status.HTTP_200_OK
    apply.assert_not_awaited()


def test_admin_report_adds_workspace_overview(monkeypatch) -> None:
    import asyncio

    gateway = SupabaseGateway(Settings(_env_file=None))
    calls: list[str] = []

    async def rpc(name: str, payload: dict):
        calls.append(name)
        if name == "breezy_admin_usage_report":
            return {"scope": {"type": "workspace", "workspace_id": WORKSPACE}}
        return [{"workspace_id": WORKSPACE, "invoices": {"total": 3}}]

    gateway.service_rpc = rpc  # type: ignore[method-assign]
    report = asyncio.run(gateway.admin_usage_report(since_days=7, identifier="ABC123"))
    assert report["workspace_overviews"][0]["invoices"]["total"] == 3
    assert calls == ["breezy_admin_usage_report", "breezy_admin_workspace_overview"]
