import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

from app.core.config import Settings, get_settings
from app.schemas.gst import GstVerificationResponse
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError
from app.services.whitebooks import (
    WhiteBooksConfigurationError,
    WhiteBooksRequestError,
    get_whitebooks_client,
)

router = APIRouter()

GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


def _bearer_token(authorization: str) -> str:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to verify a GSTIN.",
        )
    return token.strip()


def _find(payload: Any, names: tuple[str, ...]) -> Any:
    wanted = {name.lower().replace("_", "") for name in names}
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key.lower().replace("_", "") in wanted and value not in (None, ""):
                return value
        for value in payload.values():
            found = _find(value, names)
            if found not in (None, ""):
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = _find(value, names)
            if found not in (None, ""):
                return found
    return ""


def _address(payload: dict[str, Any]) -> str:
    value = _find(
        payload,
        (
            "principal_place_of_business",
            "principalAddress",
            "pradr",
            "address",
            "billing_address",
        ),
    )
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        nested = value.get("addr") if isinstance(value.get("addr"), dict) else value
        parts = [
            nested.get(key)
            for key in (
                "bno",
                "flno",
                "bnm",
                "st",
                "loc",
                "dst",
                "stcd",
                "pncd",
            )
        ]
        return ", ".join(str(part).strip() for part in parts if part)
    return ""


def _is_active_registration(registration_status: str) -> bool:
    normalized = registration_status.strip().lower()
    return bool(normalized) and not any(
        blocked in normalized
        for blocked in ("cancel", "suspend", "inactive", "invalid")
    )


def _taxpayer_details(payload: dict[str, Any]) -> tuple[str, str, str]:
    legal_name = str(_find(payload, ("legal_name", "legalName", "lgnm")) or "").strip()
    trade_name = str(
        _find(payload, ("trade_name", "tradeName", "tradeNam")) or ""
    ).strip()
    registration_status = str(
        _find(
            payload,
            ("registration_status", "gstin_status", "taxpayer_status", "sts"),
        )
        or ""
    ).strip()
    return legal_name, trade_name, registration_status


def _invalid_payload_message(payload: dict[str, Any]) -> str:
    message = str(_find(payload, ("message", "error_description", "detail")) or "")
    normalized = message.strip().lower()
    if any(
        marker in normalized
        for marker in (
            "invalid gst",
            "gstin invalid",
            "invalid request",
            "not found",
            "no record",
            "does not exist",
        )
    ):
        return message.strip()
    return ""


@router.get("/verify", response_model=GstVerificationResponse)
async def verify_gstin(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str, Header()],
    gstin: str = Query(min_length=15, max_length=15),
    workspace_id: str = Query(min_length=36, max_length=36),
) -> GstVerificationResponse:
    normalized_gstin = gstin.strip().upper()
    if not GSTIN_PATTERN.fullmatch(normalized_gstin):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid 15-character GSTIN.",
        )

    gateway = SupabaseGateway(settings)
    try:
        access_token = _bearer_token(authorization)
        await gateway.authenticated_user(access_token)
        await gateway.assert_workspace_permission(
            access_token, workspace_id, "entities.manage"
        )
        await gateway.assert_gstin_available(
            access_token, workspace_id, normalized_gstin
        )
        data = await gateway.cached_gstin(normalized_gstin)
        cached = data is not None
        if data is not None:
            legal_name, trade_name, registration_status = _taxpayer_details(data)
            if not (legal_name or trade_name) or not registration_status:
                # Never let a stale error response in the cache permanently block a
                # real taxpayer lookup. Older versions cached before validating.
                data = None
                cached = False
        if data is None:
            data = await get_whitebooks_client().verify_gstin(normalized_gstin)
            legal_name, trade_name, registration_status = _taxpayer_details(data)
            provider_error = _invalid_payload_message(data)
            if provider_error or not (legal_name or trade_name):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=(
                        "This GSTIN could not be found. Check the number and try again."
                    ),
                )
            if not registration_status:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=(
                        "WhiteBooks returned incomplete GST registration details. "
                        "Please try again."
                    ),
                )
            await gateway.cache_gstin(normalized_gstin, data)
        else:
            legal_name, trade_name, registration_status = _taxpayer_details(data)

        if not _is_active_registration(registration_status):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"This GSTIN has registration status “{registration_status}”. "
                    "Enter an active GSTIN or choose the non-GST option."
                ),
            )
        workspace_verified = False
        workspace_verified = await gateway.verify_workspace_gstin(
            workspace_id, normalized_gstin
        )
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc
    except WhiteBooksConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except WhiteBooksRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return GstVerificationResponse(
        gstin=normalized_gstin,
        pan=normalized_gstin[2:12],
        cached=cached,
        workspace_verified=workspace_verified,
        legal_name=legal_name,
        trade_name=trade_name,
        registration_status=registration_status,
        billing_address=_address(data),
        premises_address=_address(data),
        data=data,
    )
