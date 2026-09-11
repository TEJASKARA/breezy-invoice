import hashlib
import hmac
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import Settings


class RazorpayConfigurationError(RuntimeError):
    pass


class RazorpayRequestError(RuntimeError):
    pass


@dataclass(frozen=True)
class BillingPlan:
    key: str
    name: str
    base_amount_paise: int
    gst_amount_paise: int
    amount_paise: int
    credits: int
    duration_months: int


GST_RATE_PERCENT = 18


def _plan_with_gst(
    key: str,
    name: str,
    base_amount_paise: int,
    credits: int,
    duration_months: int,
) -> BillingPlan:
    gst_amount_paise = (base_amount_paise * GST_RATE_PERCENT + 50) // 100
    return BillingPlan(
        key=key,
        name=name,
        base_amount_paise=base_amount_paise,
        gst_amount_paise=gst_amount_paise,
        amount_paise=base_amount_paise + gst_amount_paise,
        credits=credits,
        duration_months=duration_months,
    )


BILLING_PLANS = {
    "monthly": _plan_with_gst("monthly", "Monthly", 10_000, 200, 1),
    "quarterly": _plan_with_gst("quarterly", "Quarterly", 30_000, 625, 3),
    "annual": _plan_with_gst("annual", "Annual", 120_000, 2_600, 12),
}

CUSTOM_PLAN_OPTIONS = {
    "custom_monthly": ("Custom monthly", 1, 20),
    "custom_quarterly": ("Custom quarterly", 3, 25),
    "custom_annual": ("Custom annual", 12, 30),
}


def billing_plan(
    plan_key: str,
    monthly_invoices: int | None = None,
    employees: int | None = None,
) -> BillingPlan:
    if plan_key in BILLING_PLANS:
        return BILLING_PLANS[plan_key]
    if plan_key not in CUSTOM_PLAN_OPTIONS:
        raise RazorpayRequestError("The selected ChanaX plan is not available.")
    if monthly_invoices is None or employees is None:
        raise RazorpayRequestError(
            "Enter monthly invoices and employees for the custom plan."
        )
    if monthly_invoices < 0 or employees < 0:
        raise RazorpayRequestError("Custom-plan usage cannot be negative.")
    expected_documents = monthly_invoices + employees
    if expected_documents < 1:
        raise RazorpayRequestError(
            "Enter at least one monthly invoice or employee."
        )
    if expected_documents > 1_000_000:
        raise RazorpayRequestError(
            "Contact ChanaX for custom usage above one million documents per month."
        )

    name, duration_months, bonus_percent = CUSTOM_PLAN_OPTIONS[plan_key]
    period_documents = expected_documents * duration_months
    credits = (
        period_documents * (100 + bonus_percent) + 99
    ) // 100
    monthly_amount_paise = max(10_000, expected_documents * 60)
    return _plan_with_gst(
        plan_key,
        name,
        monthly_amount_paise * duration_months,
        credits,
        duration_months,
    )


def verify_checkout_signature(
    order_id: str, payment_id: str, signature: str, secret: str
) -> bool:
    expected = hmac.new(
        secret.encode("utf-8"),
        f"{order_id}|{payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def verify_webhook_signature(body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


class RazorpayClient:
    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.settings = settings
        self.transport = transport

    def _configured(self) -> None:
        if not self.settings.razorpay_is_configured:
            raise RazorpayConfigurationError(
                "Razorpay is not configured on the ChanaX backend."
            )

    async def create_order(
        self, plan: BillingPlan, receipt: str, workspace_id: str
    ) -> dict[str, Any]:
        self._configured()
        async with httpx.AsyncClient(
            timeout=20,
            transport=self.transport,
            auth=(self.settings.razorpay_key_id, self.settings.razorpay_key_secret),
        ) as client:
            response = await client.post(
                "https://api.razorpay.com/v1/orders",
                json={
                    "amount": plan.amount_paise,
                    "currency": "INR",
                    "receipt": receipt,
                    "notes": {
                        "workspace_id": workspace_id,
                        "plan_key": plan.key,
                        "credits": str(plan.credits),
                        "duration_months": str(plan.duration_months),
                        "base_amount_paise": str(plan.base_amount_paise),
                        "gst_rate_percent": str(GST_RATE_PERCENT),
                        "gst_amount_paise": str(plan.gst_amount_paise),
                    },
                },
            )
        if response.is_error:
            raise RazorpayRequestError(self._safe_error(response))
        payload = response.json()
        if not payload.get("id"):
            raise RazorpayRequestError("Razorpay did not return an order ID.")
        return payload

    async def captured_payment(self, payment_id: str) -> dict[str, Any]:
        payload = await self.payment(payment_id)
        if payload.get("status") != "captured":
            raise RazorpayRequestError(
                "The payment has not been captured yet. Please wait and refresh."
            )
        return payload

    async def payment(self, payment_id: str) -> dict[str, Any]:
        self._configured()
        async with httpx.AsyncClient(
            timeout=20,
            transport=self.transport,
            auth=(self.settings.razorpay_key_id, self.settings.razorpay_key_secret),
        ) as client:
            response = await client.get(
                f"https://api.razorpay.com/v1/payments/{payment_id}"
            )
        if response.is_error:
            raise RazorpayRequestError(self._safe_error(response))
        return response.json()

    @staticmethod
    def _safe_error(response: httpx.Response) -> str:
        try:
            payload = response.json()
            error = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(error, dict) and error.get("description"):
                return str(error["description"])
        except ValueError:
            pass
        return f"Razorpay could not complete the request ({response.status_code})."
