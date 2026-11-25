"""Cross-tenant (IDOR) tests.

A fake Supabase holds two separate workspaces. Every request is sent through the real
FastAPI routes as the owner of workspace A, using workspace B's IDs in every way an
attacker could try: B's workspace id, B's record id inside A's workspace, and B's
workspace id with A's record id. Each must be refused and must send nothing.
"""

import base64
import re
from unittest.mock import AsyncMock
from urllib.parse import parse_qsl

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app

REAL_ASYNC_CLIENT = httpx.AsyncClient

A_USER, B_USER = (
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
)
WA, WB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
INV_A, INV_B = (
    "a0000000-0000-4000-8000-000000000001",
    "b0000000-0000-4000-8000-000000000001",
)
PRO_A, PRO_B = (
    "a0000000-0000-4000-8000-000000000002",
    "b0000000-0000-4000-8000-000000000002",
)
EMP_A, EMP_B = (
    "a0000000-0000-4000-8000-000000000003",
    "b0000000-0000-4000-8000-000000000003",
)
PAY_A, PAY_B = (
    "a0000000-0000-4000-8000-000000000004",
    "b0000000-0000-4000-8000-000000000004",
)
LET_A, LET_B = (
    "a0000000-0000-4000-8000-000000000005",
    "b0000000-0000-4000-8000-000000000005",
)
TOKEN_A = "token-of-user-a"
PDF = base64.b64encode(b"%PDF-1.4 test").decode()

USERS = {TOKEN_A: A_USER, "token-of-user-b": B_USER}
MEMBERS = {(WA, A_USER), (WB, B_USER)}
TABLES = {
    "breezy_workspaces": [
        {"id": WA, "owner_user_id": A_USER, "status": "active"},
        {"id": WB, "owner_user_id": B_USER, "status": "active"},
    ],
    "breezy_invoices": [
        {"id": INV_A, "workspace_id": WA},
        {"id": INV_B, "workspace_id": WB},
    ],
    "breezy_proformas": [
        {"id": PRO_A, "workspace_id": WA},
        {"id": PRO_B, "workspace_id": WB},
    ],
    "breezy_employees": [
        {"id": EMP_A, "workspace_id": WA, "payload": {"email": "emp@a.example"}},
        {"id": EMP_B, "workspace_id": WB, "payload": {"email": "emp@b.example"}},
    ],
    "breezy_payslips": [
        {"id": PAY_A, "workspace_id": WA, "employee_id": EMP_A},
        {"id": PAY_B, "workspace_id": WB, "employee_id": EMP_B},
    ],
    "breezy_employee_letters": [
        {"id": LET_A, "workspace_id": WA, "employee_id": EMP_A},
        {"id": LET_B, "workspace_id": WB, "employee_id": EMP_B},
    ],
}


def _matches(row: dict, key: str, expr: str) -> bool:
    if expr.startswith("eq."):
        return str(row.get(key)) == expr[3:]
    if expr.startswith("in.("):
        return str(row.get(key)) in expr[4:-1].split(",")
    return True


