import base64
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import status
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.main import app
from app.schemas.documents import DocumentWhatsAppRequest
from app.services import whatsapp_sender
from app.services.supabase_gateway import SupabaseGateway
from app.services.whatsapp_sender import (
    WhatsAppConfigurationError,
    WhatsAppDeliveryError,
    send_document_whatsapp,
)

PDF = base64.b64encode(b"%PDF-1.4 test").decode()
WORKSPACE = "00000000-0000-0000-0000-000000000001"
DOCUMENT = "00000000-0000-0000-0000-000000000002"
WEBHOOK = "https://n8n.example.com/webhook/abc"


def _request(**overrides: str) -> dict[str, str]:
    body = {
        "workspace_id": WORKSPACE,
        "document_id": DOCUMENT,
        "to_number": "98765 43210",
        "document_type": "invoice",
        "document_number": "INV-0001",
        "message": "Invoice INV-0001 from Acme.",
        "filename": "Acme_2026-10-05.pdf",
        "pdf_base64": PDF,
    }
    body.update(overrides)
    return body


@pytest.mark.parametrize(
    ("entered", "expected"),
    [
        ("9876543210", "919876543210"),
        ("098765 43210", "919876543210"),
        ("+91 98765-43210", "919876543210"),
        ("0091 9876543210", "919876543210"),
        ("+971 50 123 4567", "971501234567"),
        ("(+1) 415.555.2671", "14155552671"),
    ],
)
def test_whatsapp_number_is_normalised(entered: str, expected: str) -> None:
    request = DocumentWhatsAppRequest(**_request(to_number=entered))
    assert request.to_number == expected


@pytest.mark.parametrize(
    "entered", ["12345", "abcdefghij", "98765abcde", "+0123456789"]
)
def test_invalid_whatsapp_numbers_are_rejected(entered: str) -> None:
    with pytest.raises(ValidationError):
        DocumentWhatsAppRequest(**_request(to_number=entered))


def test_filename_is_made_a_safe_pdf_name() -> None:
    request = DocumentWhatsAppRequest(**_request(filename="../evil/name"))
    assert request.filename == ".._evil_name.pdf"


def _send_kwargs() -> dict[str, str]:
    return {
        "to_number": "919876543210",
        "message": "Invoice INV-0001",
        "filename": "invoice.pdf",
        "pdf_base64": PDF,
        "document_type": "invoice",
        "document_number": "INV-0001",
        "document_id": DOCUMENT,
        "workspace_id": WORKSPACE,
        "sent_by_user_id": "user-1",
        "sent_by_email": "owner@example.com",
    }


def _mock_webhook(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(whatsapp_sender.httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_webhook_receives_base64_pdf_and_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        seen["url"] = str(request.url)
        seen["secret"] = request.headers.get("X-ChanaX-Secret")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"success": True})

    _mock_webhook(monkeypatch, handler)
    settings = Settings(
        _env_file=None, n8n_whatsapp_webhook_url=WEBHOOK, n8n_whatsapp_secret="s3cret"
    )
    await send_document_whatsapp(settings, **_send_kwargs())

    assert seen["url"] == WEBHOOK
    assert seen["secret"] == "s3cret"
    body = seen["body"]
    assert body["event"] == "document.whatsapp"
    assert body["to"] == "919876543210"
    assert body["to_e164"] == "+919876543210"
    assert body["file"] == {
        "filename": "invoice.pdf",
        "mime_type": "application/pdf",
        "size_bytes": len(b"%PDF-1.4 test"),
        "base64": PDF,
    }
    assert body["document"] == {"type": "invoice", "number": "INV-0001", "id": DOCUMENT}
    assert body["sent_by"]["email"] == "owner@example.com"


@pytest.mark.asyncio
async def test_unconfigured_webhook_is_reported() -> None:
    with pytest.raises(WhatsAppConfigurationError):
        await send_document_whatsapp(Settings(_env_file=None), **_send_kwargs())


