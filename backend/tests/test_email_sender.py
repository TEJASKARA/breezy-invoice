import asyncio
import base64

import pytest

from app.core.config import Settings
from app.services import email_sender
from app.services.email_sender import (
    EmailDeliveryError,
    _decoded_pdf,
    _send_with_resend_api,
)


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


def test_resend_api_sends_the_pdf_attachment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class Response:
        is_success = True

    class Client:
        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def post(self, url: str, **kwargs: object) -> Response:
            captured.update(url=url, **kwargs)
            return Response()

    monkeypatch.setattr(email_sender.httpx, "AsyncClient", lambda **_kwargs: Client())
    settings = Settings(
        _env_file=None,
        smtp_host="smtp.resend.com",
        smtp_username="resend",
        smtp_password="re_test",
        smtp_from_email="letters@chanax.in",
        smtp_from_name="ChanaX",
    )

    asyncio.run(
        _send_with_resend_api(
            settings,
            to_email="employee@example.com",
            subject="Offer letter",
            message="Please find the letter attached.",
            filename="offer.pdf",
            pdf=b"%PDF-1.7\nexample",
        )
    )

    assert captured["url"] == "https://api.resend.com/emails"
    payload = captured["json"]
    assert isinstance(payload, dict)
    assert payload["to"] == ["employee@example.com"]
    assert payload["attachments"][0]["filename"] == "offer.pdf"
