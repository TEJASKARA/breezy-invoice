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
    AnalyticsExclusion,
    AnalyticsExclusionCreate,
    AnalyticsExclusionList,
    MarketingImportRequest,
    MarketingImportResponse,
    MarketingSummaryResponse,
    PaymentLinkCreateRequest,
    PaymentLinkListResponse,
    PaymentLinkResponse,
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
from app.services.razorpay import (
    RazorpayClient,
    RazorpayConfigurationError,
    RazorpayRequestError,
    custom_quote_amounts,
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
        return PlatformWorkspaceSearchResponse(
            workspaces=[PlatformWorkspaceResponse(**item) for item in workspaces]
        )
    except SupabaseGatewayError as exc:
        logger.warning("Platform workspace search failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except ValueError as exc:
        logger.exception("Platform workspace search returned unexpected data")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Workspace search returned data the admin page cannot read: {exc}",
        ) from exc


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
        test_accounts = await gateway.admin_analytics_exclusions()
        excluded = set(settings.platform_admin_ids) | {
            str(item["user_id"]) for item in test_accounts if item.get("user_id")
        }
        report = await gateway.admin_usage_report(
            since_days=days,
            identifier=query,
            excluded_user_ids=sorted(excluded),
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


@router.get("/analytics-exclusions", response_model=AnalyticsExclusionList)
async def list_analytics_exclusions(
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AnalyticsExclusionList:
    """Test accounts hidden from platform-wide usage analytics."""
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        accounts = await gateway.admin_analytics_exclusions()
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return AnalyticsExclusionList(
        accounts=[AnalyticsExclusion(**item) for item in accounts]
    )


@router.post("/analytics-exclusions", response_model=AnalyticsExclusion)
async def add_analytics_exclusion(
    request: AnalyticsExclusionCreate,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AnalyticsExclusion:
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        account = await gateway.admin_add_analytics_exclusion(
            email=request.email, actor_user_id=str(user["id"]), note=request.note
        )
    except SupabaseGatewayError as exc:
        message = str(exc)
        code = (
            status.HTTP_404_NOT_FOUND
            if message.startswith("No ChanaX account")
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=code, detail=message) from exc
    return AnalyticsExclusion(**account)


@router.delete("/analytics-exclusions/{user_id}", status_code=204)
async def remove_analytics_exclusion(
    user_id: uuid.UUID,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        await gateway.admin_remove_analytics_exclusion(str(user_id))
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc


@router.get("/marketing/summary", response_model=MarketingSummaryResponse)
async def marketing_summary(
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> MarketingSummaryResponse:
    """Outreach queue counts and recent uploads for the Marketing tab."""
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        summary = await gateway.admin_marketing_summary()
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return MarketingSummaryResponse(**summary)


@router.post("/marketing/import", response_model=MarketingImportResponse)
async def marketing_import(
    request: MarketingImportRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> MarketingImportResponse:
    """Add cleaned GST/MCA contacts to email_outreach as pending; known emails skip."""
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(_bearer_token(authorization))
        _require_platform_admin(user, settings)
        result = await gateway.admin_marketing_import(
            upload={
                "source": request.source,
                "file_name": request.file_name.strip(),
                "uploaded_by": str(user.get("id") or ""),
                "uploaded_by_email": str(user.get("email") or ""),
                "total_rows": request.total_rows,
                "missing_email": request.missing_email,
                "invalid_email": request.invalid_email,
                "duplicate_in_file": request.duplicate_in_file,
            },
            leads=[lead.model_dump() for lead in request.leads],
        )
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return MarketingImportResponse(**result)


def _link_response(row: dict[str, Any]) -> PaymentLinkResponse:
    workspace = row.get("workspace") if isinstance(row.get("workspace"), dict) else {}
    return PaymentLinkResponse(
        **{
            key: row.get(key)
            for key in PaymentLinkResponse.model_fields
            if key in row and key not in {"workspace_name", "subscription_code"}
        },
        workspace_name=workspace.get("name") or row.get("workspace_name"),
        subscription_code=workspace.get("subscription_code")
        or row.get("subscription_code"),
    )


async def _admin(gateway: SupabaseGateway, authorization: str, settings: Settings):
    user = await gateway.authenticated_user(_bearer_token(authorization))
    _require_platform_admin(user, settings)
    return user


def _paid_payment(link: dict[str, Any]) -> dict[str, Any] | None:
    for payment in link.get("payments") or []:
        if isinstance(payment, dict) and payment.get("status") == "captured":
            return payment
    return None


async def _sync_link_status(
    gateway: SupabaseGateway, razorpay: RazorpayClient, row: dict[str, Any]
) -> None:
    """Pull the latest status from Razorpay; fulfil a paid link once."""
    provider_id = str(row.get("provider_link_id") or "")
    if not provider_id or row.get("status") == "paid":
        return
    link = await razorpay.payment_link(provider_id)
    status_value = str(link.get("status") or "")
    if status_value == "paid":
        payment = _paid_payment(link)
        order_id = str(link.get("order_id") or "")
        payment_id = str((payment or {}).get("payment_id") or "")
        if payment_id and not order_id:
            order_id = str((await razorpay.payment(payment_id)).get("order_id") or "")
        if not order_id or not payment_id:
            raise SupabaseGatewayError(
                "Razorpay shows this link as paid but the payment details are "
                "not available yet. Try again in a minute."
            )
        await gateway.settle_payment_link(
            provider_link_id=provider_id,
            provider_order_id=order_id,
            provider_payment_id=payment_id,
            amount_paise=int(link.get("amount_paid") or link.get("amount") or 0),
            event_type="payment_link.status_check",
        )
    elif status_value in {"cancelled", "expired"} and status_value != row.get("status"):
        await gateway.update_payment_link(str(row["id"]), {"status": status_value})


@router.get("/payment-links", response_model=PaymentLinkListResponse)
async def list_payment_links(
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PaymentLinkListResponse:
    gateway = SupabaseGateway(settings)
    try:
        await _admin(gateway, authorization, settings)
        rows = await gateway.payment_link_records()
    except SupabaseGatewayError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return PaymentLinkListResponse(links=[_link_response(row) for row in rows])


@router.post("/payment-links", response_model=PaymentLinkResponse)
async def create_payment_link(
    request: PaymentLinkCreateRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PaymentLinkResponse:
    """Custom quote: price + 18% GST; when paid, credits/months apply automatically."""
    gateway = SupabaseGateway(settings)
    razorpay = RazorpayClient(settings)
    link_id = str(uuid.uuid4())
    base, gst, total = custom_quote_amounts(request.base_amount_paise)
    try:
        user = await _admin(gateway, authorization, settings)
        target = await gateway.admin_setup_target(request.subscription_code)
        if not target.get("workspace_id"):
            raise SupabaseGatewayError("This user does not own a ChanaX workspace.")
        if target.get("workspace_status") != "active":
            raise SupabaseGatewayError("Payment links need an active workspace.")
        phone = str(target.get("phone") or "")
        record = {
            "id": link_id,
            "workspace_id": target["workspace_id"],
            "created_by": user["id"],
            "description": request.description.strip(),
            "base_amount_paise": base,
            "gst_amount_paise": gst,
            "amount_paise": total,
            "credits": request.credits,
            "duration_months": request.duration_months,
            "customer_name": target.get("full_name") or target.get("workspace_name"),
            "customer_email": target.get("email"),
            "customer_phone": phone or None,
            "status": "creating",
        }
        await gateway.create_payment_link_record(record)
        try:
            link = await razorpay.create_payment_link(
                reference_id=link_id,
                amount_paise=total,
                description=request.description.strip(),
                customer={
                    "name": str(record["customer_name"] or ""),
                    "email": str(target.get("email") or ""),
                    "contact": phone,
                },
                notes={
                    "chanax_payment_link_id": link_id,
                    "workspace_id": str(target["workspace_id"]),
                    "subscription_code": str(target.get("subscription_code") or ""),
                    "credits": str(request.credits),
                    "duration_months": str(request.duration_months),
                    "base_amount_paise": str(base),
                    "gst_amount_paise": str(gst),
                },
                notify=request.notify_customer,
            )
        except (RazorpayConfigurationError, RazorpayRequestError):
            await gateway.update_payment_link(link_id, {"status": "failed"})
            raise
        changes = {
            "provider_link_id": str(link["id"]),
            "short_url": str(link["short_url"]),
            "status": "created",
        }
        await gateway.update_payment_link(link_id, changes)
    except RazorpayConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except SupabaseGatewayError as exc:
        raise _not_found_or_bad_request(exc) from exc
    except RazorpayRequestError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    logger.info(
        "Payment link created link_id=%s workspace_id=%s actor=%s",
        link_id,
        record["workspace_id"],
        user.get("id"),
    )
    return _link_response(
        {
            **record,
            **changes,
            "workspace_name": target.get("workspace_name"),
            "subscription_code": target.get("subscription_code"),
            "created_at": datetime.now(UTC).isoformat(),
        }
    )


@router.post("/payment-links/{link_id}/refresh", response_model=PaymentLinkResponse)
async def refresh_payment_link(
    link_id: str,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PaymentLinkResponse:
    """Check Razorpay for the latest status (fallback if a webhook was missed)."""
    gateway = SupabaseGateway(settings)
    try:
        await _admin(gateway, authorization, settings)
        row = await gateway.payment_link_record(link_id)
        await _sync_link_status(gateway, RazorpayClient(settings), row)
        row = await gateway.payment_link_record(link_id)
    except RazorpayConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except (RazorpayRequestError, SupabaseGatewayError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return _link_response(row)


@router.post("/payment-links/{link_id}/cancel", response_model=PaymentLinkResponse)
async def cancel_payment_link(
    link_id: str,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PaymentLinkResponse:
    gateway = SupabaseGateway(settings)
    try:
        await _admin(gateway, authorization, settings)
        row = await gateway.payment_link_record(link_id)
        if row.get("status") != "created" or not row.get("provider_link_id"):
            raise SupabaseGatewayError("Only an unpaid, active link can be cancelled.")
        await RazorpayClient(settings).cancel_payment_link(str(row["provider_link_id"]))
        await gateway.update_payment_link(link_id, {"status": "cancelled"})
        row = await gateway.payment_link_record(link_id)
    except RazorpayConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except (RazorpayRequestError, SupabaseGatewayError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return _link_response(row)
