from hmac import compare_digest

from fastapi import APIRouter, Header, HTTPException, status

from app.core.config import get_settings
from app.services.payment_reconciliation import reconcile_payments
from app.services.razorpay import RazorpayClient, RazorpayConfigurationError
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError

router = APIRouter()
settings = get_settings()
gateway = SupabaseGateway(settings)


@router.post("/purge-deletions")
async def purge_due_account_deletions(
    x_chanax_cron_secret: str = Header(default=""),
) -> dict[str, object]:
    expected = settings.account_deletion_cron_secret
    if not expected or not compare_digest(x_chanax_cron_secret, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid maintenance credentials.",
        )

    purged: list[str] = []
    failures: list[dict[str, str]] = []
    entity_files_cleaned = 0
    try:
        entity_files_cleaned = await gateway.cleanup_deleted_entity_files()
    except SupabaseGatewayError:
        failures.append({"scope": "entity_files", "error": "File cleanup will retry."})
    try:
        due = await gateway.due_account_deletions()
    except SupabaseGatewayError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
        ) from error

    for request in due:
        workspace_id = str(request.get("workspace_id") or "")
        owner_user_id = str(request.get("requested_by") or "")
        if not workspace_id or not owner_user_id:
            continue
        try:
            await gateway.permanently_delete_workspace(workspace_id, owner_user_id)
            purged.append(workspace_id)
        except SupabaseGatewayError as error:
            failures.append({"workspace_id": workspace_id, "error": str(error)})

    return {
        "purged": len(purged), "workspace_ids": purged, "failures": failures,
        "entity_files_cleaned": entity_files_cleaned,
    }


@router.post("/reconcile-payments")
async def reconcile_razorpay_payments(
    x_chanax_cron_secret: str = Header(default=""),
) -> dict[str, object]:
    """Hourly: compare Razorpay with our payment records and repair missed webhooks."""
    expected = settings.account_deletion_cron_secret
    if not expected or not compare_digest(x_chanax_cron_secret, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid maintenance credentials.",
        )
    try:
        return await reconcile_payments(gateway, RazorpayClient(settings))
    except RazorpayConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error
    except SupabaseGatewayError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
        ) from error
