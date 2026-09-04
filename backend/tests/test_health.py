from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_razorpay_webhook_route_is_registered() -> None:
    response = client.post("/api/v1/billing/webhook", json={})

    assert response.status_code in {401, 503}
    assert response.status_code != 404
