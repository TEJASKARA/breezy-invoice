from typing import Any

import httpx

from app.core.config import Settings


class SupabaseGatewayError(RuntimeError):
    pass


class SupabaseGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _service_headers(self) -> dict[str, str]:
        key = self.settings.supabase_service_role_key
        if not self.settings.supabase_url or not key:
            raise SupabaseGatewayError("Supabase backend credentials are missing.")
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    async def authenticated_user(self, access_token: str) -> dict[str, Any]:
        if not self.settings.supabase_url or not self.settings.supabase_anon_key:
            raise SupabaseGatewayError("Supabase authentication is not configured.")
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{self.settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={
                    "apikey": self.settings.supabase_anon_key,
                    "Authorization": f"Bearer {access_token}",
                },
            )
        if response.status_code != 200:
            raise SupabaseGatewayError("Your ChanaX session is invalid or expired.")
        payload = response.json()
        if not payload.get("id"):
            raise SupabaseGatewayError("Supabase did not return an authenticated user.")
        return payload

    async def assert_workspace_member(self, workspace_id: str, user_id: str) -> None:
        rows = await self._get(
            "breezy_workspace_members",
            {
                "select": "id",
                "workspace_id": f"eq.{workspace_id}",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "limit": "1",
            },
        )
        if not rows:
            raise SupabaseGatewayError("You do not have access to this workspace.")

    async def assert_workspace_permission(
        self, access_token: str, workspace_id: str, permission: str
    ) -> None:
        result = await self.user_rpc(
            access_token,
            "breezy_has_permission",
            {
                "target_workspace_id": workspace_id,
                "requested_permission": permission,
            },
        )
        if result is not True:
            raise SupabaseGatewayError(
                "You do not have permission to perform this action."
            )

    async def user_rpc(
        self, access_token: str, function_name: str, payload: dict[str, Any]
    ) -> Any:
        if not self.settings.supabase_url or not self.settings.supabase_anon_key:
            raise SupabaseGatewayError("Supabase authentication is not configured.")
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{self.settings.supabase_url.rstrip('/')}/rest/v1/rpc/{function_name}",
                json=payload,
                headers={
                    "apikey": self.settings.supabase_anon_key,
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
            )
        if response.is_error:
            detail = ""
            try:
                detail = str(response.json().get("message") or "")
            except (ValueError, AttributeError):
                pass
            raise SupabaseGatewayError(
                detail or f"Supabase request failed ({response.status_code})."
            )
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    async def send_auth_invitation(
        self,
        email: str,
        redirect_to: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        headers = self._service_headers()
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{self.settings.supabase_url.rstrip('/')}/auth/v1/invite",
                params={"redirect_to": redirect_to},
                json={"email": email, "data": metadata or {}},
                headers=headers,
            )
        if response.is_error:
            detail = ""
            try:
                payload = response.json()
                detail = str(
                    payload.get("msg")
                    or payload.get("message")
                    or payload.get("error_description")
                    or ""
                )
            except (ValueError, AttributeError):
                pass
            raise SupabaseGatewayError(
                detail or "Supabase could not send the invitation email."
            )

    async def cached_gstin(self, gstin: str) -> dict[str, Any] | None:
        rows = await self._get(
            "breezy_gstin_cache",
            {"select": "payload", "gstin": f"eq.{gstin}", "limit": "1"},
        )
        if not rows:
            return None
        payload = rows[0].get("payload")
        return payload if isinstance(payload, dict) else None

    async def cache_gstin(self, gstin: str, payload: dict[str, Any]) -> None:
        await self._request(
            "POST",
            "breezy_gstin_cache",
            params={"on_conflict": "gstin"},
            json=[{"gstin": gstin, "provider": "whitebooks", "payload": payload}],
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )

    async def verify_workspace_gstin(self, workspace_id: str, gstin: str) -> bool:
        rows = await self._get(
            "breezy_workspace_settings",
            {"select": "setup", "workspace_id": f"eq.{workspace_id}", "limit": "1"},
        )
        if not rows:
            return False
        setup = rows[0].get("setup")
        if not isinstance(setup, dict):
            return False
        configured = str(setup.get("gstin") or "").strip().upper()
        if configured != gstin:
            return False
        await self._request(
            "POST",
            "breezy_credit_accounts",
            params={"on_conflict": "workspace_id"},
            json=[{
                "workspace_id": workspace_id,
                "gst_status": "verified",
                "verified_gstin": gstin,
                "free_credits_granted": 30,
            }],
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        return True

    async def _get(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        response = await self._request("GET", table, params=params)
        payload = response.json()
        return payload if isinstance(payload, list) else []

    async def _request(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        request_headers = self._service_headers()
        request_headers.update(headers or {})
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.request(
                method,
                f"{self.settings.supabase_url.rstrip('/')}/rest/v1/{table}",
                params=params,
                json=json,
                headers=request_headers,
            )
        if response.is_error:
            raise SupabaseGatewayError(
                f"Supabase backend request failed ({response.status_code})."
            )
        return response
