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
    sender_company_name: str = "",
    recipient_company_name: str = "",
) -> dict[str, Any]:
    """The JSON body n8n receives. Keep in sync with deploy/README.md."""
    return {
        "event": "document.whatsapp",
        "to": to_number,
        "message": message,
        "document": {
            "type": document_type,
            "number": document_number,
            "id": document_id,
        },
        "companies": {
            "sender": sender_company_name,
            "recipient": recipient_company_name,
        },
        "sender_company_name": sender_company_name,
        "recipient_company_name": recipient_company_name,
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


def _webhook_error_message(status_code: int) -> str:
    """Says what n8n answered so a misconfigured workflow is quick to fix."""
    if status_code == 404:
        reason = (
            "the n8n workflow is not active, or its Webhook node is not set "
            "to the POST method"
        )
    elif status_code in (401, 403):
        reason = (
            "n8n rejected the secret - N8N_WHATSAPP_SECRET must match the "
            "X-ChanaX-Secret header credential on the Webhook node"
        )
    elif status_code == 413:
        reason = "the PDF is larger than n8n accepts"
    elif status_code >= 500:
        reason = "the n8n workflow failed while sending - check its executions"
    else:
        reason = "n8n refused the request"
    return (
        f"WhatsApp could not send this document: {reason} "
        f"(n8n replied {status_code})."
    )


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
    sender_company_name: str = "",
    recipient_company_name: str = "",
) -> str:
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
        sender_company_name=sender_company_name,
        recipient_company_name=recipient_company_name,
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
    try:
        body = response.json()
    except ValueError:
        body = None
    # Accept either error key used by the n8n failure response, including when
    # the workflow returns a non-2xx HTTP code.
    if isinstance(body, dict) and (body.get("success") is False or response.is_error):
        detail = body.get("error") or body.get("message")
        if isinstance(detail, dict):
            detail = detail.get("message")
        if isinstance(detail, str) and detail.strip():
            raise WhatsAppDeliveryError(detail.strip()[:500])
        if body.get("success") is False:
            raise WhatsAppDeliveryError(
                "WhatsApp couldn't send this message. Please try again later."
            )
    if response.is_error:
        logger.warning(
            "WhatsApp webhook returned %s: %s",
            response.status_code,
            response.text[:300],
        )
        raise WhatsAppDeliveryError(_webhook_error_message(response.status_code))
    # An immediate 'workflow started' response is not proof of a successful send.
    if not isinstance(body, dict) or body.get("success") is not True:
        raise WhatsAppDeliveryError(
            "We couldn't confirm whether WhatsApp accepted this message. "
            "Check whether it arrived before trying again."
        )
    message = body.get("message")
    return (
        message.strip()[:500]
        if isinstance(message, str) and message.strip()
        else "Message sent successfully. WhatsApp accepted the document for delivery."
    )
