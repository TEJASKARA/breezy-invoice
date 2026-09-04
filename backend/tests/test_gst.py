from fastapi.testclient import TestClient

from app.api.routes.gst import (
    _address,
    _invalid_payload_message,
    _is_active_registration,
    _taxpayer_details,
)
from app.main import app

client = TestClient(app)


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
