import base64
import binascii
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

# WhatsApp accepts documents up to 100 MB; invoices are far smaller. Keep the
# webhook payload modest so n8n can hold it in memory.
MAX_PDF_BYTES = 10 * 1024 * 1024


class WhatsAppConfigurationError(RuntimeError):
    pass


class WhatsAppDeliveryError(RuntimeError):
    pass


def _validated_pdf_size(pdf_base64: str) -> int:
    try:
        data = base64.b64decode(pdf_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise WhatsAppDeliveryError("The generated document PDF is invalid.") from exc
    if not data.startswith(b"%PDF"):
        raise WhatsAppDeliveryError("The generated document attachment is not a PDF.")
    if len(data) > MAX_PDF_BYTES:
        raise WhatsAppDeliveryError(
            "This PDF is larger than 10 MB and cannot be sent on WhatsApp."
        )
    return len(data)


def build_whatsapp_payload(
    *,
    to_number: str,
    message: str,
    filename: str,
    pdf_base64: str,
    pdf_bytes: int,
    document_type: str,
    document_number: str,
    document_id: str,
    workspace_id: str,
    sent_by_user_id: str,
    sent_by_email: str,
) -> dict[str, Any]:
    """The JSON body n8n receives. Keep in sync with deploy/README.md."""
    return {
        "event": "document.whatsapp",
        "to": to_number,
        "to_e164": f"+{to_number}",
        "message": message,
        "document": {
            "type": document_type,
            "number": document_number,
            "id": document_id,
        },
        "file": {
            "filename": filename,
            "mime_type": "application/pdf",
            "size_bytes": pdf_bytes,
            "base64": pdf_base64,
        },
        "workspace_id": workspace_id,
        "sent_by": {"user_id": sent_by_user_id, "email": sent_by_email},
        "sent_at": datetime.now(timezone.utc).isoformat(),  # noqa: UP017
    }


async def send_document_whatsapp(
    settings: Settings,
    *,
    to_number: str,
    message: str,
    filename: str,
    pdf_base64: str,
    document_type: str,
    document_number: str,
    document_id: str,
    workspace_id: str,
    sent_by_user_id: str,
    sent_by_email: str,
) -> None:
    if not settings.whatsapp_is_configured:
        raise WhatsAppConfigurationError(
            "WhatsApp sending has not been configured for ChanaX yet."
        )
    pdf_bytes = _validated_pdf_size(pdf_base64)
    payload = build_whatsapp_payload(
        to_number=to_number,
        message=message,
        filename=filename,
        pdf_base64=pdf_base64,
        pdf_bytes=pdf_bytes,
        document_type=document_type,
        document_number=document_number,
        document_id=document_id,
        workspace_id=workspace_id,
        sent_by_user_id=sent_by_user_id,
        sent_by_email=sent_by_email,
    )
    headers = {"Content-Type": "application/json"}
    if settings.n8n_whatsapp_secret:
        headers["X-ChanaX-Secret"] = settings.n8n_whatsapp_secret
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                settings.n8n_whatsapp_webhook_url, json=payload, headers=headers
            )
    except httpx.HTTPError as exc:
        logger.warning("WhatsApp webhook unreachable: %s", type(exc).__name__)
        raise WhatsAppDeliveryError(
            "The WhatsApp service could not be reached. Please try again."
        ) from exc
    if response.is_error:
        logger.warning("WhatsApp webhook returned %s", response.status_code)
        raise WhatsAppDeliveryError(
            "WhatsApp could not send this document. Please try again."
        )
    # n8n may answer {"success": false, "error": "..."} with a 200.
    try:
        body = response.json()
    except ValueError:
        return
    if isinstance(body, dict) and body.get("success") is False:
        detail = str(body.get("error") or "").strip()[:200]
        raise WhatsAppDeliveryError(
            detail or "WhatsApp could not send this document. Please try again."
        )