def fake_supabase(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    bearer = request.headers.get("authorization", "").removeprefix("Bearer ")
    caller = USERS.get(bearer)
    if path == "/auth/v1/user":
        return (
            httpx.Response(200, json={"id": caller}) if caller else httpx.Response(401)
        )
    if path.startswith("/rest/v1/rpc/"):
        name = path.rsplit("/", 1)[1]
        body = __import__("json").loads(request.content or b"{}")
        workspace = body.get("target_workspace_id")
        is_member = (workspace, caller) in MEMBERS
        if name == "breezy_has_permission":
            return httpx.Response(200, json=is_member)
        if not is_member:
            return httpx.Response(
                400,
                json={
                    "message": "You do not have permission to manage this team."
                },
            )
        return httpx.Response(
            200, json={"kind": "member", "email": body.get("target_email", "")}
        )
    match = re.fullmatch(r"/rest/v1/(\w+)", path)
    if match and request.method == "GET":
        rows = TABLES.get(match.group(1), [])
        for key, expr in parse_qsl(request.url.query.decode()):
            if key not in ("select", "limit", "order"):
                rows = [row for row in rows if _matches(row, key, expr)]
        return httpx.Response(200, json=rows)
    return httpx.Response(
        404, json={"message": f"unexpected call {request.method} {path}"}
    )


class FakeAsyncClient(REAL_ASYNC_CLIENT):
    def __init__(self, *args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(fake_supabase)
        super().__init__(*args, **kwargs)


@pytest.fixture
def sends(monkeypatch):
    """Fake Supabase plus recorders for everything that sends or stores something."""
    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    sent = {
        "email": AsyncMock(),
        "letter": AsyncMock(),
        "payslip": AsyncMock(),
        "whatsapp": AsyncMock(return_value="queued"),
        "link": AsyncMock(return_value="x" * 32),
    }
    from app.api.routes import documents
    from app.services.supabase_gateway import SupabaseGateway

    monkeypatch.setattr(documents, "send_document_email", sent["email"])
    monkeypatch.setattr(documents, "send_employee_letter_email", sent["letter"])
    monkeypatch.setattr(documents, "send_payslip_email", sent["payslip"])
    monkeypatch.setattr(documents, "send_document_whatsapp", sent["whatsapp"])
    monkeypatch.setattr(SupabaseGateway, "save_document_link", sent["link"])
    settings = Settings(
        _env_file=None,
        supabase_url="https://fake.supabase.co",
        supabase_anon_key="anon",
        supabase_service_role_key="service",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield sent
    app.dependency_overrides.clear()


client = TestClient(app)
HEAD = {"Authorization": f"Bearer {TOKEN_A}"}


def post(path: str, body: dict):
    return client.post(f"/api/v1/documents/{path}", json=body, headers=HEAD)


def doc(workspace: str, document: str, kind: str) -> dict:
    return {
        "workspace_id": workspace,
        "document_id": document,
        "document_type": kind,
        "document_number": "N-1",
        "filename": "doc.pdf",
        "pdf_base64": PDF,
    }


def email_doc(workspace, document, kind):
    return post(
        "document-email",
        {
            **doc(workspace, document, kind),
            "to_email": "x@example.com",
            "subject": "s",
            "message": "m",
        },
    )


def whatsapp_doc(workspace, document, kind):
    return post(
        "document-whatsapp",
        {**doc(workspace, document, kind), "to_number": "9876543210", "message": "m"},
    )


def link_doc(workspace, document, kind):
    return post("document-link", doc(workspace, document, kind))


def letter_email(workspace, letter):
    return post(
        "employee-letter-email",
        {
            "workspace_id": workspace,
            "letter_id": letter,
            "to_email": "emp@a.example",
            "employee_name": "E",
            "subject": "s",
            "message": "m",
            "filename": "l.pdf",
            "pdf_base64": PDF,
        },
    )


def payslip_email(workspace, employee, payslip, to="emp@a.example"):
    return post(
        "payslip-email",
        {
            "workspace_id": workspace,
            "employee_id": employee,
            "to_email": to,
            "subject": "s",
            "message": "m",
            "attachments": [
                {"payslip_id": payslip, "filename": "p.pdf", "pdf_base64": PDF}
            ],
        },
    )


# (name, sender key, callable) for every attempt that must be refused.
ATTACKS = [
    (
        "email invoice, B workspace + B invoice",
        "email",
        lambda: email_doc(WB, INV_B, "invoice"),
    ),
    (
        "email invoice, A workspace + B invoice",
        "email",
        lambda: email_doc(WA, INV_B, "invoice"),
    ),
    (
        "email invoice, B workspace + A invoice",
        "email",
        lambda: email_doc(WB, INV_A, "invoice"),
    ),
    (
        "email quotation, A workspace + B quotation",
        "email",
        lambda: email_doc(WA, PRO_B, "quotation"),
    ),
    (
        "email quotation, B workspace + B quotation",
        "email",
        lambda: email_doc(WB, PRO_B, "quotation"),
    ),
    (
        "whatsapp invoice, A workspace + B invoice",
        "whatsapp",
        lambda: whatsapp_doc(WA, INV_B, "invoice"),
    ),
    (
        "whatsapp invoice, B workspace + B invoice",
        "whatsapp",
        lambda: whatsapp_doc(WB, INV_B, "invoice"),
    ),
    (
        "whatsapp payslip, A workspace + B payslip",
        "whatsapp",
        lambda: whatsapp_doc(WA, PAY_B, "payslip"),
    ),
    (
        "whatsapp payslip, B workspace + B payslip",
        "whatsapp",
        lambda: whatsapp_doc(WB, PAY_B, "payslip"),
    ),
    (
        "whatsapp letter, A workspace + B letter",
        "whatsapp",
        lambda: whatsapp_doc(WA, LET_B, "employee_letter"),
    ),
    (
        "share link invoice, A workspace + B invoice",
        "link",
        lambda: link_doc(WA, INV_B, "invoice"),
    ),
    (
        "share link invoice, B workspace + B invoice",
        "link",
        lambda: link_doc(WB, INV_B, "invoice"),
    ),
    (
        "share link quotation, A workspace + B quotation",
        "link",
        lambda: link_doc(WA, PRO_B, "quotation"),
    ),
    (
        "share link letter, A workspace + B letter",
        "link",
        lambda: link_doc(WA, LET_B, "employee_letter"),
    ),
    (
        "share link letter, B workspace + B letter",
        "link",
        lambda: link_doc(WB, LET_B, "employee_letter"),
    ),
    ("email letter, A workspace + B letter", "letter", lambda: letter_email(WA, LET_B)),
    ("email letter, B workspace + B letter", "letter", lambda: letter_email(WB, LET_B)),
    (
        "email payslips, B workspace + B employee",
        "payslip",
        lambda: payslip_email(WB, EMP_B, PAY_B, "emp@b.example"),
    ),
    (
        "email payslips, A workspace + B employee",
        "payslip",
        lambda: payslip_email(WA, EMP_B, PAY_B, "emp@b.example"),
    ),
    (
        "email payslips, A employee + B payslip",
        "payslip",
        lambda: payslip_email(WA, EMP_A, PAY_B),
    ),
]


@pytest.mark.parametrize("name,sender,attack", ATTACKS, ids=[a[0] for a in ATTACKS])
def test_cross_tenant_document_actions_are_refused(sends, name, sender, attack):
    response = attack()

    assert response.status_code in (400, 401, 403, 404), (
        name,
        response.status_code,
        response.text,
    )
    assert all(mock.await_count == 0 for mock in sends.values()), (
        f"{name} still sent something"
    )


def test_own_workspace_requests_still_work(sends):
    """Without this, the refusals above could just mean the fake is broken."""
    assert email_doc(WA, INV_A, "invoice").status_code == 200
    assert email_doc(WA, PRO_A, "quotation").status_code == 200
    assert whatsapp_doc(WA, INV_A, "invoice").status_code == 200
    assert whatsapp_doc(WA, PAY_A, "payslip").status_code == 200
    assert whatsapp_doc(WA, LET_A, "employee_letter").status_code == 200
    assert link_doc(WA, INV_A, "invoice").status_code == 200
    assert letter_email(WA, LET_A).status_code == 200
    assert payslip_email(WA, EMP_A, PAY_A).status_code == 200
    assert sends["email"].await_count == 2
    assert sends["whatsapp"].await_count == 3
    assert sends["link"].await_count == 1
    assert sends["letter"].await_count == 1
    assert sends["payslip"].await_count == 1


def test_other_workspaces_billing_is_off_limits(sends):
    assert (
        client.get(
            f"/api/v1/billing/status?workspace_id={WB}", headers=HEAD
        ).status_code
        == 400
    )
    order = client.post(
        "/api/v1/billing/orders",
        json={"workspace_id": WB, "plan_key": "monthly"},
        headers=HEAD,
    )
    assert order.status_code == 400
    verify = client.post(
        "/api/v1/billing/verify",
        json={
            "workspace_id": WB,
            "razorpay_order_id": "order_abc123",
            "razorpay_payment_id": "pay_abc123",
            "razorpay_signature": "s" * 40,
        },
        headers=HEAD,
    )
    assert verify.status_code == 400
    # Own workspace passes the ownership check (it reads payment history).
    assert (
        client.get(
            f"/api/v1/billing/status?workspace_id={WA}", headers=HEAD
        ).status_code
        != 400
    )


def test_other_workspaces_team_cannot_be_invited_into(sends):
    attack = client.post(
        "/api/v1/team/invitations",
        json={"workspace_id": WB, "email": "evil@example.com", "role": "admin"},
        headers=HEAD,
    )
    assert attack.status_code >= 400
    assert "permission" in attack.text.lower()


def test_gstin_lookup_needs_membership_of_the_workspace(sends):
    response = client.get(
        f"/api/v1/gst/verify?gstin=36ACJFA4386L1ZW&workspace_id={WB}", headers=HEAD
    )
    assert response.status_code in (400, 401, 403)


def test_requests_without_a_valid_token_are_refused(sends):
    nobody = {"Authorization": "Bearer not-a-real-token"}
    response = client.post(
        "/api/v1/documents/document-email",
        json={
            **doc(WA, INV_A, "invoice"),
            "to_email": "x@example.com",
            "subject": "s",
            "message": "m",
        },
        headers=nobody,
    )
    assert response.status_code in (400, 401, 403)
    assert sends["email"].await_count == 0
