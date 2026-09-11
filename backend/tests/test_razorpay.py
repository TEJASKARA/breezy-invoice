import asyncio
import hashlib
import hmac

import httpx

from app.core.config import Settings
from app.services.razorpay import (
    RazorpayClient,
    billing_plan,
    verify_checkout_signature,
    verify_webhook_signature,
)


def test_billing_plan_prices_are_server_controlled() -> None:
    assert billing_plan("monthly").base_amount_paise == 10_000
    assert billing_plan("monthly").gst_amount_paise == 1_800
    assert billing_plan("monthly").amount_paise == 11_800
    assert billing_plan("monthly").credits == 200
    assert billing_plan("quarterly").amount_paise == 35_400
    assert billing_plan("quarterly").credits == 625
    assert billing_plan("annual").amount_paise == 141_600
    assert billing_plan("annual").credits == 2_600


def test_custom_plan_adds_twenty_percent_at_sixty_paise_rate() -> None:
    plan = billing_plan("custom_monthly", monthly_invoices=100, employees=100)

    assert plan.credits == 240
    assert plan.base_amount_paise == 12_000
    assert plan.gst_amount_paise == 2_160
    assert plan.amount_paise == 14_160
    assert plan.duration_months == 1


def test_custom_plan_uses_period_specific_credit_bonuses() -> None:
    quarterly = billing_plan(
        "custom_quarterly", monthly_invoices=100, employees=100
    )
    annual = billing_plan("custom_annual", monthly_invoices=100, employees=100)

    assert quarterly.credits == 750
    assert quarterly.amount_paise == 42_480
    assert annual.credits == 3_120
    assert annual.amount_paise == 169_920


def test_custom_plan_uses_sixty_paise_rate_above_minimum() -> None:
    plan = billing_plan("custom_monthly", monthly_invoices=300, employees=0)

    assert plan.credits == 360
    assert plan.amount_paise == 21_240


def test_custom_plan_keeps_one_hundred_rupee_monthly_minimum() -> None:
    plan = billing_plan("custom_monthly", monthly_invoices=100, employees=0)

    assert plan.credits == 120
    assert plan.amount_paise == 11_800


def test_verifies_checkout_and_webhook_signatures() -> None:
    secret = "test-secret"
    order_id = "order_test"
    payment_id = "pay_test"
    checkout_signature = hmac.new(
        secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256
    ).hexdigest()
    body = b'{"event":"payment.captured"}'
    webhook_signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    assert verify_checkout_signature(order_id, payment_id, checkout_signature, secret)
    assert not verify_checkout_signature(order_id, payment_id, "invalid", secret)
    assert verify_webhook_signature(body, webhook_signature, secret)


def test_creates_razorpay_order_with_backend_amount() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/orders"
        assert request.headers["authorization"].startswith("Basic ")
        body = request.read().decode()
        assert '"amount":35400' in body
        assert '"base_amount_paise":"30000"' in body
        assert '"gst_amount_paise":"5400"' in body
        return httpx.Response(200, json={"id": "order_created", "status": "created"})

    settings = Settings(
        _env_file=None,
        razorpay_key_id="rzp_test_key",
        razorpay_key_secret="key-secret",
        razorpay_webhook_secret="webhook-secret",
    )
    client = RazorpayClient(settings, transport=httpx.MockTransport(handler))

    result = asyncio.run(
        client.create_order(billing_plan("quarterly"), "cx_receipt", "workspace-id")
    )

    assert result["id"] == "order_created"
