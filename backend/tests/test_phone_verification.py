import json
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app
from app.services import phone_verification
from app.services.phone_verification import (
    PhoneVerificationError,
    PhoneVerificationUnavailable,
    check_verification_code,
    code_hash,
    new_code,
    send_verification_code,
)
from app.services.supabase_gateway import SupabaseGateway

USER = "00000000-0000-0000-0000-00000000000a"
WEBHOOK = "https://n8n.example.com/webhook/otp"


def _settings(**overrides: str) -> Settings:
    values = {
        "n8n_otp_webhook_url": WEBHOOK,
        "n8n_otp_secret": "otp-secret",
        "supabase_service_role_key": "service",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_codes_are_six_random_digits_and_hashed_with_a_key() -> None:
    codes = {new_code() for _ in range(200)}
    assert all(len(code) == 6 and code.isdigit() for code in codes)
    assert len(codes) > 150
    settings = _settings()
    digest = code_hash(settings, USER, "919876543210", "123456")
    assert digest == code_hash(settings, USER, "919876543210", " 123456 ")
    assert digest != code_hash(settings, USER, "919876543211", "123456")
    other = _settings(n8n_otp_secret="other")
    assert digest != code_hash(other, USER, "919876543210", "123456")
    assert "123456" not in digest


def _mock_webhook(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(phone_verification.httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_send_stores_hash_then_posts_otp_and_number(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rpc = AsyncMock(return_value={"id": "row"})
    monkeypatch.setattr(SupabaseGateway, "service_rpc", rpc)
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["secret"] = request.headers.get("X-ChanaX-Secret")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True})

    _mock_webhook(monkeypatch, handler)
    settings = _settings()
    await send_verification_code(
        settings, user_id=USER, email="a@x.in", phone="919876543210"
    )

    name, args = rpc.await_args.args
    assert name == "breezy_phone_otp_create"
    body = seen["body"]
    assert seen["url"] == WEBHOOK and seen["secret"] == "otp-secret"
    assert body["phone"] == "919876543210" and body["phone_e164"] == "+919876543210"
    assert len(body["otp"]) == 6 and body["expires_in_minutes"] == 10
    assert args["target_code_hash"] == code_hash(
        settings, USER, "919876543210", body["otp"]
    )
    assert body["otp"] not in json.dumps(args)


@pytest.mark.asyncio
async def test_send_requires_configuration_and_reports_webhook_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(PhoneVerificationUnavailable):
        await send_verification_code(
            _settings(n8n_otp_webhook_url=""), user_id=USER, email="", phone="91"
        )
    monkeypatch.setattr(SupabaseGateway, "service_rpc", AsyncMock(return_value={}))
    _mock_webhook(monkeypatch, lambda request: httpx.Response(403))
    with pytest.raises(PhoneVerificationError, match="couldn't send"):
        await send_verification_code(
            _settings(), user_id=USER, email="", phone="919876543210"
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("result", "message"),
    [
        ({"verified": False, "reason": "mismatch", "attempts_left": 3}, "3 attempts"),
        ({"verified": False, "reason": "mismatch", "attempts_left": 0}, "new code"),
        ({"verified": False, "reason": "locked"}, "Too many"),
        ({"verified": False, "reason": "expired"}, "expired"),
    ],
)
async def test_failed_checks_explain_why(
    monkeypatch: pytest.MonkeyPatch, result: dict, message: str
) -> None:
    monkeypatch.setattr(SupabaseGateway, "service_rpc", AsyncMock(return_value=result))
    with pytest.raises(PhoneVerificationError, match=message):
        await check_verification_code(
            _settings(), user_id=USER, phone="919876543210", code="000000"
        )


def test_endpoints_normalise_the_number_and_require_sign_in(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings()
    app.dependency_overrides[get_settings] = lambda: settings
    send = AsyncMock()
    verify = AsyncMock(return_value={"verified": True, "phone": "+919876543210"})
    monkeypatch.setattr(
        SupabaseGateway,
        "authenticated_user",
        AsyncMock(return_value={"id": USER, "email": "a@x.in"}),
    )
    monkeypatch.setattr("app.api.routes.account.send_verification_code", send)
    monkeypatch.setattr("app.api.routes.account.check_verification_code", verify)
    headers = {"Authorization": "Bearer token"}
    try:
        client = TestClient(app)
        sent = client.post(
            "/api/v1/account/phone/send-code",
            json={"phone": "098765 43210"},
            headers=headers,
        )
        checked = client.post(
            "/api/v1/account/phone/verify",
            json={"phone": "+91 98765-43210", "code": " 123456 "},
            headers=headers,
        )
        bad_code = client.post(
            "/api/v1/account/phone/verify",
            json={"phone": "+919876543210", "code": "12ab56"},
            headers=headers,
        )
        no_auth = client.post(
            "/api/v1/account/phone/send-code", json={"phone": "9876543210"}
        )
    finally:
        app.dependency_overrides.clear()

    assert sent.status_code == status.HTTP_200_OK
    assert send.await_args.kwargs["phone"] == "919876543210"
    assert checked.status_code == status.HTTP_200_OK
    assert checked.json() == {"phone": "+919876543210"}
    assert verify.await_args.kwargs["code"] == "123456"
    assert bad_code.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert no_auth.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
