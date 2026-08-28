from unittest.mock import AsyncMock

import pytest

from app.core.config import Settings
from app.services.supabase_gateway import SupabaseGateway


@pytest.mark.asyncio
async def test_permission_rpc_uses_deployed_parameter_names() -> None:
    gateway = SupabaseGateway(Settings())
    gateway.user_rpc = AsyncMock(return_value=True)  # type: ignore[method-assign]

    await gateway.assert_workspace_permission(
        "access-token",
        "00000000-0000-0000-0000-000000000001",
        "entities.manage",
    )

    gateway.user_rpc.assert_awaited_once_with(
        "access-token",
        "breezy_has_permission",
        {
            "target_workspace_id": "00000000-0000-0000-0000-000000000001",
            "required_permission": "entities.manage",
        },
    )
