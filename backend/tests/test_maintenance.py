from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.api.routes import maintenance
from app.main import app
from app.services.supabase_gateway import SupabaseGatewayError

client = TestClient(app)


def test_account_purge_requires_cron_secret() -> None:
    response = client.post("/api/v1/maintenance/purge-deletions")

    assert response.status_code == 401


def test_account_purge_removes_due_workspaces(monkeypatch) -> None:
    monkeypatch.setattr(
        maintenance.settings, "account_deletion_cron_secret", "test-secret"
    )
    due = AsyncMock(
        return_value=[{"workspace_id": "workspace-1", "requested_by": "owner-1"}]
    )
    delete = AsyncMock(return_value=None)
    monkeypatch.setattr(maintenance.gateway, "due_account_deletions", due)
    monkeypatch.setattr(maintenance.gateway, "permanently_delete_workspace", delete)
    cleanup = AsyncMock(return_value=2)
    monkeypatch.setattr(maintenance.gateway, "cleanup_deleted_entity_files", cleanup)

    response = client.post(
        "/api/v1/maintenance/purge-deletions",
        headers={"X-ChanaX-Cron-Secret": "test-secret"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "purged": 1,
        "workspace_ids": ["workspace-1"],
        "failures": [],
        "entity_files_cleaned": 2,
    }
    delete.assert_awaited_once_with("workspace-1", "owner-1")
    cleanup.assert_awaited_once()


def test_entity_cleanup_failure_does_not_block_account_purge(monkeypatch) -> None:
    monkeypatch.setattr(
        maintenance.settings, "account_deletion_cron_secret", "test-secret"
    )
    monkeypatch.setattr(
        maintenance.gateway, "cleanup_deleted_entity_files",
        AsyncMock(side_effect=SupabaseGatewayError("Storage unavailable")),
    )
    monkeypatch.setattr(
        maintenance.gateway, "due_account_deletions", AsyncMock(return_value=[])
    )
    response = client.post(
        "/api/v1/maintenance/purge-deletions",
        headers={"X-ChanaX-Cron-Secret": "test-secret"},
    )
    assert response.status_code == 200
    assert response.json()["failures"][0]["scope"] == "entity_files"
