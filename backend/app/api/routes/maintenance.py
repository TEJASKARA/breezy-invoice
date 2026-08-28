from hmac import compare_digest

from fastapi import APIRouter, Header, HTTPException, status

from app.core.config import get_settings
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

    return {"purged": len(purged), "workspace_ids": purged, "failures": failures}
