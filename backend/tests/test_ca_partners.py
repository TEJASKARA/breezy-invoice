import asyncio

import pytest
from fastapi.testclient import TestClient

from app.api.routes import ca_partners
from app.core.config import Settings, get_settings
from app.main import app
from app.services import email_sender
from app.services.email_sender import EmailDeliveryError
from app.services.supabase_gateway import SupabaseGatewayError


def test_client_invitation_route_requires_authentication() -> None:
    response = TestClient(app).post(
        "/api/v1/ca-partners/client-invitations",
        json={"client_name": "Client", "email": "owner@example.com"},
    )
    assert response.status_code == 422


@pytest.mark.parametrize("delivery_failed", [False, True])
def test_invitation_returns_private_link_and_accurate_email_result(
    monkeypatch: pytest.MonkeyPatch, delivery_failed: bool
) -> None:
    captured: dict[str, object] = {}

    class Gateway:
        def __init__(self, _settings: Settings) -> None:
            pass

        async def authenticated_user(self, token: str) -> dict[str, str]:
            assert token == "test-session"
            return {"id": "ca-id"}

        async def user_rpc(
            self, token: str, name: str, args: dict[str, object]
        ) -> dict[str, object]:
            captured.update(rpc=name, args=args)
            return {
                "id": "invite-id",
                "token": "a" * 64,
                "firm_name": "Test CA",
                "email": "owner@example.com",
                "phone": None,
            }

    async def send(_settings: Settings, **kwargs: object) -> None:
        captured.update(kwargs)
        if delivery_failed:
            raise EmailDeliveryError("provider failure")

    monkeypatch.setattr(ca_partners, "SupabaseGateway", Gateway)
    monkeypatch.setattr(ca_partners, "send_ca_client_invitation_email", send)
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, frontend_url="https://chanax.in"
    )
    try:
        response = TestClient(app).post(
            "/api/v1/ca-partners/client-invitations",
            headers={"Authorization": "Bearer test-session"},
            json={"client_name": " Client ", "email": "owner@example.com"},
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["email_sent"] is not delivery_failed
    assert (
        response.json()["invitation_url"]
        == "https://chanax.in/ca-invite#token=" + "a" * 64
    )
    assert captured["rpc"] == "chanax_create_ca_client_invitation"
    assert captured["to_email"] == "owner@example.com"
    assert "provider failure" not in response.text


@pytest.mark.parametrize(
    ("error_message", "expected_status", "expected_detail"),
    [
        (
            "Only CA partner accounts can invite clients.",
            400,
            "Only CA partner accounts can invite clients.",
        ),
        (
            'column "private_column" does not exist',
            503,
            "Client invitations are temporarily unavailable.",
        ),
        (
            "Your ChanaX session is invalid or expired.",
            401,
            "Sign in again to invite a client.",
        ),
    ],
)
def test_invitation_failure_is_safe_and_does_not_send_email(
    monkeypatch: pytest.MonkeyPatch,
    error_message: str,
    expected_status: int,
    expected_detail: str,
) -> None:
    class Gateway:
        def __init__(self, _settings: Settings) -> None:
            pass

        async def authenticated_user(self, _token: str) -> dict[str, str]:
            return {"id": "owner"}

        async def user_rpc(self, *_args: object) -> None:
            raise SupabaseGatewayError(error_message)

    monkeypatch.setattr(ca_partners, "SupabaseGateway", Gateway)
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
    try:
        response = TestClient(app).post(
            "/api/v1/ca-partners/client-invitations",
            headers={"Authorization": "Bearer test-session"},
            json={"client_name": "Client", "email": "owner@example.com"},
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == expected_status
    assert response.json()["detail"] == expected_detail


def test_invitation_email_has_no_pdf_attachment(
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

        async def post(self, _url: str, **kwargs: object) -> Response:
            captured.update(kwargs)
            return Response()

    monkeypatch.setattr(email_sender.httpx, "AsyncClient", lambda **_kwargs: Client())
    settings = Settings(
        _env_file=None,
        smtp_host="smtp.resend.com",
        smtp_username="resend",
        smtp_password="test",
        smtp_from_email="mail@chanax.in",
    )
    asyncio.run(
        email_sender.send_ca_client_invitation_email(
            settings,
            to_email="owner@example.com",
            firm_name="Test CA",
            invitation_url="https://chanax.in/ca-invite#token=" + "a" * 64,
        )
    )
    payload = captured["json"]
    assert isinstance(payload, dict)
    assert "attachments" not in payload
    assert "Test CA" in payload["text"]
    assert "does not grant access" in payload["text"]
