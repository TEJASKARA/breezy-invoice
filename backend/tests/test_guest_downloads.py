from unittest.mock import AsyncMock

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.main import app
from app.services.supabase_gateway import SupabaseGateway

VISITOR = "8d3c3c1e-1111-4222-8333-944455556666"


def test_guest_download_is_recorded_with_a_hashed_visitor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = AsyncMock()
    monkeypatch.setattr(SupabaseGateway, "record_guest_download", record)

    response = TestClient(app).post(
        "/api/v1/analytics/guest-download",
        json={"visitor_id": VISITOR, "tool": "invoice"},
    )

    assert response.status_code == status.HTTP_204_NO_CONTENT
    visitor_hash, tool = record.await_args.args
    assert tool == "invoice"
    assert VISITOR not in visitor_hash and len(visitor_hash) == 64


@pytest.mark.parametrize("tool", ["", "x", "Invoice!", "a" * 41])
def test_unknown_tool_names_are_rejected(tool: str) -> None:
    response = TestClient(app).post(
        "/api/v1/analytics/guest-download",
        json={"visitor_id": VISITOR, "tool": tool},
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
