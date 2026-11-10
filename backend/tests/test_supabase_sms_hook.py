import base64
import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app
from app.services import supabase_sms_hook
from app.services.supabase_sms_hook import (
    HookSignatureError,
    deliver_auth_code,
    verify_signature,
)

KEY = b"super-secret-signing-key"
SECRET = "v1,whsec_" + base64.b64encode(KEY).decode()
PAYLOAD = {
    "user": {"id": "u1", "phone": "+919876543210", "email": ""},
    "sms": {"otp": "561166"},
}


def _signed(body: bytes, timestamp: int | None = None, key: bytes = KEY) -> dict:
    ts = str(int(time.time()) if timestamp is None else timestamp)
    signed = f"msg_1.{ts}.".encode() + body
    signature = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest())
    return {
        "webhook-id": "msg_1",
        "webhook-timestamp": ts,
        "webhook-signature": f"v1,{signature.decode()}",
    }


def test_valid_signature_is_accepted() -> None:
    body = json.dumps(PAYLOAD).encode()
    verify_signature(SECRET, body, _signed(body))


@pytest.mark.parametrize(
    "headers_for",
    [
        lambda body: _signed(body, key=b"wrong-key"),
        lambda body: _signed(body, timestamp=int(time.time()) - 3600),
        lambda body: {},
    ],
)
def test_forged_stale_or_unsigned_calls_are_rejected(headers_for) -> None:
    body = json.dumps(PAYLOAD).encode()
    with pytest.raises(HookSignatureError):
        verify_signature(SECRET, body, headers_for(body))


def test_missing_secret_rejects_everything() -> None:
    body = b"{}"
    with pytest.raises(HookSignatureError, match="not configured"):
        verify_signature("", body, _signed(body))


@pytest.mark.asyncio
async def test_code_goes_to_the_login_phone_via_n8n(monkeypatch) -> None:
    post = AsyncMock()
    monkeypatch.setattr(supabase_sms_hook, "post_code_to_n8n", post)
    payload = {
        "user": {**PAYLOAD["user"], "new_phone": "911111111111"},
        "sms": PAYLOAD["sms"],
    }
    await deliver_auth_code(Settings(_env_file=None), payload)
    sent = post.await_args.args[1]
    assert sent["phone"] == "919876543210"
    assert sent["phone_e164"] == "+919876543210"
    assert sent["otp"] == "561166" and sent["purpose"] == "login"


def _client(monkeypatch, post: AsyncMock) -> TestClient:
    settings = Settings(
        _env_file=None,
        supabase_sms_hook_secret=SECRET,
        n8n_otp_webhook_url="https://n8n.example.com/webhook/otp",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    monkeypatch.setattr(supabase_sms_hook, "post_code_to_n8n", post)
    return TestClient(app)


def test_endpoint_forwards_signed_requests(monkeypatch) -> None:
    post = AsyncMock()
    body = json.dumps(PAYLOAD).encode()
    try:
        response = _client(monkeypatch, post).post(
            "/api/v1/account/sms-hook", content=body, headers=_signed(body)
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {}
    post.assert_awaited_once()


def test_endpoint_rejects_unsigned_requests(monkeypatch) -> None:
    post = AsyncMock()
    try:
        response = _client(monkeypatch, post).post(
            "/api/v1/account/sms-hook", content=json.dumps(PAYLOAD).encode()
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert response.json()["error"]["http_code"] == 401
    post.assert_not_awaited()


def test_endpoint_reports_delivery_failure_to_supabase(monkeypatch) -> None:
    from app.services.phone_verification import PhoneVerificationError

    post = AsyncMock(side_effect=PhoneVerificationError("We couldn't send the code"))
    body = json.dumps(PAYLOAD).encode()
    try:
        response = _client(monkeypatch, post).post(
            "/api/v1/account/sms-hook", content=body, headers=_signed(body)
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == status.HTTP_502_BAD_GATEWAY
    assert "couldn't send" in response.json()["error"]["message"]
