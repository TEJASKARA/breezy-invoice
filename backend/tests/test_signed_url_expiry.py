from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.api.routes.documents import SHARED_LINK_EXPIRY_SECONDS
from app.core.config import Settings, get_settings
from app.main import app
from app.services.supabase_gateway import SupabaseGateway

TOKEN = "t" * 32


def test_signed_urls_last_at_most_one_hour(monkeypatch) -> None:
    assert SHARED_LINK_EXPIRY_SECONDS <= 60 * 60

    link = {
        "storage_path": "ws/t.pdf",
        "filename": "a.pdf",
        "document_type": "invoice",
        "document_number": "1",
        "sender_company_name": "Acme",
    }
    monkeypatch.setattr(
        SupabaseGateway, "shared_document", AsyncMock(return_value=link)
    )
    signer = AsyncMock(return_value="https://example.test/signed")
    monkeypatch.setattr(SupabaseGateway, "signed_document_url", signer)
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
    try:
        response = TestClient(app).get(f"/api/v1/documents/shared/{TOKEN}")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    # View and download URLs are both short-lived, minted fresh on every visit.
    assert signer.await_count == 2
    assert all(call.kwargs["expires_in"] <= 60 * 60 for call in signer.await_args_list)


def test_unknown_or_malformed_tokens_get_no_signed_url(monkeypatch) -> None:
    signer = AsyncMock()
    monkeypatch.setattr(SupabaseGateway, "signed_document_url", signer)
    monkeypatch.setattr(
        SupabaseGateway, "shared_document", AsyncMock(return_value=None)
    )
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
    try:
        client = TestClient(app)
        assert client.get("/api/v1/documents/shared/short").status_code == 404
        assert client.get(f"/api/v1/documents/shared/{TOKEN}").status_code == 404
    finally:
        app.dependency_overrides.clear()

    assert signer.await_count == 0
