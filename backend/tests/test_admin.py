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


def test_platform_admin_access_can_use_exact_authenticated_email() -> None:
    settings = Settings(
        _env_file=None,
        platform_admin_emails="Dhanush@chanax.in,lasya@chanax.in",
    )

    assert _is_platform_admin_user(
        {"id": "other", "email": "dhanush@chanax.in"}, settings
    )
    assert not _is_platform_admin_user(
        {"id": "other", "email": "someone@chanax.in"}, settings
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
    monkeypatch.setattr(
        SupabaseGateway, "admin_analytics_exclusions", AsyncMock(return_value=[])
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


def test_workspace_search_tolerates_unnamed_workspaces() -> None:
    from app.schemas.admin import PlatformWorkspaceResponse

    workspace = PlatformWorkspaceResponse(
        workspace_id="00000000-0000-0000-0000-000000000001",
        name=None,
        subscription_code="ABC123DEF456",
        status="active",
        document_credits_remaining=None,
        quotation_credits_remaining=5,
    )
    assert workspace.name == "Unnamed workspace"
    assert workspace.document_credits_remaining == 0


def test_test_accounts_are_excluded_from_usage_report(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock

    from fastapi.testclient import TestClient

    from app.core.config import get_settings
    from app.main import app
    from app.services.supabase_gateway import SupabaseGateway

    admin_id = "00000000-0000-0000-0000-000000000001"
    tester_id = "00000000-0000-0000-0000-000000000009"
    settings = Settings(_env_file=None, platform_admin_user_ids=admin_id)
    app.dependency_overrides[get_settings] = lambda: settings
    report = AsyncMock(
        return_value={
            "since_days": 5,
            "generated_at": "2026-11-02T00:00:00+00:00",
            "scope": {"type": "platform"},
            "totals": {},
        }
    )
    monkeypatch.setattr(
        SupabaseGateway, "authenticated_user", AsyncMock(return_value={"id": admin_id})
    )
    monkeypatch.setattr(
        SupabaseGateway,
        "admin_analytics_exclusions",
        AsyncMock(return_value=[{"user_id": tester_id, "email": "qa@example.com"}]),
    )
    monkeypatch.setattr(SupabaseGateway, "admin_usage_report", report)
    try:
        response = TestClient(app).get(
            "/api/v1/admin/usage", headers={"Authorization": "Bearer token"}
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == status.HTTP_200_OK
    assert report.await_args.kwargs["excluded_user_ids"] == sorted(
        [admin_id, tester_id]
    )


def test_test_account_endpoints_require_platform_admin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock

    from fastapi.testclient import TestClient

    from app.core.config import get_settings
    from app.main import app
    from app.services.supabase_gateway import SupabaseGateway

    settings = Settings(
        _env_file=None,
        platform_admin_user_ids="00000000-0000-0000-0000-000000000001",
        platform_admin_emails="",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    add = AsyncMock()
    monkeypatch.setattr(
        SupabaseGateway,
        "authenticated_user",
        AsyncMock(return_value={"id": "00000000-0000-0000-0000-000000000002"}),
    )
    monkeypatch.setattr(SupabaseGateway, "admin_add_analytics_exclusion", add)
    try:
        client = TestClient(app)
        headers = {"Authorization": "Bearer token"}
        assert (
            client.post(
                "/api/v1/admin/analytics-exclusions",
                json={"email": "qa@example.com"},
                headers=headers,
            ).status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            client.get(
                "/api/v1/admin/analytics-exclusions", headers=headers
            ).status_code
            == status.HTTP_403_FORBIDDEN
        )
    finally:
        app.dependency_overrides.clear()
    add.assert_not_awaited()
