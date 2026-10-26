from unittest.mock import AsyncMock

import pytest

from app.core.config import Settings
from app.services.supabase_gateway import (
    GstRegistrationConflict,
    SupabaseGateway,
    SupabaseGatewayError,
)


@pytest.mark.asyncio
async def test_gst_check_is_bound_to_requested_workspace_and_does_not_reject_true():
    gateway = SupabaseGateway(Settings())
    gateway.user_rpc = AsyncMock(return_value=True)
    await gateway.assert_gstin_available("token", "owner-workspace", " GSTIN ")
    gateway.user_rpc.assert_awaited_once_with(
        "token",
        "breezy_is_gstin_available",
        {"target_workspace_id": "owner-workspace", "target_gstin": "GSTIN"},
    )


@pytest.mark.asyncio
async def test_bad_gst_rpc_response_is_not_reported_as_a_duplicate():
    gateway = SupabaseGateway(Settings())
    gateway.user_rpc = AsyncMock(return_value=None)
    with pytest.raises(SupabaseGatewayError, match="temporarily unavailable"):
        await gateway.assert_gstin_available("token", "workspace", "GSTIN")


@pytest.mark.asyncio
async def test_gst_conflict_hint_discloses_only_another_owned_workspace():
    gateway = SupabaseGateway(Settings())
    gateway.user_rpc = AsyncMock(return_value=False)
    gateway._get = AsyncMock(
        side_effect=[
            [{"id": "owner-workspace", "name": "Aakash Reddy"}],
            [
                {
                    "workspace_id": "owner-workspace",
                    "setup": {"gstin": "36ACJFA4386L1ZW"},
                }
            ],
            [],
        ]
    )
    with pytest.raises(GstRegistrationConflict, match="Aakash Reddy"):
        await gateway.assert_gstin_available(
            "token", "client-workspace", "36ACJFA4386L1ZW", user_id="owner-id"
        )
    assert gateway._get.call_args_list[0].args[1]["owner_user_id"] == "eq.owner-id"


@pytest.mark.asyncio
async def test_other_users_gst_conflict_does_not_expose_private_workspace_names():
    gateway = SupabaseGateway(Settings())
    gateway.user_rpc = AsyncMock(return_value=False)
    gateway._get = AsyncMock(return_value=[])
    with pytest.raises(GstRegistrationConflict, match="contact the workspace owner"):
        await gateway.assert_gstin_available(
            "token", "client-workspace", "36ACJFA4386L1ZW", user_id="other-user"
        )
    assert gateway._get.await_count == 1


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

    result = await gateway.admin_workspaces_by_identifier(" owner@example.com ")

    assert result == [{"workspace_id": "workspace-id"}]
    gateway.service_rpc.assert_awaited_once_with(
        "breezy_admin_find_workspaces",
        {"search_identifier": "owner@example.com"},
    )


@pytest.mark.asyncio
async def test_admin_usage_report_uses_deployed_parameter_names() -> None:
    gateway = SupabaseGateway(Settings())
    gateway.service_rpc = AsyncMock(return_value={"since_days": 7})  # type: ignore[method-assign]

    await gateway.admin_usage_report(since_days=7, identifier="  Owner@Example.com ")
    gateway.service_rpc.assert_awaited_with(
        "breezy_admin_usage_report",
        {
            "since_days": 7,
            "search_identifier": "Owner@Example.com",
            "excluded_user_ids": [],
        },
    )

    await gateway.admin_usage_report(
        since_days=30, identifier="   ", excluded_user_ids=["b", "a"]
    )
    gateway.service_rpc.assert_awaited_with(
        "breezy_admin_usage_report",
        {"since_days": 30, "search_identifier": None, "excluded_user_ids": ["a", "b"]},
    )
