from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.routes.gst import _bearer_token
from app.core.config import Settings, get_settings
from app.schemas.admin import (
    PlatformAdminAccessResponse,
    PlatformWorkspaceResponse,
    SpecialCreditGrantRequest,
    SpecialCreditGrantResponse,
)
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError

router = APIRouter()


def _is_platform_admin_user(user: dict[str, Any], settings: Settings) -> bool:
    return settings.is_platform_admin(str(user.get("id") or ""))


def _require_platform_admin(user: dict[str, Any], settings: Settings) -> None:
    if not _is_platform_admin_user(user, settings):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account does not have ChanaX platform-administrator access.",
        )


@router.get("/me", response_model=PlatformAdminAccessResponse)
async def platform_admin_access(
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlatformAdminAccessResponse:
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc
    return PlatformAdminAccessResponse(
        is_super_admin=_is_platform_admin_user(user, settings)
    )


@router.get(
    "/workspaces/{subscription_code}", response_model=PlatformWorkspaceResponse
)
async def platform_workspace(
    subscription_code: str,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlatformWorkspaceResponse:
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        workspace = await gateway.admin_workspace_by_subscription_code(
            subscription_code
        )
    except SupabaseGatewayError as exc:
        code = (
            status.HTTP_404_NOT_FOUND
            if "No workspace matches" in str(exc)
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    return PlatformWorkspaceResponse(**workspace)


@router.post("/credit-grants", response_model=SpecialCreditGrantResponse)
async def grant_special_credits(
    grant: SpecialCreditGrantRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SpecialCreditGrantResponse:
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        result = await gateway.grant_special_credits(
            subscription_code=grant.subscription_code,
            credit_amount=grant.credit_amount,
            reason=grant.reason,
            actor_user_id=str(user["id"]),
        )
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return SpecialCreditGrantResponse(**result)
