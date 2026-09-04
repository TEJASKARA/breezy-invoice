import base64

import pytest

from app.core.config import Settings
from app.services.email_sender import EmailDeliveryError, _decoded_pdf


def test_smtp_requires_all_delivery_credentials() -> None:
    incomplete = Settings(_env_file=None, smtp_host="smtp.resend.com")
    configured = Settings(
        _env_file=None,
        smtp_host="smtp.resend.com",
        smtp_username="resend",
        smtp_password="secret",
        smtp_from_email="letters@chanax.in",
    )

    assert incomplete.smtp_is_configured is False
    assert configured.smtp_is_configured is True


def test_employee_letter_attachment_must_be_a_pdf() -> None:
    with pytest.raises(EmailDeliveryError, match="not a PDF"):
        _decoded_pdf(base64.b64encode(b"not-a-pdf").decode())

    assert _decoded_pdf(base64.b64encode(b"%PDF-1.7\nexample").decode()).startswith(
        b"%PDF"
    )
