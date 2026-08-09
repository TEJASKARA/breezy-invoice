from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_rejects_invalid_gstin() -> None:
    response = client.get("/api/v1/gst/verify", params={"gstin": "invalid"})

    assert response.status_code == 422
