"""Compare Razorpay with ChanaX's payment records and repair what a missed webhook left.

Run hourly. It never trusts a payment on its own say-so: every payment is fetched from
Razorpay with the server's own keys, and the amount and currency must match the order
ChanaX created. Applying a payment goes through the same idempotent function the
checkout verification and the webhook use, so running twice cannot double-credit.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from app.services.razorpay import RazorpayClient, RazorpayRequestError
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError

logger = logging.getLogger(__name__)

# Give checkout and the webhook time to finish before treating an order as stuck.
SETTLE_MINUTES = 15
LOOKBACK_DAYS = 7
MAX_PER_RUN = 100


async def reconcile_payments(
    gateway: SupabaseGateway,
    razorpay: RazorpayClient,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    since = now - timedelta(days=LOOKBACK_DAYS)
    settled_before = now - timedelta(minutes=SETTLE_MINUTES)
    report: dict[str, Any] = {
        "checked_open_orders": 0,
        "recovered": [],
        "amount_mismatches": [],
        "checked_paid_orders": 0,
        "refund_mismatches": [],
        "errors": [],
    }

    # 1. Orders still "created" although the customer may have paid.
    open_orders = await gateway.payment_orders_between(
        status="created",
        created_after=since,
        created_before=settled_before,
        limit=MAX_PER_RUN,
    )
    for order in open_orders:
        order_id = str(order["provider_order_id"])
        report["checked_open_orders"] += 1
        try:
            payments = await razorpay.order_payments(order_id)
            captured = [p for p in payments if p.get("status") == "captured"]
            if not captured:
                continue
            payment = captured[0]
            if (
                int(payment.get("amount") or 0) != int(order["amount_paise"])
                or payment.get("currency") != order["currency"]
            ):
                report["amount_mismatches"].append(
                    {"order_id": order_id, "payment_id": payment.get("id")}
                )
                logger.error(
                    "Payment %s does not match order %s", payment.get("id"), order_id
                )
                continue
            applied = await gateway.apply_razorpay_payment(
                provider_order_id=order_id,
                provider_payment_id=str(payment["id"]),
            )
            if not applied.get("already_processed"):
                report["recovered"].append(
                    {"order_id": order_id, "payment_id": payment["id"]}
                )
                logger.warning(
                    "Reconciliation recovered missed payment for %s", order_id
                )
        except (SupabaseGatewayError, RazorpayRequestError) as exc:
            report["errors"].append({"order_id": order_id, "error": str(exc)})

    # 2. Paid orders: has Razorpay refunded more than ChanaX has recorded?
    paid_orders = await gateway.payment_orders_between(
        status="paid", created_after=since, created_before=now, limit=MAX_PER_RUN
    )
    for order in paid_orders:
        payment_id = str(order.get("provider_payment_id") or "")
        if not payment_id:
            continue
        report["checked_paid_orders"] += 1
        try:
            payment = await razorpay.payment(payment_id)
        except RazorpayRequestError as exc:
            report["errors"].append(
                {"order_id": order["provider_order_id"], "error": str(exc)}
            )
            continue
        refunded = int(payment.get("amount_refunded") or 0)
        if refunded != int(order.get("refunded_paise") or 0):
            report["refund_mismatches"].append(
                {
                    "order_id": order["provider_order_id"],
                    "razorpay_refunded_paise": refunded,
                    "chanax_refunded_paise": int(order.get("refunded_paise") or 0),
                }
            )
            logger.error("Refund mismatch on %s", order["provider_order_id"])
    return report
