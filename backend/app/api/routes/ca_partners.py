import logging
from typing import Annotated
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.api.routes.gst import _bearer_token
from app.core.config import Settings, get_settings
from app.services.email_sender import (
    EmailConfigurationError,
    EmailDeliveryError,
    send_ca_client_invitation_email,
)
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError

router = APIRouter()
logger = logging.getLogger(__name__)
INVITATION_VALIDATION_MESSAGES = {
    "Only CA partner accounts can invite clients.",
    "Enter a client name of 160 characters or fewer.",
    "Enter the client email or international phone number.",
    "Enter a valid client email address.",
    "Enter the phone number with its country code.",
    "The daily client invitation limit has been reached. Try again tomorrow.",
    "A pending invitation already exists for this client. "
    "Cancel it before sending a replacement.",
}


class ClientInvitationRequest(BaseModel):
    client_name: str = Field(min_length=1, max_length=160)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=30)

    @field_validator("client_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError("Enter a valid client name.")
        return value


class ClientInvitationResponse(BaseModel):
    id: str
    invitation_url: str
    email_sent: bool
    phone: str | None = None
    message: str


@router.post("/client-invitations", response_model=ClientInvitationResponse)
async def invite_client(
    invitation: ClientInvitationRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ClientInvitationResponse:
    token = _bearer_token(authorization)
    base = settings.frontend_url.rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(503, "Client invitations are temporarily unavailable.")
    gateway = SupabaseGateway(settings)
    try:
        await gateway.authenticated_user(token)
        result = await gateway.user_rpc(
            token,
            "chanax_create_ca_client_invitation",
            {
                "target_client_name": invitation.client_name,
                "target_email": invitation.email,
                "target_phone": invitation.phone,
            },
        )
    except SupabaseGatewayError as exc:
        detail = str(exc)
        if detail == "Your ChanaX session is invalid or expired.":
            raise HTTPException(401, "Sign in again to invite a client.") from exc
        if detail in INVITATION_VALIDATION_MESSAGES:
            raise HTTPException(400, detail) from exc
        logger.warning("CA invitation storage is unavailable")
        raise HTTPException(
            503, "Client invitations are temporarily unavailable."
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            503, "Client invitations are temporarily unavailable."
        ) from exc
    if not isinstance(result, dict) or not result.get("id") or not result.get("token"):
        raise HTTPException(503, "The client invitation could not be created.")
    # Fragment keeps the bearer secret out of server logs and HTTP Referer headers.
    invitation_url = f"{base}/ca-invite#token={result['token']}"
    sent = False
    if result.get("email"):
        try:
            await send_ca_client_invitation_email(
                settings,
                to_email=result["email"],
                firm_name=str(result.get("firm_name") or "Your CA"),
                invitation_url=invitation_url,
            )
            sent = True
        except (EmailConfigurationError, EmailDeliveryError):
            logger.warning(
                "CA invitation email failed; private share link remains usable"
            )
    message = "Invitation email sent. The client must approve your access."
    if not sent:
        message = (
            "Email could not be sent. Share the private invitation link."
            if result.get("email")
            else "Invitation created. Share the private link with your client."
        )
    return ClientInvitationResponse(
        id=str(result["id"]),
        invitation_url=invitation_url,
        email_sent=sent,
        phone=result.get("phone"),
        message=message,
    )