@pytest.mark.asyncio
async def test_non_pdf_attachment_is_rejected() -> None:
    settings = Settings(_env_file=None, n8n_whatsapp_webhook_url=WEBHOOK)
    kwargs = _send_kwargs() | {"pdf_base64": base64.b64encode(b"<html>").decode()}
    with pytest.raises(WhatsAppDeliveryError, match="not a PDF"):
        await send_document_whatsapp(settings, **kwargs)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, text="boom"),
        httpx.Response(200, json={"success": False, "error": "Number not on WhatsApp"}),
    ],
)
async def test_webhook_failures_raise(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response
) -> None:
    _mock_webhook(monkeypatch, lambda request: response)
    settings = Settings(_env_file=None, n8n_whatsapp_webhook_url=WEBHOOK)
    with pytest.raises(WhatsAppDeliveryError):
        await send_document_whatsapp(settings, **_send_kwargs())


def test_endpoint_checks_permission_and_document(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(_env_file=None, n8n_whatsapp_webhook_url=WEBHOOK)
    app.dependency_overrides[get_settings] = lambda: settings
    permission = AsyncMock()
    document = AsyncMock()
    send = AsyncMock()
    monkeypatch.setattr(
        SupabaseGateway,
        "authenticated_user",
        AsyncMock(return_value={"id": "user-1", "email": "owner@example.com"}),
    )
    monkeypatch.setattr(SupabaseGateway, "assert_workspace_permission", permission)
    monkeypatch.setattr(SupabaseGateway, "assert_workspace_document", document)
    monkeypatch.setattr("app.api.routes.documents.send_document_whatsapp", send)
    try:
        response = TestClient(app).post(
            "/api/v1/documents/document-whatsapp",
            json=_request(),
            headers={"Authorization": "Bearer token"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == status.HTTP_200_OK
    assert "+919876543210" in response.json()["message"]
    permission.assert_awaited_once_with("token", WORKSPACE, "invoices.read")
    document.assert_awaited_once_with(WORKSPACE, DOCUMENT, "invoice")
    assert send.await_args.kwargs["to_number"] == "919876543210"
    assert send.await_args.kwargs["sent_by_email"] == "owner@example.com"


def test_endpoint_uses_payslip_permission_for_payslips(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(_env_file=None, n8n_whatsapp_webhook_url=WEBHOOK)
    app.dependency_overrides[get_settings] = lambda: settings
    permission = AsyncMock()
    document = AsyncMock()
    send = AsyncMock()
    monkeypatch.setattr(
        SupabaseGateway,
        "authenticated_user",
        AsyncMock(return_value={"id": "user-1", "email": "owner@example.com"}),
    )
    monkeypatch.setattr(SupabaseGateway, "assert_workspace_permission", permission)
    monkeypatch.setattr(SupabaseGateway, "assert_workspace_document", document)
    monkeypatch.setattr("app.api.routes.documents.send_document_whatsapp", send)
    try:
        response = TestClient(app).post(
            "/api/v1/documents/document-whatsapp",
            json=_request(document_type="payslip"),
            headers={"Authorization": "Bearer token"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == status.HTTP_200_OK
    permission.assert_awaited_once_with("token", WORKSPACE, "payslips.read")
    document.assert_awaited_once_with(WORKSPACE, DOCUMENT, "payslip")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status_code", "hint"),
    [(404, "POST method"), (403, "X-ChanaX-Secret"), (500, "executions")],
)
async def test_webhook_error_names_the_cause(
    monkeypatch: pytest.MonkeyPatch, status_code: int, hint: str
) -> None:
    _mock_webhook(monkeypatch, lambda request: httpx.Response(status_code))
    settings = Settings(_env_file=None, n8n_whatsapp_webhook_url=WEBHOOK)
    with pytest.raises(WhatsAppDeliveryError, match=hint) as exc_info:
        await send_document_whatsapp(settings, **_send_kwargs())
    assert f"n8n replied {status_code}" in str(exc_info.value)
