from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.core.config import Settings
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError


@pytest.mark.asyncio
async def test_source_purge_preserves_transferred_bills() -> None:
    gateway = SupabaseGateway(
        Settings(
            _env_file=None,
            supabase_url="https://example.invalid",
            supabase_service_role_key="test-only",
        )
    )
    gateway._get = AsyncMock(  # type: ignore[method-assign]
        side_effect=[
            [
                {"payload": {"billPath": "source/local.pdf"}},
                {"payload": {"billPath": "third-owner/shared.pdf"}},
            ],
            [
                {"payload": {"billPath": "source/moved.pdf"}},
                {"payload": {"billPath": "third-owner/shared.pdf"}},
            ],
        ]
    )
    gateway._delete_storage_objects = AsyncMock()  # type: ignore[method-assign]
    gateway._delete_storage_prefix = AsyncMock()  # type: ignore[method-assign]
    client = MagicMock()
    client.delete = AsyncMock(return_value=httpx.Response(200))
    with patch("app.services.supabase_gateway.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value = client
        await gateway.permanently_delete_workspace("workspace", "source")

    gateway._delete_storage_objects.assert_awaited_once_with(
        "expense-bills", ["source/local.pdf"]
    )
    gateway._delete_storage_prefix.assert_awaited_once_with(
        "expense-bills",
        "source",
        protected_paths={"source/moved.pdf", "third-owner/shared.pdf"},
    )
    assert gateway._get.call_args_list[1].args[1]["workspace_id"] == "neq.workspace"


@pytest.mark.asyncio
async def test_storage_prefix_skips_protected_files_in_nested_folders() -> None:
    gateway = SupabaseGateway(
        Settings(
            _env_file=None,
            supabase_url="https://example.invalid",
            supabase_service_role_key="test-only",
        )
    )
    gateway._delete_storage_objects = AsyncMock()  # type: ignore[method-assign]
    client = MagicMock()
    client.post = AsyncMock(
        side_effect=[
            httpx.Response(200, json=[{"name": "folder", "id": None}]),
            httpx.Response(
                200,
                json=[
                    {"name": "moved.pdf", "id": "1"},
                    {"name": "orphan.pdf", "id": "2"},
                ],
            ),
        ]
    )
    with patch("app.services.supabase_gateway.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value = client
        await gateway._delete_storage_prefix(
            "expense-bills", "source", protected_paths={"source/folder/moved.pdf"}
        )
    gateway._delete_storage_objects.assert_awaited_once_with(
        "expense-bills", ["source/folder/orphan.pdf"]
    )


@pytest.mark.asyncio
async def test_purge_aborts_if_transferred_file_references_cannot_be_checked() -> None:
    gateway = SupabaseGateway(
        Settings(
            _env_file=None,
            supabase_url="https://example.invalid",
            supabase_service_role_key="test-only",
        )
    )
    gateway._get = AsyncMock(  # type: ignore[method-assign]
        side_effect=[[], SupabaseGatewayError("Database unavailable")]
    )
    gateway._delete_storage_objects = AsyncMock()  # type: ignore[method-assign]
    with pytest.raises(SupabaseGatewayError):
        await gateway.permanently_delete_workspace("workspace", "source")
    gateway._delete_storage_objects.assert_not_awaited()


@pytest.mark.asyncio
async def test_protected_file_lookup_is_paginated() -> None:
    gateway = SupabaseGateway(
        Settings(
            _env_file=None,
            supabase_url="https://example.invalid",
            supabase_service_role_key="test-only",
        )
    )
    gateway._get = AsyncMock(  # type: ignore[method-assign]
        side_effect=[
            [],
            [
                {"id": str(index), "payload": {"billPath": f"source/{index}.pdf"}}
                for index in range(1000)
            ],
            [{"payload": {"billPath": "source/last.pdf"}}],
        ]
    )
    gateway._delete_storage_objects = AsyncMock()  # type: ignore[method-assign]
    gateway._delete_storage_prefix = AsyncMock()  # type: ignore[method-assign]
    client = MagicMock()
    client.delete = AsyncMock(return_value=httpx.Response(200))
    with patch("app.services.supabase_gateway.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value = client
        await gateway.permanently_delete_workspace("workspace", "source")
    assert gateway._get.call_args_list[2].args[1]["id"] == "gt.999"
    protected = gateway._delete_storage_prefix.call_args.kwargs["protected_paths"]
    assert "source/last.pdf" in protected
    assert len(protected) == 1001


@pytest.mark.asyncio
async def test_source_expense_lookup_includes_all_transferred_in_bills() -> None:
    gateway = SupabaseGateway(
        Settings(
            _env_file=None,
            supabase_url="https://example.invalid",
            supabase_service_role_key="test-only",
        )
    )
    gateway._get = AsyncMock(  # type: ignore[method-assign]
        side_effect=[
            [
                {"id": str(index), "payload": {"billPath": f"old-owner/{index}.pdf"}}
                for index in range(1000)
            ],
            [{"payload": {"billPath": "old-owner/last.pdf"}}],
            [],
        ]
    )
    gateway._delete_storage_objects = AsyncMock()  # type: ignore[method-assign]
    gateway._delete_storage_prefix = AsyncMock()  # type: ignore[method-assign]
    client = MagicMock()
    client.delete = AsyncMock(return_value=httpx.Response(200))
    with patch("app.services.supabase_gateway.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value = client
        await gateway.permanently_delete_workspace("workspace", "source")
    assert gateway._get.call_args_list[1].args[1]["id"] == "gt.999"
    files = gateway._delete_storage_objects.call_args.args[1]
    assert len(files) == 1001
    assert "old-owner/last.pdf" in files
