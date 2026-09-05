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
