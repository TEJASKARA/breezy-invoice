import base64
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app
from app.services import supabase_gateway
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError

PDF = base64.b64encode(b"%PDF-1.4 test").decode()
WORKSPACE = "00000000-0000-0000-0000-000000000001"
DOCUMENT = "00000000-0000-0000-0000-000000000002"
TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"
SETTINGS = Settings(
    _env_file=None,
    supabase_url="https://db.example.com",
    supabase_service_role_key="service",
    supabase_anon_key="anon",
)


def _body(**overrides: str) -> dict[str, str]:
    body = {
        "workspace_id": WORKSPACE,
        "document_id": DOCUMENT,
        "document_type": "quotation",
        "document_number": "QTN-2026-0001",
        "sender_company_name": "Acme Private Limited",
        "filename": "Client_QTN-2026-0001_quotation.pdf",
        "pdf_base64": PDF,
    }
    body.update(overrides)
    return body


@pytest.fixture
def client():
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_creating_a_link_checks_access_and_saves_the_pdf(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    permission = AsyncMock()
    document = AsyncMock()
    save = AsyncMock(return_value=TOKEN)
    monkeypatch.setattr(
        SupabaseGateway, "authenticated_user", AsyncMock(return_value={"id": "user-1"})
    )
    monkeypatch.setattr(SupabaseGateway, "assert_workspace_permission", permission)
    monkeypatch.setattr(SupabaseGateway, "assert_workspace_document", document)
    monkeypatch.setattr(SupabaseGateway, "save_document_link", save)

    response = client.post(
        "/api/v1/documents/document-link",
        json=_body(),
        headers={"Authorization": "Bearer token"},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {"token": TOKEN}
    permission.assert_awaited_once_with("token", WORKSPACE, "invoices.read")
    document.assert_awaited_once_with(WORKSPACE, DOCUMENT, "quotation")
    kwargs = save.await_args.kwargs
    assert kwargs["pdf"] == b"%PDF-1.4 test"
    assert kwargs["created_by"] == "user-1"


def test_employee_letters_need_payroll_access(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    permission = AsyncMock()
    monkeypatch.setattr(
        SupabaseGateway, "authenticated_user", AsyncMock(return_value={"id": "user-1"})
    )
    monkeypatch.setattr(SupabaseGateway, "assert_workspace_permission", permission)
    monkeypatch.setattr(
        SupabaseGateway, "assert_workspace_employee_letter_exists", AsyncMock()
    )
    monkeypatch.setattr(
        SupabaseGateway, "save_document_link", AsyncMock(return_value=TOKEN)
    )

    response = client.post(
        "/api/v1/documents/document-link",
        json=_body(document_type="employee_letter"),
        headers={"Authorization": "Bearer token"},
    )

    assert response.status_code == status.HTTP_200_OK
    permission.assert_awaited_once_with("token", WORKSPACE, "payslips.read")


def test_only_pdfs_can_be_shared(client: TestClient) -> None:
    response = client.post(
        "/api/v1/documents/document-link",
        json=_body(pdf_base64=base64.b64encode(b"<html>").decode()),
        headers={"Authorization": "Bearer token"},
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_document_from_another_workspace_is_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        SupabaseGateway, "authenticated_user", AsyncMock(return_value={"id": "user-1"})
    )
    monkeypatch.setattr(SupabaseGateway, "assert_workspace_permission", AsyncMock())
    monkeypatch.setattr(
        SupabaseGateway,
        "assert_workspace_document",
        AsyncMock(
            side_effect=SupabaseGatewayError(
                "This document is not saved in the selected workspace."
            )
        ),
    )
    save = AsyncMock()
    monkeypatch.setattr(SupabaseGateway, "save_document_link", save)

    response = client.post(
        "/api/v1/documents/document-link",
        json=_body(),
        headers={"Authorization": "Bearer token"},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    save.assert_not_awaited()


def test_public_link_returns_view_and_download_urls(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    link = {
        "workspace_id": WORKSPACE,
        "document_type": "invoice",
        "document_id": DOCUMENT,
        "document_number": "INV-1",
        "sender_company_name": "Acme",
        "filename": "Acme_INV-1.pdf",
        "storage_path": f"{WORKSPACE}/{TOKEN}.pdf",
    }
    monkeypatch.setattr(
        SupabaseGateway, "shared_document", AsyncMock(return_value=link)
    )
    sign = AsyncMock(side_effect=["https://view", "https://download"])
    monkeypatch.setattr(SupabaseGateway, "signed_document_url", sign)

    response = client.get(f"/api/v1/documents/shared/{TOKEN}")

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["view_url"] == "https://view"
    assert response.json()["download_url"] == "https://download"
    assert sign.await_args_list[1].kwargs["download_name"] == "Acme_INV-1.pdf"


@pytest.mark.parametrize(
    "token",
    [
        "short",
        "bad token with spaces and more chars",
        "../../etc/passwd-aaaaaaaaaaaaaaaa",
    ],
)
def test_malformed_tokens_are_not_found(client: TestClient, token: str) -> None:
    assert (
        client.get(f"/api/v1/documents/shared/{token}").status_code
        == status.HTTP_404_NOT_FOUND
    )


def test_missing_or_deleted_documents_are_not_found(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        SupabaseGateway, "shared_document", AsyncMock(return_value=None)
    )
    assert (
        client.get(f"/api/v1/documents/shared/{TOKEN}").status_code
        == status.HTTP_404_NOT_FOUND
    )


def _mock_http(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(supabase_gateway.httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_sharing_again_keeps_the_same_link_and_replaces_the_pdf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=[{"token": TOKEN}])
        return httpx.Response(200, json={})

    _mock_http(monkeypatch, handler)
    token = await SupabaseGateway(SETTINGS).save_document_link(
        workspace_id=WORKSPACE,
        document_type="invoice",
        document_id=DOCUMENT,
        document_number="INV-1",
        sender_company_name="Acme",
        filename="a.pdf",
        pdf=b"%PDF-1.4 test",
        created_by="user-1",
    )

    assert token == TOKEN
    upload = seen[1]
    assert (
        upload.url.path == f"/storage/v1/object/document-links/{WORKSPACE}/{TOKEN}.pdf"
    )
    assert upload.headers["x-upsert"] == "true"
    assert upload.content == b"%PDF-1.4 test"
    row = json.loads(seen[2].content)[0]
    assert row["token"] == TOKEN and row["storage_path"] == f"{WORKSPACE}/{TOKEN}.pdf"


@pytest.mark.asyncio
async def test_download_url_asks_for_an_attachment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_http(
        monkeypatch,
        lambda request: httpx.Response(
            200, json={"signedURL": "/object/sign/document-links/x.pdf?token=t"}
        ),
    )
    url = await SupabaseGateway(SETTINGS).signed_document_url(
        "x.pdf", expires_in=60, download_name="Acme INV 1.pdf"
    )
    assert (
        url
        == "https://db.example.com/storage/v1/object/sign/document-links/x.pdf?token=t&download=Acme%20INV%201.pdf"
    )
