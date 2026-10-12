import base64
from unittest.mock import AsyncMock

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.main import app
from app.schemas.documents import PayslipEmailRequest
from app.services.supabase_gateway import SupabaseGateway

PDF = base64.b64encode(b"%PDF-1.4 test").decode()
WORKSPACE = "00000000-0000-0000-0000-000000000001"
EMPLOYEE = "00000000-0000-0000-0000-000000000002"
SLIP_A = "00000000-0000-0000-0000-00000000000a"
SLIP_B = "00000000-0000-0000-0000-00000000000b"


def _request(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "workspace_id": WORKSPACE,
        "employee_id": EMPLOYEE,
        "to_email": " Rahul@Example.com ",
        "subject": "Payslips",
        "message": "Attached.",
        "attachments": [
            {"payslip_id": SLIP_A, "filename": "Rahul_2026-08", "pdf_base64": PDF},
            {"payslip_id": SLIP_B, "filename": "Rahul_2026-09.pdf", "pdf_base64": PDF},
        ],
    }
    body.update(overrides)
    return body


def test_duplicate_payslips_are_rejected() -> None:
    duplicate = {"payslip_id": SLIP_A, "filename": "a.pdf", "pdf_base64": PDF}
    with pytest.raises(ValidationError, match="only once"):
        PayslipEmailRequest(**_request(attachments=[duplicate, duplicate]))


def test_non_uuid_payslip_id_is_rejected() -> None:
    bad = {"payslip_id": "x" * 36, "filename": "a.pdf", "pdf_base64": PDF}
    with pytest.raises(ValidationError):
        PayslipEmailRequest(**_request(attachments=[bad]))


def test_endpoint_emails_all_payslips_to_the_employee(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
    permission = AsyncMock()
    ownership = AsyncMock()
    send = AsyncMock()
    monkeypatch.setattr(
        SupabaseGateway, "authenticated_user", AsyncMock(return_value={"id": "u"})
    )
    monkeypatch.setattr(SupabaseGateway, "assert_workspace_permission", permission)
    monkeypatch.setattr(
        SupabaseGateway, "assert_workspace_employee_payslips", ownership
    )
    monkeypatch.setattr("app.api.routes.documents.send_payslip_email", send)
    try:
        response = TestClient(app).post(
            "/api/v1/documents/payslip-email",
            json=_request(),
            headers={"Authorization": "Bearer token"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["message"] == "2 payslips were emailed to rahul@example.com."
    permission.assert_awaited_once_with("token", WORKSPACE, "payslips.read")
    ownership.assert_awaited_once_with(
        WORKSPACE, EMPLOYEE, [SLIP_A, SLIP_B], "rahul@example.com"
    )
    names = [name for name, _pdf in send.await_args.kwargs["attachments"]]
    assert names == ["Rahul_2026-08.pdf", "Rahul_2026-09.pdf"]


def test_payslips_for_another_employee_are_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service",
    )
    gateway = SupabaseGateway(settings)
    responses = [
        [{"payload": {"email": "rahul@example.com"}}],
        [
            {"id": SLIP_A, "employee_id": EMPLOYEE},
            {"id": SLIP_B, "employee_id": "other"},
        ],
    ]
    monkeypatch.setattr(gateway, "_get", AsyncMock(side_effect=responses))
    import asyncio

    with pytest.raises(Exception, match="not saved for this employee"):
        asyncio.run(
            gateway.assert_workspace_employee_payslips(
                WORKSPACE, EMPLOYEE, [SLIP_A, SLIP_B], "rahul@example.com"
            )
        )


def test_wrong_recipient_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service",
    )
    gateway = SupabaseGateway(settings)
    monkeypatch.setattr(
        gateway,
        "_get",
        AsyncMock(return_value=[{"payload": {"email": "rahul@example.com"}}]),
    )
    import asyncio

    with pytest.raises(Exception, match="address saved on the employee"):
        asyncio.run(
            gateway.assert_workspace_employee_payslips(
                WORKSPACE, EMPLOYEE, [SLIP_A], "someone@else.com"
            )
        )
