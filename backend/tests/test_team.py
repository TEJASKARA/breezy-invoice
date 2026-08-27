import pytest

from app.api.routes.team import _rpc_invitation_result
from app.services.supabase_gateway import SupabaseGatewayError


def test_parses_workspace_invitation_rpc_result() -> None:
    result = _rpc_invitation_result(
        {"kind": "invitation", "email": "member@example.com"},
        "fallback@example.com",
    )

    assert result == {"kind": "invitation", "email": "member@example.com"}


def test_rejects_invalid_workspace_invitation_rpc_result() -> None:
    with pytest.raises(SupabaseGatewayError):
        _rpc_invitation_result({"kind": "unknown"}, "member@example.com")
