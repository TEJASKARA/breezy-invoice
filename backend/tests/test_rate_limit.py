from fastapi.testclient import TestClient

from app.core.rate_limit import RateLimiter, build_rules, exempt_patterns
from app.main import app

PREFIX = "/api/v1"
client = TestClient(app)


def make_limiter() -> RateLimiter:
    return RateLimiter(build_rules(PREFIX), exempt_patterns(PREFIX))


def test_send_code_is_blocked_after_five_requests_from_one_ip() -> None:
    limiter = make_limiter()
    path = f"{PREFIX}/account/phone/send-code"

    results = [limiter.check("POST", path, "1.2.3.4", "") for _ in range(6)]

    assert results[:5] == [None] * 5
    assert results[5] is not None
    assert results[5][1] > 0


def test_other_ip_is_not_affected() -> None:
    limiter = make_limiter()
    path = f"{PREFIX}/account/phone/send-code"
    for _ in range(6):
        limiter.check("POST", path, "1.2.3.4", "")

    assert limiter.check("POST", path, "5.6.7.8", "") is None


def test_each_user_gets_their_own_send_limit_on_a_shared_ip() -> None:
    limiter = make_limiter()
    path = f"{PREFIX}/documents/document-email"

    first = [limiter.check("POST", path, "9.9.9.9", "Bearer aaa") for _ in range(11)]
    other = limiter.check("POST", path, "9.9.9.9", "Bearer bbb")

    assert first[9] is None
    assert first[10] is not None
    assert other is None


def test_normal_use_is_not_limited() -> None:
    limiter = make_limiter()

    for _ in range(100):
        assert (
            limiter.check("GET", f"{PREFIX}/billing/status", "1.1.1.1", "Bearer x")
            is None
        )


def test_webhooks_health_and_preflight_are_exempt() -> None:
    limiter = make_limiter()

    for _ in range(400):
        assert limiter.check("POST", f"{PREFIX}/billing/webhook", "2.2.2.2", "") is None
        assert (
            limiter.check("POST", f"{PREFIX}/account/sms-hook", "2.2.2.2", "") is None
        )
        assert limiter.check("GET", "/health", "2.2.2.2", "") is None
        assert (
            limiter.check("OPTIONS", f"{PREFIX}/account/phone/send-code", "2.2.2.2", "")
            is None
        )


def test_burst_gets_http_429_with_retry_after() -> None:
    path = f"{PREFIX}/analytics/visit"
    body = {"visitor_id": "x" * 24}

    statuses = [client.post(path, json=body).status_code for _ in range(32)]

    assert 429 in statuses
    assert statuses.index(429) == 30
    blocked = client.post(path, json=body)
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) >= 1


def test_health_is_never_limited() -> None:
    assert all(client.get("/health").status_code == 200 for _ in range(50))
