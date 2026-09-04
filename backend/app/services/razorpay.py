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
    amount_paise: int
    credits: int
    duration_months: int


BILLING_PLANS = {
    "quarterly": BillingPlan("quarterly", "Quarterly", 150_000, 300, 3),
    "half_yearly": BillingPlan("half_yearly", "Half-yearly", 300_000, 900, 6),
    "annual": BillingPlan("annual", "Annual", 450_000, 1500, 12),
}


def billing_plan(plan_key: str) -> BillingPlan:
    try:
        return BILLING_PLANS[plan_key]
    except KeyError as exc:
        raise RazorpayRequestError(
            "The selected ChanaX plan is not available."
        ) from exc


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
