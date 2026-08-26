import asyncio
import time
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
    """Small OAuth client for WhiteBooks' production GST API."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._access_token = ""
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()

    async def _token(self) -> str:
        if self._access_token and time.monotonic() < self._token_expires_at:
            return self._access_token
        async with self._token_lock:
            if self._access_token and time.monotonic() < self._token_expires_at:
                return self._access_token
            if not self.settings.whitebooks_is_configured:
                raise WhiteBooksConfigurationError(
                    "WhiteBooks production credentials have not been configured."
                )
            url = (
                f"{self.settings.whitebooks_base_url.rstrip('/')}"
                f"{self.settings.whitebooks_token_path}"
            )
            try:
                async with httpx.AsyncClient(
                    timeout=self.settings.whitebooks_timeout_seconds
                ) as client:
                    response = await client.post(
                        url,
                        json={
                            "grant_type": "client_credentials",
                            "client_id": self.settings.whitebooks_client_id,
                            "client_secret": self.settings.whitebooks_client_secret,
                        },
                        headers={"Accept": "application/json"},
                    )
            except httpx.TimeoutException as exc:
                raise WhiteBooksRequestError(
                    "WhiteBooks authentication timed out.", status_code=504
                ) from exc
            except httpx.HTTPError as exc:
                raise WhiteBooksRequestError(
                    "ChanaX could not reach WhiteBooks authentication."
                ) from exc
            if response.is_error:
                raise WhiteBooksRequestError(
                    _response_error(response, "WhiteBooks authentication failed."),
                    status_code=502,
                )
            payload = response.json()
            token = str(payload.get("access_token") or "")
            if not token:
                raise WhiteBooksRequestError(
                    "WhiteBooks did not return an access token."
                )
            expires_in = max(60, int(payload.get("expires_in") or 3600))
            self._access_token = token
            refresh_margin = min(60, expires_in // 4)
            self._token_expires_at = time.monotonic() + expires_in - refresh_margin
            return token

    async def verify_gstin(self, gstin: str) -> dict[str, Any]:
        token = await self._token()
        path = self.settings.whitebooks_gstin_path.format(gstin=gstin)
        url = f"{self.settings.whitebooks_base_url.rstrip('/')}{path}"
        try:
            async with httpx.AsyncClient(
                timeout=self.settings.whitebooks_timeout_seconds
            ) as client:
                response = await client.get(
                    url,
                    headers={
                        "Authorization": f"Bearer {token}",
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
        if response.status_code == 401:
            self._access_token = ""
            self._token_expires_at = 0
        if response.is_error:
            raise WhiteBooksRequestError(
                _response_error(
                    response, "WhiteBooks rejected the GSTIN verification request."
                ),
                status_code=response.status_code,
            )
        payload = response.json()
        return payload if isinstance(payload, dict) else {"result": payload}


@lru_cache
def get_whitebooks_client() -> WhiteBooksClient:
    """Keep one client per API process so OAuth tokens are reused until expiry."""
    from app.core.config import get_settings

    return WhiteBooksClient(get_settings())


def _response_error(response: httpx.Response, fallback: str) -> str:
    try:
        payload = response.json()
    except ValueError:
        return fallback
    if isinstance(payload, dict):
        for key in ("message", "error_description", "error", "detail"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return fallback
