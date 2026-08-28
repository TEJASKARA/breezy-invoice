import json
from functools import lru_cache
from typing import Any

import httpx

from app.core.config import Settings


class WhiteBooksConfigurationError(RuntimeError):
    pass


class WhiteBooksRequestError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class WhiteBooksClient:
    """Client for WhiteBooks' credential-authenticated taxpayer search API."""

    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.transport = transport

    async def verify_gstin(self, gstin: str) -> dict[str, Any]:
        if not self.settings.whitebooks_is_configured:
            raise WhiteBooksConfigurationError(
                "WhiteBooks production credentials and account email have not "
                "been configured."
            )

        url = (
            f"{self.settings.whitebooks_base_url.rstrip('/')}"
            f"{self.settings.whitebooks_gstin_path}"
        )
        try:
            async with httpx.AsyncClient(
                timeout=self.settings.whitebooks_timeout_seconds,
                transport=self.transport,
            ) as client:
                response = await client.get(
                    url,
                    params={
                        "email": self.settings.whitebooks_email,
                        "gstin": gstin,
                    },
                    headers={
                        "client_id": self.settings.whitebooks_client_id,
                        "client_secret": self.settings.whitebooks_client_secret,
                        "Accept": "application/json",
                    },
                )
        except httpx.TimeoutException as exc:
            raise WhiteBooksRequestError(
                "WhiteBooks GSTIN verification timed out.", status_code=504
            ) from exc
        except httpx.HTTPError as exc:
            raise WhiteBooksRequestError(
                "ChanaX could not reach WhiteBooks GSTIN verification."
            ) from exc

        if response.is_error:
            raise WhiteBooksRequestError(
                _response_error(
                    response, "WhiteBooks rejected the GSTIN verification request."
                ),
                status_code=response.status_code,
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise WhiteBooksRequestError(
                "WhiteBooks returned an invalid response."
            ) from exc
        if not isinstance(payload, dict):
            raise WhiteBooksRequestError("WhiteBooks returned an invalid response.")
        if str(payload.get("status_cd") or "") == "0":
            raise WhiteBooksRequestError(
                _payload_error(
                    payload, "WhiteBooks rejected the GSTIN verification request."
                )
            )
        return _decode_data(payload)


@lru_cache
def get_whitebooks_client() -> WhiteBooksClient:
    from app.core.config import get_settings

    return WhiteBooksClient(get_settings())


def _decode_data(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data")
    if not isinstance(data, str):
        return payload
    try:
        decoded = json.loads(data)
    except ValueError:
        return payload
    if isinstance(decoded, dict):
        return {**payload, "data": decoded}
    return payload


def _payload_error(payload: dict[str, Any], fallback: str) -> str:
    for key in ("status_desc", "message", "error_description", "detail"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    error = payload.get("error")
    if isinstance(error, dict):
        for key in ("message", "desc", "error_cd"):
            value = error.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return fallback


def _response_error(response: httpx.Response, fallback: str) -> str:
    try:
        payload = response.json()
    except ValueError:
        return fallback
    return _payload_error(payload, fallback) if isinstance(payload, dict) else fallback
