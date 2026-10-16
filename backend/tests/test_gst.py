from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.api.routes import gst
from app.api.routes.gst import (
    _address,
    _invalid_payload_message,
    _is_active_registration,
    _taxpayer_details,
)
from app.main import app
from app.services.supabase_gateway import (
    GstRegistrationConflict,
    GstVerificationUnavailable,
)

client = TestClient(app)


@pytest.mark.parametrize(
    "failure,status_code",
    [
        (None, 200),
        (
            GstRegistrationConflict(
                "This GSTIN belongs to your workspace “Aakash Reddy”. "
                "Select that workspace before adding this entity."
            ),
            409,
        ),
        (
            GstVerificationUnavailable(
                "GST verification is temporarily unavailable. Please try again."
            ),
            503,
        ),
    ],
)
def test_gst_request_keeps_workspace_context_and_distinguishes_errors(
    monkeypatch, failure, status_code
):
    workspace_id = "b3940750-7667-4b6c-98b8-5de31d267e24"
    gateway = SimpleNamespace(
        authenticated_user=AsyncMock(return_value={"id": "owner-id"}),
        assert_workspace_permission=AsyncMock(),
        assert_gstin_available=AsyncMock(side_effect=failure),
        cached_gstin=AsyncMock(
            return_value={"data": {"lgnm": "Company", "sts": "Active"}}
        ),
        verify_workspace_gstin=AsyncMock(return_value=True),
    )
    monkeypatch.setattr(gst, "SupabaseGateway", lambda _settings: gateway)
    response = client.get(
        "/api/v1/gst/verify",
        params={"gstin": "36ACJFA4386L1ZW", "workspace_id": workspace_id},
        headers={"Authorization": "Bearer token"},
    )
    assert response.status_code == status_code
    assert response.headers["Cache-Control"] == "private, no-store"
    gateway.assert_gstin_available.assert_awaited_once_with(
        "token", workspace_id, "36ACJFA4386L1ZW", user_id="owner-id"
    )
    if status_code == 200:
        assert response.json()["workspace_id"] == workspace_id
    else:
        gateway.cached_gstin.assert_not_awaited()


def test_rejects_invalid_gstin() -> None:
    response = client.get("/api/v1/gst/verify", params={"gstin": "invalid"})

    assert response.status_code == 422


def test_formats_whitebooks_principal_address() -> None:
    payload = {
        "data": {
            "pradr": {
                "addr": {
                    "bno": "12",
                    "bnm": "Business Tower",
                    "loc": "Hyderabad",
                    "stcd": "Telangana",
                    "pncd": "500001",
                }
            }
        }
    }

    assert _address(payload) == ("12, Business Tower, Hyderabad, Telangana, 500001")


def test_inactive_registration_is_not_eligible_for_verified_credits() -> None:
    assert _is_active_registration("Active") is True
    assert _is_active_registration("") is False
    assert _is_active_registration("Cancelled Suo Moto") is False
    assert _is_active_registration("Suspended") is False


def test_extracts_nested_taxpayer_details() -> None:
    payload = {
        "data": {
            "lgnm": "Example Private Limited",
            "tradeNam": "Example",
            "sts": "Active",
        }
    }

    assert _taxpayer_details(payload) == (
        "Example Private Limited",
        "Example",
        "Active",
    )


def test_recognizes_successful_invalid_gstin_payload() -> None:
    assert _invalid_payload_message({"message": "GSTIN not found"}) == (
        "GSTIN not found"
    )
    assert _invalid_payload_message({"message": "Request completed"}) == ""
