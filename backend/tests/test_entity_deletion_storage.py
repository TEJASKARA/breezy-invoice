from unittest.mock import AsyncMock

import pytest

from app.core.config import Settings
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError


@pytest.mark.asyncio
async def test_entity_cleanup_keeps_shared_files_and_deletes_exact_paths() -> None:
    gateway = SupabaseGateway(Settings(_env_file=None))
    gateway._get = AsyncMock(  # type: ignore[method-assign]
        side_effect=[
            [
                {"id": "1", "bill_path": "owner/local.pdf"},
                {"id": "2", "bill_path": "owner/shared.pdf"},
            ],
            [], [{"id": "surviving-expense"}],
        ]
    )
    gateway._delete_storage_objects = AsyncMock()  # type: ignore[method-assign]
    gateway._request = AsyncMock()  # type: ignore[method-assign]
    assert await gateway.cleanup_deleted_entity_files() == 1
    gateway._delete_storage_objects.assert_awaited_once_with(
        "expense-bills", ["owner/local.pdf"]
    )
    assert gateway._request.await_count == 2
    assert gateway._get.call_args_list[2].args[1]["payload->>billPath"] == (
        "eq.owner/shared.pdf"
    )


@pytest.mark.asyncio
async def test_failed_file_cleanup_remains_queued() -> None:
    gateway = SupabaseGateway(Settings(_env_file=None))
    gateway._get = AsyncMock(  # type: ignore[method-assign]
        side_effect=[[{"id": "1", "bill_path": "owner/local.pdf"}], []]
    )
    gateway._delete_storage_objects = AsyncMock(  # type: ignore[method-assign]
        side_effect=SupabaseGatewayError("Storage unavailable")
    )
    gateway._request = AsyncMock()  # type: ignore[method-assign]
    with pytest.raises(SupabaseGatewayError):
        await gateway.cleanup_deleted_entity_files()
    gateway._request.assert_not_awaited()


@pytest.mark.asyncio
async def test_reference_lookup_failure_never_deletes_storage() -> None:
    gateway = SupabaseGateway(Settings(_env_file=None))
    gateway._get = AsyncMock(  # type: ignore[method-assign]
        side_effect=[
            [{"id": "1", "bill_path": "owner/local.pdf"}],
            SupabaseGatewayError("Database unavailable"),
        ]
    )
    gateway._delete_storage_objects = AsyncMock()  # type: ignore[method-assign]
    gateway._request = AsyncMock()  # type: ignore[method-assign]
    with pytest.raises(SupabaseGatewayError):
        await gateway.cleanup_deleted_entity_files()
    gateway._delete_storage_objects.assert_not_awaited()
    gateway._request.assert_not_awaited()
