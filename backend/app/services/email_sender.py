import asyncio
import base64
import binascii
import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)


class EmailConfigurationError(RuntimeError):
    pass


class EmailDeliveryError(RuntimeError):
    pass


def _decoded_pdf(value: str) -> bytes:
    try:
        data = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise EmailDeliveryError("The generated document PDF is invalid.") from exc
    if not data.startswith(b"%PDF"):
        raise EmailDeliveryError("The generated document attachment is not a PDF.")
    return data


def _send(
    settings: Settings,
    *,
    to_email: str,
    subject: str,
    message: str,
    filename: str = "",
    pdf: bytes = b"",
) -> None:
    email = EmailMessage()
    email["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    email["To"] = to_email
    email["Subject"] = subject
    email.set_content(message)
    if pdf:
        email.add_attachment(
            pdf, maintype="application", subtype="pdf", filename=filename
        )
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(email)
    except smtplib.SMTPAuthenticationError as exc:
        logger.exception("SMTP authentication failed")
        raise EmailDeliveryError(
            "The ChanaX email service could not authenticate. Please contact support."
        ) from exc
    except smtplib.SMTPSenderRefused as exc:
        logger.exception("SMTP provider rejected the configured sender")
        raise EmailDeliveryError(
            "The email provider rejected the ChanaX sender address. "
            "Please contact support."
        ) from exc
    except smtplib.SMTPRecipientsRefused as exc:
        logger.exception("SMTP provider rejected the recipient")
        raise EmailDeliveryError(
            "The email provider rejected this recipient address. "
            "Check the employee email and try again."
        ) from exc
    except (OSError, smtplib.SMTPException) as exc:
        logger.exception("SMTP document delivery failed")
        raise EmailDeliveryError(
            "The email provider could not deliver this document. Please try again."
        ) from exc


async def _send_with_resend_api(
    settings: Settings,
    *,
    to_email: str,
    subject: str,
    message: str,
    filename: str = "",
    pdf: bytes = b"",
) -> None:
    sender = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {settings.smtp_password}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": sender,
                    "to": [to_email],
                    "subject": subject,
                    "text": message,
                    **(
                        {
                            "attachments": [
                                {
                                    "filename": filename,
                                    "content": base64.b64encode(pdf).decode("ascii"),
                                }
                            ]
                        }
                        if pdf
                        else {}
                    ),
                },
            )
    except httpx.HTTPError as exc:
        logger.exception("Resend email API request failed")
        raise EmailDeliveryError(
            "The ChanaX email service could not reach Resend. Please try again."
        ) from exc

    if response.is_success:
        return

    try:
        payload = response.json()
        provider_message = str(payload.get("message") or "").strip()
    except (ValueError, AttributeError):
        provider_message = ""
    logger.error(
        "Resend rejected document email with status %s: %s",
        response.status_code,
        provider_message or response.text[:500],
    )
    if response.status_code in {401, 403}:
        detail = "The Resend API key is invalid or lacks sending permission."
    elif provider_message:
        detail = f"Resend rejected the email: {provider_message}"
    else:
        detail = "Resend rejected the email request. Please contact support."
    raise EmailDeliveryError(detail)


async def _deliver(
    settings: Settings,
    *,
    to_email: str,
    subject: str,
    message: str,
    filename: str = "",
    pdf: bytes = b"",
) -> None:
    delivery = {
        "to_email": to_email,
        "subject": subject,
        "message": message,
        "filename": filename,
        "pdf": pdf,
    }
    if settings.smtp_host.strip().lower() == "smtp.resend.com":
        await _send_with_resend_api(settings, **delivery)
        return
    await asyncio.to_thread(_send, settings, **delivery)


async def send_ca_client_invitation_email(
    settings: Settings, *, to_email: str, firm_name: str, invitation_url: str
) -> None:
    if not settings.smtp_is_configured:
        raise EmailConfigurationError("Client invitation email is not configured.")
    await _deliver(
        settings,
        to_email=to_email,
        subject="Your CA has invited you to ChanaX",
        message=(
            f"Hi,\n\n{firm_name} has invited you to ChanaX.\n\n"
            f"Open your private invitation: {invitation_url}\n\n"
            "Create an account or sign in, select your company workspace, and review "
            "the page permissions before approving your CA. Opening this link does "
            "not grant access. Your company owns its subscription, credits and data. "
            "The CA uses one of your two included additional-user seats.\n\n"
            "This invitation expires in 14 days. Do not forward this private link. "
            "If you did not expect it, ignore it.\n\nRegards,\nChanaX"
        ),
    )


async def send_employee_letter_email(
    settings: Settings,
    *,
    to_email: str,
    subject: str,
    message: str,
    filename: str,
    pdf_base64: str,
) -> None:
    if not settings.smtp_is_configured:
        raise EmailConfigurationError(
            "Employee letter email is not configured on the ChanaX server."
        )
    pdf = _decoded_pdf(pdf_base64)
    await _deliver(
        settings,
        to_email=to_email,
        subject=subject,
        message=message,
        filename=filename,
        pdf=pdf,
    )


async def send_document_email(
    settings: Settings,
    *,
    to_email: str,
    subject: str,
    message: str,
    filename: str,
    pdf_base64: str,
) -> None:
    if not settings.smtp_is_configured:
        raise EmailConfigurationError(
            "Document email is not configured on the ChanaX server."
        )
    pdf = _decoded_pdf(pdf_base64)
    await _deliver(
        settings,
        to_email=to_email,
        subject=subject,
        message=message,
        filename=filename,
        pdf=pdf,
    )
