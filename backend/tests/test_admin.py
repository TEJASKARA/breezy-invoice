import pytest
from fastapi import HTTPException, status

from app.api.routes.admin import _is_platform_admin_user, _require_platform_admin
from app.core.config import Settings


def test_platform_admin_access_uses_authenticated_user_id() -> None:
    settings = Settings(
        _env_file=None,
        platform_admin_user_ids="00000000-0000-0000-0000-000000000001",
    )

    assert _is_platform_admin_user(
        {"id": "00000000-0000-0000-0000-000000000001"}, settings
    )
    assert not _is_platform_admin_user(
        {"id": "00000000-0000-0000-0000-000000000002"}, settings
    )


def test_non_platform_admin_is_rejected() -> None:
    settings = Settings(
        _env_file=None,
        platform_admin_user_ids="00000000-0000-0000-0000-000000000001",
    )

    with pytest.raises(HTTPException) as exc_info:
        _require_platform_admin(
            {"id": "00000000-0000-0000-0000-000000000002"}, settings
        )

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN


def test_usage_report_is_restricted_to_platform_admins(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock

    from fastapi.testclient import TestClient

    from app.core.config import get_settings
    from app.main import app
    from app.services.supabase_gateway import SupabaseGateway

    admin_id = "00000000-0000-0000-0000-000000000001"
    settings = Settings(_env_file=None, platform_admin_user_ids=admin_id)
    app.dependency_overrides[get_settings] = lambda: settings
    report = {
        "since_days": 30,
        "generated_at": "2026-09-26T00:00:00+00:00",
        "scope": {"type": "platform"},
        "totals": {"page_views": 3},
    }
    monkeypatch.setattr(
        SupabaseGateway, "admin_usage_report", AsyncMock(return_value=report)
    )
    try:
        client = TestClient(app)
        monkeypatch.setattr(
            SupabaseGateway,
            "authenticated_user",
            AsyncMock(return_value={"id": "00000000-0000-0000-0000-000000000002"}),
        )
        denied = client.get(
            "/api/v1/admin/usage", headers={"Authorization": "Bearer token"}
        )
        assert denied.status_code == status.HTTP_403_FORBIDDEN

        monkeypatch.setattr(
            SupabaseGateway,
            "authenticated_user",
            AsyncMock(return_value={"id": admin_id}),
        )
        allowed = client.get(
            "/api/v1/admin/usage?days=30", headers={"Authorization": "Bearer token"}
        )
        assert allowed.status_code == status.HTTP_200_OK
        assert allowed.json()["totals"]["page_views"] == 3
    finally:
        app.dependency_overrides.clear()
