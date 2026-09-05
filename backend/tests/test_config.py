import asyncio

import httpx
import pytest

from app.core.config import Settings
from app.services.whitebooks import (
    GSTIN_NOT_FOUND_MESSAGE,
    GSTIN_TEMPORARILY_UNAVAILABLE_MESSAGE,
    WhiteBooksClient,
    WhiteBooksRequestError,
)


def test_razorpay_requires_all_backend_secrets() -> None:
    incomplete = Settings(_env_file=None, razorpay_key_id="rzp_test_key")
    complete = Settings(
        _env_file=None,
        razorpay_key_id="rzp_test_key",
        razorpay_key_secret="secret",
        razorpay_webhook_secret="webhook-secret",
    )

    assert incomplete.razorpay_is_configured is False
    assert complete.razorpay_is_configured is True


def test_platform_admin_ids_are_normalized_and_exact() -> None:
    settings = Settings(
        _env_file=None,
        platform_admin_user_ids=" USER-ONE ,user-two, ",
    )

    assert settings.is_platform_admin("user-one") is True
    assert settings.is_platform_admin("USER-TWO") is True
    assert settings.is_platform_admin("user") is False


def test_whitebooks_uses_public_taxpayer_search_contract() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/public/search"
        assert request.url.params["email"] == "developer@example.com"
        assert request.url.params["gstin"] == "29AAAAA0000A1Z5"
        assert request.headers["client_id"] == "client-id"
        assert request.headers["client_secret"] == "client-secret"
        assert "authorization" not in request.headers
        return httpx.Response(
            200,
            json={
                "status_cd": "1",
                "data": '{"lgnm":"Example Private Limited","sts":"Active"}',
            },
        )

    settings = Settings(
        _env_file=None,
        whitebooks_client_id="client-id",
        whitebooks_client_secret="client-secret",
        whitebooks_email="developer@example.com",
    )
    client = WhiteBooksClient(settings, transport=httpx.MockTransport(handler))

    result = asyncio.run(client.verify_gstin("29AAAAA0000A1Z5"))

    assert result["data"]["lgnm"] == "Example Private Limited"


def test_whitebooks_maps_taxpayer_search_failure_to_clear_not_found_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "status_cd": "0",
                "status_desc": "Public API Search Taxpayer Failed",
            },
        )

    settings = Settings(
        _env_file=None,
        whitebooks_client_id="client-id",
        whitebooks_client_secret="client-secret",
        whitebooks_email="developer@example.com",
    )
    client = WhiteBooksClient(settings, transport=httpx.MockTransport(handler))

    with pytest.raises(WhiteBooksRequestError) as exc_info:
        asyncio.run(client.verify_gstin("29AAAAA0000A1Z5"))

    assert exc_info.value.status_code == 404
    assert str(exc_info.value) == GSTIN_NOT_FOUND_MESSAGE
    assert "WhiteBooks" not in str(exc_info.value)


def test_whitebooks_hides_other_provider_failures_from_customers() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={"status_desc": "Invalid client credentials"},
        )

    settings = Settings(
        _env_file=None,
        whitebooks_client_id="client-id",
        whitebooks_client_secret="client-secret",
        whitebooks_email="developer@example.com",
    )
    client = WhiteBooksClient(settings, transport=httpx.MockTransport(handler))

    with pytest.raises(WhiteBooksRequestError) as exc_info:
        asyncio.run(client.verify_gstin("29AAAAA0000A1Z5"))

    assert exc_info.value.status_code == 502
    assert str(exc_info.value) == GSTIN_TEMPORARILY_UNAVAILABLE_MESSAGE
    assert "credentials" not in str(exc_info.value).lower()
