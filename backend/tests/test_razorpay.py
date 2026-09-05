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
    assert billing_plan("quarterly").amount_paise == 150_000
    assert billing_plan("half_yearly").credits == 900
    assert billing_plan("annual").duration_months == 12


def test_custom_plan_adds_twenty_percent_and_applies_monthly_minimum() -> None:
    plan = billing_plan("custom_monthly", monthly_invoices=100, employees=100)

    assert plan.credits == 240
    assert plan.amount_paise == 10_000
    assert plan.duration_months == 1


def test_custom_plan_multiplies_credits_and_price_by_duration() -> None:
    quarterly = billing_plan(
        "custom_quarterly", monthly_invoices=100, employees=100
    )
    annual = billing_plan("custom_annual", monthly_invoices=100, employees=100)

    assert quarterly.credits == 720
    assert quarterly.amount_paise == 30_000
    assert annual.credits == 2_880
    assert annual.amount_paise == 120_000


def test_custom_plan_uses_forty_paise_rate_above_minimum() -> None:
    plan = billing_plan("custom_monthly", monthly_invoices=300, employees=0)

    assert plan.credits == 360
    assert plan.amount_paise == 12_000


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
        assert '"amount":150000' in body
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
