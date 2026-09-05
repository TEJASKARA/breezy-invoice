import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.api.routes.gst import _bearer_token
from app.core.config import Settings, get_settings
from app.schemas.billing import (
    BillingOrderRequest,
    BillingOrderResponse,
    BillingStatusResponse,
    BillingVerificationRequest,
    BillingVerificationResponse,
)
from app.services.razorpay import (
    RazorpayClient,
    RazorpayConfigurationError,
    RazorpayRequestError,
    billing_plan,
    verify_checkout_signature,
    verify_webhook_signature,
)
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError

router = APIRouter()


def _payment_entity(payload: dict[str, Any]) -> dict[str, Any]:
    entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
    return entity if isinstance(entity, dict) else {}


def _order_entity(payload: dict[str, Any]) -> dict[str, Any]:
    entity = payload.get("payload", {}).get("order", {}).get("entity", {})
    return entity if isinstance(entity, dict) else {}


def _refund_entity(payload: dict[str, Any]) -> dict[str, Any]:
    entity = payload.get("payload", {}).get("refund", {}).get("entity", {})
    return entity if isinstance(entity, dict) else {}


@router.post("/orders", response_model=BillingOrderResponse)
async def create_billing_order(
    order_request: BillingOrderRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BillingOrderResponse:
    access_token = _bearer_token(authorization)
    gateway = SupabaseGateway(settings)
    razorpay = RazorpayClient(settings)
    plan = billing_plan(order_request.plan_key)
    try:
        user = await gateway.authenticated_user(access_token)
        await gateway.assert_workspace_owner(
            order_request.workspace_id, str(user["id"])
        )
        receipt = f"cx_{uuid.uuid4().hex[:28]}"
        provider_order = await razorpay.create_order(
            plan, receipt, order_request.workspace_id
        )
        await gateway.create_payment_order(
            workspace_id=order_request.workspace_id,
            user_id=str(user["id"]),
            provider_order_id=str(provider_order["id"]),
            plan_key=plan.key,
            amount_paise=plan.amount_paise,
            credits=plan.credits,
            duration_months=plan.duration_months,
        )
    except (
        SupabaseGatewayError,
        RazorpayConfigurationError,
        RazorpayRequestError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    return BillingOrderResponse(
        order_id=str(provider_order["id"]),
        key_id=settings.razorpay_key_id,
        amount=plan.amount_paise,
        plan_key=plan.key,  # type: ignore[arg-type]
        plan_name=plan.name,
        credits=plan.credits,
        quotation_credits=plan.credits,
        duration_months=plan.duration_months,
    )


@router.post("/verify", response_model=BillingVerificationResponse)
async def verify_billing_payment(
    verification: BillingVerificationRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BillingVerificationResponse:
    access_token = _bearer_token(authorization)
    gateway = SupabaseGateway(settings)
    razorpay = RazorpayClient(settings)
    try:
        user = await gateway.authenticated_user(access_token)
        await gateway.assert_workspace_owner(verification.workspace_id, str(user["id"]))
        payment_order = await gateway.payment_order(verification.razorpay_order_id)
        if payment_order.get("workspace_id") != verification.workspace_id:
            raise SupabaseGatewayError(
                "This payment does not belong to your workspace."
            )
        if not verify_checkout_signature(
            verification.razorpay_order_id,
            verification.razorpay_payment_id,
            verification.razorpay_signature,
            settings.razorpay_key_secret,
        ):
            raise RazorpayRequestError("The Razorpay payment signature is invalid.")
        provider_payment = await razorpay.captured_payment(
            verification.razorpay_payment_id
        )
        if (
            provider_payment.get("order_id") != verification.razorpay_order_id
            or int(provider_payment.get("amount") or 0)
            != int(payment_order["amount_paise"])
            or provider_payment.get("currency") != payment_order["currency"]
        ):
            raise RazorpayRequestError(
                "The Razorpay payment details do not match this order."
            )
        applied = await gateway.apply_razorpay_payment(
            provider_order_id=verification.razorpay_order_id,
            provider_payment_id=verification.razorpay_payment_id,
        )
    except (
        SupabaseGatewayError,
        RazorpayConfigurationError,
        RazorpayRequestError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    return BillingVerificationResponse(
        already_processed=bool(applied.get("already_processed")),
        plan_key=str(applied.get("plan_key") or payment_order["plan_key"]),
        credits_added=int(applied.get("credits_added") or 0),
        quotation_credits_added=int(
            applied.get("quotation_credits_added") or 0
        ),
        current_period_ends_at=(
            str(applied["current_period_ends_at"])
            if applied.get("current_period_ends_at")
            else None
        ),
    )


@router.get("/status", response_model=BillingStatusResponse)
async def billing_status(
    workspace_id: str,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BillingStatusResponse:
    access_token = _bearer_token(authorization)
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(access_token)
        await gateway.assert_workspace_owner(workspace_id, str(user["id"]))
        payments = await gateway.payment_history(workspace_id)
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return BillingStatusResponse(payments=payments)


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def razorpay_webhook(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    x_razorpay_signature: Annotated[str | None, Header()] = None,
    x_razorpay_event_id: Annotated[str | None, Header()] = None,
) -> dict[str, bool]:
    body = await request.body()
    if not settings.razorpay_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Razorpay webhook verification is not configured.",
        )
    if not x_razorpay_signature or not verify_webhook_signature(
        body, x_razorpay_signature, settings.razorpay_webhook_secret
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Razorpay webhook signature.",
        )
    try:
        payload = json.loads(body)
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Razorpay webhook payload.",
        ) from exc
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Razorpay webhook payload.",
        )

    event_type = str(payload.get("event") or "")
    payment = _payment_entity(payload)
    order = _order_entity(payload)
    refund = _refund_entity(payload)
    provider_order_id = str(payment.get("order_id") or order.get("id") or "")
    provider_payment_id = str(payment.get("id") or refund.get("payment_id") or "")
    event_id = x_razorpay_event_id or str(payload.get("id") or "")

    if event_type not in {
        "payment.captured",
        "order.paid",
        "payment.failed",
        "refund.processed",
    }:
        return {"accepted": True}
    if not event_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Razorpay event ID is missing.",
        )
    gateway = SupabaseGateway(settings)
    try:
        if (
            not provider_order_id
            and event_type == "refund.processed"
            and provider_payment_id
        ):
            refunded_order = await gateway.payment_order_by_payment_id(
                provider_payment_id
            )
            provider_order_id = str(refunded_order.get("provider_order_id") or "")
        if not provider_order_id:
            return {"accepted": True}
        if event_type in {"payment.captured", "order.paid"}:
            if not provider_payment_id:
                return {"accepted": True}
            payment_order = await gateway.payment_order(provider_order_id)
            if (
                int(payment.get("amount") or 0) != int(payment_order["amount_paise"])
                or payment.get("currency") != payment_order["currency"]
            ):
                raise RazorpayRequestError(
                    "Webhook payment details do not match the order."
                )
            await gateway.apply_razorpay_payment(
                provider_order_id=provider_order_id,
                provider_payment_id=provider_payment_id,
                event_id=event_id,
                event_type=event_type,
            )
        else:
            await gateway.record_razorpay_event(
                provider_order_id=provider_order_id,
                provider_payment_id=provider_payment_id,
                event_id=event_id,
                event_type=event_type,
                amount_paise=int(refund.get("amount") or 0),
            )
    except (
        SupabaseGatewayError,
        RazorpayConfigurationError,
        RazorpayRequestError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return {"accepted": True}
