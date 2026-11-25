import pytest

from app.main import rate_limiter


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    """Every test starts with empty request counters."""
    rate_limiter.reset()
    yield
    rate_limiter.reset()
