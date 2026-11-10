import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime
from typing import Any

import httpx

from app.core.config import Settings
from app.services.supabase_gateway import SupabaseGateway

logger = logging.getLogger(__name__)

CODE_TTL_SECONDS = 600


class PhoneVerificationError(RuntimeError):
    """Shown to the user as-is."""


class PhoneVerificationUnavailable(RuntimeError):
    pass


def new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def code_hash(settings: Settings, user_id: str, phone: str, code: str) -> str:
    """Keyed hash so stored codes are useless without the server secret."""
    secret = settings.n8n_otp_secret or settings.supabase_service_role_key
    key = (secret or "chanax").encode()
    message = f"{user_id}:{phone}:{code.strip()}".encode()
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def otp_webhook_payload(
    *, phone: str, code: str, user_id: str, email: str, purpose: str = "verify"
) -> dict[str, Any]:
    """The JSON body n8n receives. Keep in sync with deploy/README.md."""
    return {
        "event": "phone.verification",
        "purpose": purpose,
        "phone": phone,
        "phone_e164": f"+{phone}",
        "otp": code,
        "expires_in_minutes": CODE_TTL_SECONDS // 60,
        "user_id": user_id,
        "email": email,
        "sent_at": datetime.now(UTC).isoformat(),
    }


async def post_code_to_n8n(settings: Settings, payload: dict[str, Any]) -> None:
    """Hand a code to the n8n WhatsApp workflow."""
    headers = {"Content-Type": "application/json"}
    secret = settings.n8n_otp_secret or settings.n8n_whatsapp_secret
    if secret:
        headers["X-ChanaX-Secret"] = secret
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                settings.n8n_otp_webhook_url,
                json=payload,
                headers=headers,
            )
    except httpx.HTTPError as exc:
        logger.warning("OTP webhook unreachable: %s", type(exc).__name__)
        raise PhoneVerificationError(
            "We couldn't send the code right now. Please try again in a minute."
        ) from exc
    if response.is_error:
        logger.warning(
            "OTP webhook returned %s: %s", response.status_code, response.text[:300]
        )
        raise PhoneVerificationError(
            "We couldn't send the code to this number. Check it and try again."
        )


async def send_verification_code(
    settings: Settings, *, user_id: str, email: str, phone: str
) -> None:
    if not settings.phone_otp_is_configured:
        raise PhoneVerificationUnavailable(
            "Phone verification is not configured yet. Please try again later."
        )
    code = new_code()
    gateway = SupabaseGateway(settings)
    # Stores the hash and enforces cooldown/limits before anything is sent.
    await gateway.service_rpc(
        "breezy_phone_otp_create",
        {
            "target_user_id": user_id,
            "target_phone": phone,
            "target_code_hash": code_hash(settings, user_id, phone, code),
            "ttl_seconds": CODE_TTL_SECONDS,
        },
    )
    await post_code_to_n8n(
        settings,
        otp_webhook_payload(phone=phone, code=code, user_id=user_id, email=email),
    )


async def check_verification_code(
    settings: Settings, *, user_id: str, phone: str, code: str
) -> dict[str, Any]:
    result = await SupabaseGateway(settings).service_rpc(
        "breezy_phone_otp_verify",
        {
            "target_user_id": user_id,
            "target_phone": phone,
            "target_code_hash": code_hash(settings, user_id, phone, code),
        },
    )
    if not isinstance(result, dict):
        raise PhoneVerificationUnavailable("Phone verification returned no result.")
    if result.get("verified"):
        return result
    reason = result.get("reason")
    if reason == "mismatch":
        left = int(result.get("attempts_left") or 0)
        raise PhoneVerificationError(
            f"That code is incorrect. {left} attempt{'s' if left != 1 else ''} left."
            if left
            else "That code is incorrect. Request a new code."
        )
    if reason == "locked":
        raise PhoneVerificationError("Too many incorrect attempts. Request a new code.")
    raise PhoneVerificationError("This code has expired. Request a new code.")
