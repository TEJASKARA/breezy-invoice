"""Supabase Auth "Send SMS" hook: Supabase makes the code, n8n sends it on WhatsApp."""

import base64
import hashlib
import hmac
import time
from typing import Any

from app.core.config import Settings
from app.services.phone_verification import (
    PhoneVerificationError,
    otp_webhook_payload,
    post_code_to_n8n,
)

SIGNATURE_TOLERANCE_SECONDS = 5 * 60


class HookSignatureError(RuntimeError):
    pass


def _secret_key(secret: str) -> bytes:
    value = secret.strip()
    for prefix in ("v1,whsec_", "whsec_"):
        if value.startswith(prefix):
            value = value[len(prefix) :]
            break
    try:
        return base64.b64decode(value)
    except ValueError as exc:
        raise HookSignatureError("The SMS hook secret is invalid.") from exc


def verify_signature(
    secret: str, body: bytes, headers: dict[str, str], now: float | None = None
) -> None:
    """Standard Webhooks check, as used by Supabase Auth hooks."""
    if not secret.strip():
        raise HookSignatureError("The SMS hook secret is not configured.")
    message_id = headers.get("webhook-id", "")
    timestamp = headers.get("webhook-timestamp", "")
    signatures = headers.get("webhook-signature", "")
    if not message_id or not timestamp or not signatures:
        raise HookSignatureError("Missing webhook signature headers.")
    try:
        sent_at = int(timestamp)
    except ValueError as exc:
        raise HookSignatureError("Invalid webhook timestamp.") from exc
    current = time.time() if now is None else now
    if abs(current - sent_at) > SIGNATURE_TOLERANCE_SECONDS:
        raise HookSignatureError("The webhook timestamp is too old.")
    signed = f"{message_id}.{timestamp}.".encode() + body
    expected = base64.b64encode(
        hmac.new(_secret_key(secret), signed, hashlib.sha256).digest()
    ).decode()
    for candidate in signatures.split():
        version, _, signature = candidate.partition(",")
        if version == "v1" and hmac.compare_digest(signature, expected):
            return
    raise HookSignatureError("The webhook signature does not match.")


async def deliver_auth_code(settings: Settings, payload: dict[str, Any]) -> None:
    user = payload.get("user") if isinstance(payload.get("user"), dict) else {}
    sms = payload.get("sms") if isinstance(payload.get("sms"), dict) else {}
    # Only sign-in / sign-up codes come through here, always to the login phone.
    # Phone changes use ChanaX's own WhatsApp verification (Profile page).
    phone = str(user.get("phone") or "").lstrip("+")
    code = str(sms.get("otp") or "")
    if not phone.isdigit() or not code:
        raise PhoneVerificationError("The sign-in code request was incomplete.")
    await post_code_to_n8n(
        settings,
        otp_webhook_payload(
            phone=phone,
            code=code,
            user_id=str(user.get("id") or ""),
            email=str(user.get("email") or ""),
            purpose="login",
        ),
    )
