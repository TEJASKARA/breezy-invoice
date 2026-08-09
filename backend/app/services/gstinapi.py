from typing import Any

import httpx

from app.core.config import Settings


class GstinApiConfigurationError(RuntimeError):
    pass


class GstinApiRequestError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class GstinApiClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def verify_gstin(self, gstin: str) -> dict[str, Any]:
        if not self.settings.gstinapi_is_configured:
            raise GstinApiConfigurationError(
                "GSTINAPI credentials have not been configured."
            )

        url = (
            f"{self.settings.gstinapi_base_url.rstrip('/')}/v1/gstin/{gstin}"
        )
        try:
            async with httpx.AsyncClient(
                timeout=self.settings.gstinapi_timeout_seconds
            ) as client:
                response = await client.get(
                    url,
                    headers={"x-api-key": self.settings.gstinapi_key},
                )
        except httpx.TimeoutException as exc:
            raise GstinApiRequestError(
                "GSTINAPI did not respond within the configured timeout.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise GstinApiRequestError(
                "BreezyInvoice could not reach GSTINAPI."
            ) from exc

        if response.is_error:
            detail = "GSTINAPI rejected the GSTIN verification request."
            try:
                payload = response.json()
                detail = (
                    payload.get("message")
                    or payload.get("error")
                    or payload.get("detail")
                    or detail
                )
            except (ValueError, AttributeError):
                pass
            raise GstinApiRequestError(detail, status_code=response.status_code)

        return response.json()
