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

    confirmed = "2026-11-01T00:00:00Z"
    assert _is_platform_admin_user(
        {"id": "other", "email": "dhanush@chanax.in", "email_confirmed_at": confirmed},
        settings,
    )
    assert not _is_platform_admin_user(
        {"id": "other", "email": "someone@chanax.in", "email_confirmed_at": confirmed},
        settings,
    )


def test_unconfirmed_email_never_grants_platform_admin() -> None:
    settings = Settings(_env_file=None, platform_admin_emails="dhanush@chanax.in")

    assert not _is_platform_admin_user(
        {"id": "other", "email": "dhanush@chanax.in"}, settings
    )
    assert not _is_platform_admin_user(
        {"id": "other", "email": "dhanush@chanax.in", "email_confirmed_at": None},
        settings,
    )


def test_unconfirmed_email_is_not_the_purge_approver() -> None:
    from app.api.routes.admin import _verified_email

    settings = Settings(_env_file=None, purge_approver_email="rushi@chanax.in")

    assert not settings.is_purge_approver(_verified_email({"email": "rushi@chanax.in"}))
    assert settings.is_purge_approver(
        _verified_email(
            {"email": "rushi@chanax.in", "email_confirmed_at": "2026-11-01T00:00:00Z"}
        )
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


def test_marketing_import_validates_and_attributes_upload(
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
    importer = AsyncMock(
        return_value={"upload_id": "u-1", "inserted": 1, "already_contacted": 0}
    )
    monkeypatch.setattr(
        SupabaseGateway,
        "authenticated_user",
        AsyncMock(return_value={"id": admin_id, "email": "rushi@chanax.in"}),
    )
    monkeypatch.setattr(SupabaseGateway, "admin_marketing_import", importer)
    body = {
        "source": "gst",
        "file_name": "2026-10-31_GST.xlsx",
        "total_rows": 2,
        "duplicate_in_file": 1,
        "leads": [
            {
                "email": " Kaseemmd56@Gmail.com ",
                "contact_name": "Md Kaseem",
                "registered_on": "2026-10-31",
                "details": {"business_type": "REG"},
            }
        ],
    }
    try:
        client = TestClient(app)
        headers = {"Authorization": "Bearer token"}
        ok = client.post("/api/v1/admin/marketing/import", json=body, headers=headers)
        bad = client.post(
            "/api/v1/admin/marketing/import",
            json={**body, "leads": [{"email": "not-an-email"}]},
            headers=headers,
        )
    finally:
        app.dependency_overrides.clear()

    assert ok.status_code == status.HTTP_200_OK
    assert ok.json()["inserted"] == 1
    kwargs = importer.await_args.kwargs
    assert kwargs["leads"][0]["email"] == "kaseemmd56@gmail.com"
    assert kwargs["upload"]["uploaded_by_email"] == "rushi@chanax.in"
    assert kwargs["upload"]["duplicate_in_file"] == 1
    assert bad.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert importer.await_count == 1


def test_test_accounts_can_be_phone_only() -> None:
    from app.schemas.admin import AnalyticsExclusion, AnalyticsExclusionCreate

    account = AnalyticsExclusion(
        user_id="00000000-0000-0000-0000-000000000003", phone="919876543210"
    )
    assert account.email is None and account.phone == "919876543210"
    assert AnalyticsExclusionCreate(email="+91 98765 43210").email == "+91 98765 43210"


ADMIN_ID = "00000000-0000-0000-0000-0000000000aa"


def test_admin_routes_need_mfa_when_required() -> None:
    settings = Settings(
        _env_file=None, platform_admin_user_ids=ADMIN_ID, admin_require_mfa=True
    )

    with pytest.raises(HTTPException) as blocked:
        _require_platform_admin({"id": ADMIN_ID, "_aal": "aal1"}, settings)
    assert blocked.value.status_code == status.HTTP_403_FORBIDDEN
    assert "Multi-factor" in blocked.value.detail

    _require_platform_admin({"id": ADMIN_ID, "_aal": "aal2"}, settings)


def test_mfa_is_not_enforced_until_switched_on() -> None:
    settings = Settings(_env_file=None, platform_admin_user_ids=ADMIN_ID)

    _require_platform_admin({"id": ADMIN_ID, "_aal": "aal1"}, settings)


def test_token_assurance_level_is_read_from_the_token() -> None:
    import base64
    import json

    from app.services.supabase_gateway import _token_assurance_level

    def part(value: object) -> str:
        raw = json.dumps(value).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    def token(**claims: str) -> str:
        return f"{part({'alg': 'HS256'})}.{part({'sub': 'u', **claims})}.signature"

    assert _token_assurance_level(token(aal="aal2")) == "aal2"
    assert _token_assurance_level(token(aal="aal1")) == "aal1"
    assert _token_assurance_level(token()) == "aal1"
    assert _token_assurance_level("not-a-token") == "aal1"
    assert _token_assurance_level("a.@@@.c") == "aal1"
    assert _token_assurance_level(f"a.{part(['aal2'])}.c") == "aal1"


def test_admin_route_rejects_aal1_token_and_accepts_aal2(monkeypatch) -> None:
    from unittest.mock import AsyncMock

    from fastapi.testclient import TestClient

    from app.core.config import get_settings
    from app.main import app
    from app.services.supabase_gateway import SupabaseGateway

    settings = Settings(
        _env_file=None, platform_admin_user_ids=ADMIN_ID, admin_require_mfa=True
    )
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        client = TestClient(app)
        headers = {"Authorization": "Bearer test-token"}

        monkeypatch.setattr(
            SupabaseGateway,
            "authenticated_user",
            AsyncMock(return_value={"id": ADMIN_ID, "_aal": "aal1"}),
        )
        blocked = client.get("/api/v1/admin/workspaces?query=abc", headers=headers)
        me = client.get("/api/v1/admin/me", headers=headers)

        monkeypatch.setattr(
            SupabaseGateway,
            "authenticated_user",
            AsyncMock(return_value={"id": ADMIN_ID, "_aal": "aal2"}),
        )
        me_mfa = client.get("/api/v1/admin/me", headers=headers)
    finally:
        app.dependency_overrides.clear()

    assert blocked.status_code == 403
    assert me.json() == {"is_super_admin": True, "mfa_required": True}
    assert me_mfa.json() == {"is_super_admin": True, "mfa_required": False}
