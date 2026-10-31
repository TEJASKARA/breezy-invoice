from unittest.mock import AsyncMock

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.api.routes import admin as admin_routes
from app.core.config import Settings, get_settings
from app.main import app
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError

WORKSPACE = "00000000-0000-0000-0000-000000000001"
ENTITY = "00000000-0000-0000-0000-000000000002"
GSTIN = "27AAAAA0000A1Z5"
ADMIN = {"id": "admin-1", "email": "admin@chanax.in"}


def _setup(**overrides: object) -> dict[str, object]:
    setup: dict[str, object] = {
        "firmName": "Acme Traders",
        "industry": "Manufacturing",
        "hasGstin": False,
        "gstin": "",
        "mailingAddress": "Hyderabad",
        "accountType": "ca",
    }
    setup.update(overrides)
    return setup


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, frontend_url="https://chanax.in"
    )
    monkeypatch.setattr(
        SupabaseGateway, "authenticated_user", AsyncMock(return_value=ADMIN)
    )
    monkeypatch.setattr(admin_routes, "_require_platform_admin", lambda *_: None)
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_lookup_returns_setup_state(client, monkeypatch) -> None:
    target = AsyncMock(
        return_value={
            "user_id": "u1",
            "email": "user@example.com",
            "workspace_id": WORKSPACE,
            "subscription_code": "ABC123",
            "setup_completed": False,
        }
    )
    monkeypatch.setattr(SupabaseGateway, "admin_setup_target", target)
    response = client.get(
        "/api/v1/admin/user-setup?query=ABC123",
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == status.HTTP_200_OK
    assert response.json()["setup_completed"] is False
    target.assert_awaited_once_with("ABC123")


def test_unknown_user_is_404(client, monkeypatch) -> None:
    monkeypatch.setattr(
        SupabaseGateway,
        "admin_setup_target",
        AsyncMock(side_effect=SupabaseGatewayError("No user matches x@y.com.")),
    )
    response = client.get(
        "/api/v1/admin/user-setup?query=x@y.com",
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_non_admin_is_refused(monkeypatch) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
    monkeypatch.setattr(
        SupabaseGateway,
        "authenticated_user",
        AsyncMock(return_value={"id": "u", "email": "someone@example.com"}),
    )
    try:
        response = TestClient(app).get(
            "/api/v1/admin/user-setup?query=ABC123",
            headers={"Authorization": "Bearer t"},
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == status.HTTP_403_FORBIDDEN


def test_non_gst_setup_forces_founder_and_emails(client, monkeypatch) -> None:
    complete = AsyncMock(
        return_value={
            "email": "user@example.com",
            "full_name": "Ravi",
            "subscription_code": "ABC123",
        }
    )
    email = AsyncMock()
    monkeypatch.setattr(SupabaseGateway, "admin_complete_setup", complete)
    monkeypatch.setattr(admin_routes, "send_account_ready_email", email)
    response = client.post(
        "/api/v1/admin/user-setup",
        json={
            "workspace_id": WORKSPACE,
            "entity_id": ENTITY,
            "setup": _setup(),
            "entity": {"companyName": "Acme Traders", "gstin": "SHOULD-BE-CLEARED"},
        },
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == status.HTTP_200_OK, response.text
    body = response.json()
    assert body["email_sent"] is True
    kwargs = complete.await_args.kwargs
    assert kwargs["setup"]["accountType"] == "founder"
    assert kwargs["entity"]["gstin"] == ""
    assert kwargs["actor_user_id"] == "admin-1"
    assert email.await_args.kwargs["login_url"] == "https://chanax.in/login"


def test_gst_setup_verifies_for_free_credits(client, monkeypatch) -> None:
    lookup = AsyncMock(return_value=({}, True, "Acme", "Acme", "Active"))
    verify = AsyncMock(return_value=True)
    monkeypatch.setattr(admin_routes, "lookup_active_taxpayer", lookup)
    monkeypatch.setattr(
        SupabaseGateway,
        "admin_complete_setup",
        AsyncMock(return_value={"email": "user@example.com"}),
    )
    monkeypatch.setattr(SupabaseGateway, "verify_workspace_gstin", verify)
    monkeypatch.setattr(admin_routes, "send_account_ready_email", AsyncMock())
    response = client.post(
        "/api/v1/admin/user-setup",
        json={
            "workspace_id": WORKSPACE,
            "entity_id": ENTITY,
            "setup": _setup(hasGstin=True, gstin=GSTIN.lower()),
            "entity": {"companyName": "Acme"},
            "notify_user": False,
        },
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == status.HTTP_200_OK, response.text
    assert response.json()["gst_verified"] is True
    verify.assert_awaited_once_with(WORKSPACE, GSTIN)


def test_gstin_conflict_is_409(client, monkeypatch) -> None:
    monkeypatch.setattr(
        SupabaseGateway, "admin_gstin_available", AsyncMock(return_value=False)
    )
    response = client.get(
        f"/api/v1/admin/user-setup/gstin?workspace_id={WORKSPACE}&gstin={GSTIN}",
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == status.HTTP_409_CONFLICT


def test_email_failure_does_not_undo_setup(client, monkeypatch) -> None:
    from app.services.email_sender import EmailDeliveryError

    monkeypatch.setattr(
        SupabaseGateway,
        "admin_complete_setup",
        AsyncMock(return_value={"email": "user@example.com"}),
    )
    monkeypatch.setattr(
        admin_routes,
        "send_account_ready_email",
        AsyncMock(side_effect=EmailDeliveryError("down")),
    )
    response = client.post(
        "/api/v1/admin/user-setup",
        json={
            "workspace_id": WORKSPACE,
            "entity_id": ENTITY,
            "setup": _setup(),
            "entity": {"companyName": "Acme"},
        },
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == status.HTTP_200_OK
    assert response.json()["email_sent"] is False
    assert "could not be sent" in response.json()["message"]
