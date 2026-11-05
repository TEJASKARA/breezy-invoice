from typing import Annotated

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.api.routes.gst import _bearer_token
from app.core.config import Settings, get_settings
from app.schemas.documents import normalize_phone_number
from app.services.phone_verification import (
    PhoneVerificationError,
    PhoneVerificationUnavailable,
    check_verification_code,
    send_verification_code,
)
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError
from app.services.welcome_email import deliver_welcome

router = APIRouter()


@router.post("/welcome", status_code=202)
async def welcome_after_signin(
    background_tasks: BackgroundTasks,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    token = _bearer_token(authorization)
    try:
        user = await SupabaseGateway(settings).authenticated_user(token)
    except SupabaseGatewayError as exc:
        raise HTTPException(401, "Sign in again to continue.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(503, "The account connection is unavailable.") from exc
    if not user.get("email_confirmed_at") or not user.get("email"):
        return {"status": "not_eligible"}
    background_tasks.add_task(deliver_welcome, settings, str(user["id"]))
    return {"status": "scheduled"}


class PhoneCodeRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=24)

    @field_validator("phone")
    @classmethod
    def valid_phone(cls, value: str) -> str:
        return normalize_phone_number(value)


class PhoneVerifyRequest(PhoneCodeRequest):
    code: str = Field(pattern=r"^\s*\d{6}\s*$")


async def _signed_in_user(settings: Settings, authorization: str) -> dict:
    try:
        return await SupabaseGateway(settings).authenticated_user(
            _bearer_token(authorization)
        )
    except SupabaseGatewayError as exc:
        raise HTTPException(401, "Sign in again to continue.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(503, "The account connection is unavailable.") from exc


@router.post("/phone/send-code")
async def send_phone_code(
    request: PhoneCodeRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    """Send a 6-digit verification code to the user's WhatsApp via n8n."""
    user = await _signed_in_user(settings, authorization)
    try:
        await send_verification_code(
            settings,
            user_id=str(user["id"]),
            email=str(user.get("email") or ""),
            phone=request.phone,
        )
    except PhoneVerificationUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except (PhoneVerificationError, SupabaseGatewayError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"message": f"We sent a 6-digit code to +{request.phone} on WhatsApp."}


@router.post("/phone/verify")
async def verify_phone_code(
    request: PhoneVerifyRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    user = await _signed_in_user(settings, authorization)
    try:
        result = await check_verification_code(
            settings,
            user_id=str(user["id"]),
            phone=request.phone,
            code=request.code.strip(),
        )
    except PhoneVerificationUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except (PhoneVerificationError, SupabaseGatewayError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"phone": str(result.get("phone") or f"+{request.phone}")}
