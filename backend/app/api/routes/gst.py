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

GSTIN_PATTERN = re.compile(
    r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"
)


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
    return not any(
        blocked in normalized
        for blocked in ("cancel", "suspend", "inactive", "invalid")
    )


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
        user = await gateway.authenticated_user(_bearer_token(authorization))
        await gateway.assert_workspace_member(workspace_id, str(user["id"]))
        data = await gateway.cached_gstin(normalized_gstin)
        cached = data is not None
        if data is None:
            data = await get_whitebooks_client().verify_gstin(normalized_gstin)
            await gateway.cache_gstin(normalized_gstin, data)
        registration_status = str(
            _find(
                data,
                ("registration_status", "gstin_status", "taxpayer_status", "sts"),
            )
            or ""
        )
        workspace_verified = False
        if _is_active_registration(registration_status):
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
        legal_name=str(_find(data, ("legal_name", "legalName", "lgnm")) or ""),
        trade_name=str(_find(data, ("trade_name", "tradeName", "tradeNam")) or ""),
        registration_status=registration_status,
        billing_address=_address(data),
        premises_address=_address(data),
        data=data,
    )
