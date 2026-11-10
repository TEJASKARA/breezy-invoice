import json
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app
from app.services import phone_verification, supabase_gateway
from app.services.phone_verification import (
    PhoneVerificationError,
    code_hash,
    send_login_code,
    sign_in_with_code,
)
from app.services.supabase_gateway import SupabaseGateway

USER = "00000000-0000-0000-0000-00000000000a"
PHONE = "919876543210"
WEBHOOK = "https://n8n.example.com/webhook/otp"
ACCOUNT = {"matches": 1, "user_id": USER, "email": "owner@x.in"}


def _settings(**overrides: str) -> Settings:
    values = {
        "n8n_otp_webhook_url": WEBHOOK,
        "n8n_otp_secret": "otp-secret",
        "supabase_service_role_key": "service",
        "supabase_url": "https://project.supabase.co",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def _rpc(responses: dict[str, object]) -> AsyncMock:
    calls: list[tuple[str, dict]] = []

    async def call(name: str, payload: dict) -> object:
        calls.append((name, payload))
        return responses[name]

    mock = AsyncMock(side_effect=call)
    mock.calls = calls  # type: ignore[attr-defined]
    return mock


def _mock_http(monkeypatch: pytest.MonkeyPatch, module, handler) -> None:
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(module.httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_login_code_goes_to_the_verified_account(monkeypatch) -> None:
    rpc = _rpc(
        {"breezy_phone_login_account": ACCOUNT, "breezy_phone_login_otp_create": {}}
    )
    monkeypatch.setattr(SupabaseGateway, "service_rpc", rpc)
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200)

    _mock_http(monkeypatch, phone_verification, handler)
    settings = _settings()
    await send_login_code(settings, phone=PHONE)

    names = [name for name, _ in rpc.calls]
    assert names == ["breezy_phone_login_account", "breezy_phone_login_otp_create"]
    stored = rpc.calls[1][1]
    body = seen["body"]
    assert body["purpose"] == "login" and body["phone"] == PHONE
    assert stored["target_user_id"] == USER
    assert stored["target_code_hash"] == code_hash(settings, USER, PHONE, body["otp"])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("account", "message"),
    [
        ({"matches": 0}, "No ChanaX account"),
        ({"matches": 2}, "more than one account"),
    ],
)
async def test_unknown_or_shared_numbers_get_no_code(
    monkeypatch, account, message
) -> None:
    rpc = _rpc({"breezy_phone_login_account": account})
    monkeypatch.setattr(SupabaseGateway, "service_rpc", rpc)
    with pytest.raises(PhoneVerificationError, match=message):
        await send_login_code(_settings(), phone=PHONE)
    assert [name for name, _ in rpc.calls] == ["breezy_phone_login_account"]


@pytest.mark.asyncio
async def test_correct_code_returns_a_sign_in_token(monkeypatch) -> None:
    rpc = _rpc(
        {
            "breezy_phone_login_account": ACCOUNT,
            "breezy_phone_login_otp_verify": {"verified": True},
        }
    )
    monkeypatch.setattr(SupabaseGateway, "service_rpc", rpc)
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"properties": {"hashed_token": "tok123"}})

    _mock_http(monkeypatch, supabase_gateway, handler)
    token = await sign_in_with_code(_settings(), phone=PHONE, code="123456")

    assert token == "tok123"
    assert seen["url"].endswith("/auth/v1/admin/generate_link")
    assert seen["body"] == {"type": "magiclink", "email": "owner@x.in"}


@pytest.mark.asyncio
async def test_wrong_code_never_creates_a_session(monkeypatch) -> None:
    rpc = _rpc(
        {
            "breezy_phone_login_account": ACCOUNT,
            "breezy_phone_login_otp_verify": {
                "verified": False,
                "reason": "mismatch",
                "attempts_left": 2,
            },
        }
    )
    monkeypatch.setattr(SupabaseGateway, "service_rpc", rpc)
    token = AsyncMock()
    monkeypatch.setattr(SupabaseGateway, "create_sign_in_token", token)
    with pytest.raises(PhoneVerificationError, match="2 attempts"):
        await sign_in_with_code(_settings(), phone=PHONE, code="000000")
    token.assert_not_awaited()


def test_login_endpoints_work_signed_out(monkeypatch) -> None:
    app.dependency_overrides[get_settings] = lambda: _settings()
    send = AsyncMock()
    sign_in = AsyncMock(return_value="tok123")
    monkeypatch.setattr("app.api.routes.account.send_login_code", send)
    monkeypatch.setattr("app.api.routes.account.sign_in_with_code", sign_in)
    try:
        client = TestClient(app)
        sent = client.post(
            "/api/v1/account/phone-login/send-code", json={"phone": "98765 43210"}
        )
        verified = client.post(
            "/api/v1/account/phone-login/verify",
            json={"phone": "+91 98765 43210", "code": "123456"},
        )
    finally:
        app.dependency_overrides.clear()
    assert sent.status_code == status.HTTP_200_OK
    assert send.await_args.kwargs["phone"] == PHONE
    assert verified.json() == {"token_hash": "tok123"}
    assert sign_in.await_args.kwargs == {"phone": PHONE, "code": "123456"}


def test_login_errors_are_shown_to_the_user(monkeypatch) -> None:
    app.dependency_overrides[get_settings] = lambda: _settings()
    monkeypatch.setattr(
        "app.api.routes.account.send_login_code",
        AsyncMock(side_effect=PhoneVerificationError("No ChanaX account has this")),
    )
    try:
        response = TestClient(app).post(
            "/api/v1/account/phone-login/send-code", json={"phone": "9876543210"}
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "No ChanaX account" in response.json()["detail"]
