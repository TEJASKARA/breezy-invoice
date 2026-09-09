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


@pytest.mark.asyncio
async def test_employee_letter_email_must_match_saved_letter_and_employee() -> None:
    gateway = SupabaseGateway(Settings())
    gateway._get = AsyncMock(  # type: ignore[method-assign]
        side_effect=[
            [{"employee_id": "employee-id"}],
            [{"payload": {"email": "employee@example.com"}}],
        ]
    )

    await gateway.assert_workspace_employee_letter(
        "workspace-id", "letter-id", " Employee@Example.com "
    )

    assert gateway._get.await_count == 2

    gateway.user_rpc.assert_awaited_once_with(
        "access-token",
        "breezy_has_permission",
        {
            "target_workspace_id": "00000000-0000-0000-0000-000000000001",
            "required_permission": "entities.manage",
        },
    )


@pytest.mark.asyncio
async def test_special_credit_grant_records_platform_admin_actor() -> None:
    gateway = SupabaseGateway(Settings())
    gateway.service_rpc = AsyncMock(  # type: ignore[method-assign]
        return_value={"workspace_id": "workspace-id"}
    )

    await gateway.grant_special_credits(
        subscription_code=" chx-test ",
        credit_amount=25,
        reason=" Customer support adjustment ",
        actor_user_id="00000000-0000-0000-0000-000000000001",
    )

    gateway.service_rpc.assert_awaited_once_with(
        "breezy_grant_special_credits",
        {
            "target_subscription_code": "CHX-TEST",
            "credit_amount": 25,
            "adjustment_reason": "Customer support adjustment",
            "target_actor_user_id": "00000000-0000-0000-0000-000000000001",
        },
    )


@pytest.mark.asyncio
async def test_admin_workspace_search_accepts_email_or_subscription_code() -> None:
    gateway = SupabaseGateway(Settings())
    gateway.service_rpc = AsyncMock(  # type: ignore[method-assign]
        return_value=[{"workspace_id": "workspace-id"}]
    )

    result = await gateway.admin_workspaces_by_identifier(
        " owner@example.com "
    )

    assert result == [{"workspace_id": "workspace-id"}]
    gateway.service_rpc.assert_awaited_once_with(
        "breezy_admin_find_workspaces",
        {"search_identifier": "owner@example.com"},
    )
