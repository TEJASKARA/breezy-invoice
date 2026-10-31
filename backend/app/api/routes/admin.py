import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

from app.api.routes.gst import (
    GSTIN_PATTERN,
    _address,
    _bearer_token,
    lookup_active_taxpayer,
)
from app.core.config import Settings, get_settings
from app.schemas.admin import (
    AdminCompleteSetupRequest,
    AdminCompleteSetupResponse,
    AdminSetupTargetResponse,
    PlatformAdminAccessResponse,
    PlatformUsageReportResponse,
    PlatformWorkspaceResponse,
    PlatformWorkspaceSearchResponse,
    PurgeApproval,
    PurgeRequestCreate,
    SpecialCreditGrantRequest,
    SpecialCreditGrantResponse,
)
from app.schemas.gst import GstVerificationResponse
from app.services.email_sender import (
    EmailConfigurationError,
    EmailDeliveryError,
    send_account_ready_email,
    send_purge_approval_code_email,
)
from app.services.supabase_gateway import (
    GstVerificationUnavailable,
    SupabaseGateway,
    SupabaseGatewayError,
)
from app.services.whitebooks import WhiteBooksConfigurationError, WhiteBooksRequestError

router = APIRouter()
logger = logging.getLogger(__name__)


def _is_platform_admin_user(user: dict[str, Any], settings: Settings) -> bool:
    return settings.is_platform_admin(str(user.get("id") or "")) or (
        settings.is_platform_admin_email(str(user.get("email") or ""))
    )


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


