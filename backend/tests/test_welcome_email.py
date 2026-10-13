import asyncio

import pytest
from fastapi.testclient import TestClient

from app.api.routes import account
from app.core.config import Settings, get_settings
from app.main import app
from app.services import email_sender, welcome_email
from app.services.welcome_email import deliver_welcome, welcome_content


def configured() -> Settings:
    return Settings(
        _env_file=None,
        smtp_host="smtp.resend.com",
        smtp_username="resend",
        smtp_password="test-only",
        smtp_from_email="welcome@chanax.in",
        frontend_url="https://chanax.in",
    )


@pytest.mark.parametrize(
    "kind,path",
    [
        ("ca", "/ca"),
        ("founder", "/setup"),
        ("unselected", "/setup"),
        ("employee", "/workspace"),
    ],
)
def test_welcome_has_correct_guidance_and_safe_html(kind: str, path: str) -> None:
    text, html = welcome_content(
        '<script>alert("x")</script>', kind, "https://chanax.in"
    )
    assert f"https://chanax.in{path}" in text
    assert f'href="https://chanax.in{path}"' in html
    assert "<script>" not in html
    assert "contact@azorix.com" in text
    if kind == "ca":
        assert "free ChanaX CA partner portal" in text
        assert "Each company approves" in text


@pytest.mark.parametrize("failed", [False, True])
def test_delivery_records_result_and_uses_fixed_recipient_and_key(
    monkeypatch: pytest.MonkeyPatch, failed: bool
) -> None:
    calls = []
    sent = []

    class Gateway:
        def __init__(self, _settings: Settings) -> None:
            pass

        async def service_rpc(self, name: str, payload: dict) -> object:
            calls.append((name, payload))
            if name == "chanax_claim_welcome_email":
                return {
                    "name": "New user",
                    "account_type": "ca",
                    "email": "verified@example.com",
                    "lease_token": "lease",
                }
            return True

    async def send(_settings: Settings, **kwargs: object) -> None:
        sent.append(kwargs)
        if failed:
            raise RuntimeError("Unexpected email failure")

    monkeypatch.setattr(welcome_email, "SupabaseGateway", Gateway)
    monkeypatch.setattr(welcome_email, "_send_with_resend_api", send)
    asyncio.run(deliver_welcome(configured(), "user-id"))
    assert sent[0]["to_email"] == "verified@example.com"
    assert sent[0]["idempotency_key"] == "chanax-welcome/user-id"
    assert calls[-1] == (
        "chanax_finish_welcome_email",
        {
            "target_user_id": "user-id",
            "target_lease_token": "lease",
            "delivered": not failed,
        },
    )


def test_sent_or_skipped_user_does_not_send(monkeypatch: pytest.MonkeyPatch) -> None:
    class Gateway:
        def __init__(self, _settings: Settings) -> None:
            pass

        async def service_rpc(self, _name: str, _payload: dict) -> None:
            return None

    async def unexpected_send(*_args: object, **_kwargs: object) -> None:
        pytest.fail("A duplicate welcome was attempted")

    monkeypatch.setattr(welcome_email, "SupabaseGateway", Gateway)
    monkeypatch.setattr(welcome_email, "_send_with_resend_api", unexpected_send)
    asyncio.run(deliver_welcome(configured(), "user-id"))


def test_resend_request_includes_html_and_idempotency_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    class Response:
        is_success = True

    class Client:
        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            pass

        async def post(self, _url: str, **kwargs: object) -> Response:
            captured.update(kwargs)
            return Response()

    monkeypatch.setattr(email_sender.httpx, "AsyncClient", lambda **_kw: Client())
    asyncio.run(
        email_sender._send_with_resend_api(
            configured(),
            to_email="new@example.com",
            subject="Welcome to ChanaX",
            message="Hi",
            html="<p>Hi</p>",
            idempotency_key="welcome/test",
        )
    )
    assert captured["headers"]["Idempotency-Key"] == "welcome/test"
    assert captured["json"]["html"] == "<p>Hi</p>"
    assert "attachments" not in captured["json"]


@pytest.mark.parametrize("verified", [False, True])
def test_route_authenticates_and_never_accepts_a_client_recipient(
    monkeypatch: pytest.MonkeyPatch, verified: bool
) -> None:
    queued = []

    class Gateway:
        def __init__(self, _settings: Settings) -> None:
            pass

        async def authenticated_user(self, token: str) -> dict:
            assert token == "session"
            return {
                "id": "real-user",
                "email": "verified@example.com",
                "email_confirmed_at": "2026-10-14" if verified else None,
            }

    async def deliver(_settings: Settings, user_id: str) -> None:
        queued.append(user_id)

    monkeypatch.setattr(account, "SupabaseGateway", Gateway)
    monkeypatch.setattr(account, "deliver_welcome", deliver)
    app.dependency_overrides[get_settings] = configured
    try:
        client = TestClient(app)
        assert client.post("/api/v1/account/welcome").status_code == 422
        response = client.post(
            "/api/v1/account/welcome",
            headers={"Authorization": "Bearer session"},
            json={"user_id": "someone-else", "email": "attacker@example.com"},
        )
        assert response.status_code == 202
        assert queued == (["real-user"] if verified else [])
    finally:
        app.dependency_overrides.clear()
