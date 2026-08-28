import asyncio

import httpx

from app.core.config import Settings
from app.services.whitebooks import WhiteBooksClient


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