@router.get("/workspaces", response_model=PlatformWorkspaceSearchResponse)
async def search_platform_workspaces(
    query: Annotated[str, Query(min_length=3, max_length=320)],
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlatformWorkspaceSearchResponse:
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        workspaces = await gateway.admin_workspaces_by_identifier(query)
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return PlatformWorkspaceSearchResponse(
        workspaces=[PlatformWorkspaceResponse(**item) for item in workspaces]
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


@router.get("/usage", response_model=PlatformUsageReportResponse)
async def platform_usage_report(
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
    days: Annotated[int, Query(ge=1, le=365)] = 30,
    query: Annotated[str | None, Query(max_length=320)] = None,
) -> PlatformUsageReportResponse:
    """Developer-only usage analytics for the platform, a workspace or a user."""
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        report = await gateway.admin_usage_report(
            since_days=days,
            identifier=query,
            excluded_user_ids=list(settings.platform_admin_ids),
        )
    except SupabaseGatewayError as exc:
        message = str(exc)
        code = (
            status.HTTP_404_NOT_FOUND
            if message.startswith("No user matches")
            or message.startswith("No workspace matches")
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=code, detail=message) from exc
    return PlatformUsageReportResponse(**report)

@router.post("/data-lifecycle/purge-requests")
async def create_purge_request(
    request: PurgeRequestCreate,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        workspace = await gateway.admin_workspace_by_subscription_code(
            request.subscription_code
        )
        if workspace.get("status") != "suspended":
            raise SupabaseGatewayError(
                "Only a suspended workspace in its recovery period can be permanently "
                "purged."
            )

        request_id = str(uuid.uuid4())
        code = f"{secrets.randbelow(1_000_000):06d}"
        owner_user_id = await gateway.deletion_request_owner(
            str(workspace["workspace_id"])
        )
        await gateway.create_purge_approval(
            {
                "id": request_id,
                "workspace_id": workspace["workspace_id"],
                "workspace_name": workspace["name"],
                "subscription_code": workspace["subscription_code"],
                "requested_by": user["id"],
                "owner_user_id": owner_user_id,
                "reason": request.reason,
                "code_hash": hashlib.sha256(
                    f"{request_id}:{code}".encode()
                ).hexdigest(),
                "expires_at": (
                    datetime.now(UTC) + timedelta(minutes=10)
                ).isoformat(),
            }
        )
        await send_purge_approval_code_email(
            settings,
            to_email=settings.purge_approver_email,
            workspace_name=workspace["name"],
            subscription_code=workspace["subscription_code"],
            code=code,
        )
        return {
            "request_id": request_id,
            "message": "Approval code sent to the primary approver.",
        }
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

@router.post("/data-lifecycle/purge-approvals")
async def approve_purge(
    request: PurgeApproval,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        if not settings.is_purge_approver(str(user.get("email") or "")):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the primary purge approver can approve this request.",
            )
        row = await gateway.purge_approval(request.request_id)
        if (
            not row
            or row.get("status") != "pending"
            or str(row.get("requested_by")) == str(user["id"])
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This purge request cannot be approved by this account.",
            )

        expires_at = datetime.fromisoformat(
            str(row["expires_at"]).replace("Z", "+00:00")
        )
        submitted_hash = hashlib.sha256(
            f"{request.request_id}:{request.code}".encode()
        ).hexdigest()
        if expires_at < datetime.now(UTC) or not secrets.compare_digest(
            str(row["code_hash"]), submitted_hash
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The approval code is invalid or expired.",
            )

        await gateway.permanently_delete_workspace(
            str(row["workspace_id"]), str(row["owner_user_id"])
        )
        await gateway.approve_purge(request.request_id, str(user["id"]))
        return {"message": "Workspace permanently purged and GSTIN released."}
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc


def _not_found_or_bad_request(exc: SupabaseGatewayError) -> HTTPException:
    message = str(exc)
    code = (
        status.HTTP_404_NOT_FOUND
        if message.startswith(("No user matches", "No workspace matches"))
        else status.HTTP_400_BAD_REQUEST
    )
    return HTTPException(status_code=code, detail=message)


def _normalized_gstin(value: str) -> str:
    normalized = value.strip().upper()
    if not GSTIN_PATTERN.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid 15-character GSTIN.",
        )
    return normalized


@router.get("/user-setup", response_model=AdminSetupTargetResponse)
async def find_user_for_setup(
    query: Annotated[str, Query(min_length=3, max_length=320)],
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AdminSetupTargetResponse:
    """Look up a user by email or subscription code and report their setup state."""
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        target = await gateway.admin_setup_target(query)
    except SupabaseGatewayError as exc:
        raise _not_found_or_bad_request(exc) from exc
    return AdminSetupTargetResponse(**target)


@router.get("/user-setup/gstin", response_model=GstVerificationResponse)
async def lookup_gstin_for_setup(
    workspace_id: Annotated[str, Query(min_length=36, max_length=36)],
    gstin: Annotated[str, Query(min_length=15, max_length=15)],
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> GstVerificationResponse:
    """Fetch registered GST details for the user's workspace without saving."""
    normalized = _normalized_gstin(gstin)
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        if not await gateway.admin_gstin_available(workspace_id, normalized):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This GST number is already registered to another ChanaX "
                "workspace.",
            )
        data, cached, legal_name, trade_name, registration_status = (
            await lookup_active_taxpayer(gateway, normalized)
        )
    except GstVerificationUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except SupabaseGatewayError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except WhiteBooksConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except WhiteBooksRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return GstVerificationResponse(
        workspace_id=workspace_id,
        gstin=normalized,
        pan=normalized[2:12],
        cached=cached,
        legal_name=legal_name,
        trade_name=trade_name,
        registration_status=registration_status,
        billing_address=_address(data),
        premises_address=_address(data),
        data=data,
    )


@router.post("/user-setup", response_model=AdminCompleteSetupResponse)
async def complete_user_setup(
    request: AdminCompleteSetupRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AdminCompleteSetupResponse:
    """Complete onboarding for a user who agreed to it, then email them."""
    gateway = SupabaseGateway(settings)
    setup = {**request.setup, "accountType": "founder"}
    has_gstin = bool(setup.get("hasGstin"))
    gstin = str(setup.get("gstin") or "")
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        if has_gstin:
            gstin = _normalized_gstin(gstin)
            # Cached by the lookup step: no second paid WhiteBooks call.
            await lookup_active_taxpayer(gateway, gstin)
            setup["gstin"] = gstin
        else:
            setup["gstin"] = ""
        result = await gateway.admin_complete_setup(
            workspace_id=request.workspace_id,
            setup=setup,
            entity_id=request.entity_id,
            entity={**request.entity, "gstin": setup["gstin"]},
            actor_user_id=str(user["id"]),
        )
        gst_verified = (
            await gateway.verify_workspace_gstin(request.workspace_id, gstin)
            if has_gstin
            else False
        )
    except GstVerificationUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except SupabaseGatewayError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except WhiteBooksConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except WhiteBooksRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    email = str(result.get("email") or "")
    email_sent = False
    if request.notify_user and email:
        try:
            await send_account_ready_email(
                settings,
                to_email=email,
                recipient_name=str(result.get("full_name") or ""),
                firm_name=str(setup.get("firmName") or "your business"),
                login_url=f"{settings.frontend_url.rstrip('/')}/login",
            )
            email_sent = True
        except (EmailConfigurationError, EmailDeliveryError):
            logger.exception(
                "Account-ready email failed workspace_id=%s", request.workspace_id
            )
    logger.info(
        "Admin completed setup workspace_id=%s actor_user_id=%s",
        request.workspace_id,
        user.get("id"),
    )
    parts = ["Setup completed."]
    if has_gstin:
        parts.append(
            "GSTIN verified and free credits added."
            if gst_verified
            else "GSTIN saved, but free-credit verification did not complete."
        )
    if request.notify_user:
        parts.append(
            f"Email sent to {email}." if email_sent else "The email could not be sent."
        )
    return AdminCompleteSetupResponse(
        message=" ".join(parts),
        workspace_id=request.workspace_id,
        subscription_code=result.get("subscription_code"),
        email=email or None,
        gst_verified=gst_verified,
        email_sent=email_sent,
    )
