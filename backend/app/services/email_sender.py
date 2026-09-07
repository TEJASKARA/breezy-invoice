import asyncio
import base64
import binascii
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import Settings


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
    filename: str,
    pdf: bytes,
) -> None:
    email = EmailMessage()
    email["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    email["To"] = to_email
    email["Subject"] = subject
    email.set_content(message)
    email.add_attachment(pdf, maintype="application", subtype="pdf", filename=filename)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(email)
    except (OSError, smtplib.SMTPException) as exc:
        raise EmailDeliveryError(
            "The email provider could not deliver this document. Please try again."
        ) from exc


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
    await asyncio.to_thread(
        _send,
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
    await asyncio.to_thread(
        _send,
        settings,
        to_email=to_email,
        subject=subject,
        message=message,
        filename=filename,
        pdf=pdf,
    )
