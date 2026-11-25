import base64
import io
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings, get_settings
from app.main import app
from app.services.file_signature import FileRejected, clean_bill, safe_name, sniff
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError

WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
USER = {"id": "11111111-1111-4111-8111-111111111111"}
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def image(fmt: str, size=(8, 8)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buffer, format=fmt)
    return buffer.getvalue()


# --- content checks ---------------------------------------------------------


def test_real_files_are_recognised_by_their_bytes() -> None:
    assert sniff(PDF) == "application/pdf"
    assert sniff(image("PNG")) == "image/png"
    assert sniff(image("JPEG")) == "image/jpeg"
    assert sniff(image("WEBP")) == "image/webp"


@pytest.mark.parametrize(
    "content",
    [
        b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 200,  # Windows executable
        b"\x7fELF\x02\x01\x01" + b"\x00" * 200,  # Linux executable
        b"#!/bin/sh\nrm -rf /\n",  # shell script
        b"<?php system($_GET['c']); ?>",
        b"<script>alert(1)</script>",
        b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
        b"PK\x03\x04" + b"\x00" * 50,  # zip / office / jar
        b"",
    ],
)
def test_renamed_executables_scripts_and_archives_are_rejected(content) -> None:
    # The name or declared type is irrelevant: only the bytes count.
    with pytest.raises(FileRejected):
        clean_bill(content)


def test_pdf_with_embedded_javascript_is_rejected() -> None:
    with pytest.raises(FileRejected, match="scripts"):
        clean_bill(PDF + b"\n/AA << /O << /S /JavaScript /JS (app.alert(1)) >> >>")
    with pytest.raises(FileRejected):
        clean_bill(PDF + b"\n/S /Launch /F (cmd.exe)")


def test_clean_pdf_passes_untouched() -> None:
    data, mime = clean_bill(PDF)
    assert (data, mime) == (PDF, "application/pdf")


def test_images_are_re_encoded_so_hidden_payloads_are_dropped() -> None:
    payload = b"<script>alert('owned')</script>"
    for fmt, mime in (("PNG", "image/png"), ("JPEG", "image/jpeg")):
        original = image(fmt) + payload  # script appended after a valid picture
        assert payload in original

        cleaned, detected = clean_bill(original)

        assert detected == mime
        assert payload not in cleaned
        assert Image.open(io.BytesIO(cleaned)).size == (8, 8)


def test_truncated_or_fake_images_are_rejected() -> None:
    with pytest.raises(FileRejected):
        clean_bill(b"\x89PNG\r\n\x1a\n" + b"not really a png")
    with pytest.raises(FileRejected):
        clean_bill(image("PNG")[:40])


def test_huge_images_are_rejected_before_they_are_decoded() -> None:
    bomb = image("PNG", size=(7000, 7000))  # 49 megapixels, tiny when compressed
    with pytest.raises(FileRejected, match="too large"):
        clean_bill(bomb)


def test_stored_name_matches_the_real_type_and_cannot_escape_the_folder() -> None:
    assert safe_name("invoice.exe", "application/pdf") == "invoice.pdf"
    assert safe_name("../../etc/passwd", "image/png") == "passwd.png"
    assert safe_name("..\\..\\win.ini", "image/jpeg") == "win.jpg"
    assert safe_name("###", "image/webp") == "bill.webp"


# --- the upload endpoint ----------------------------------------------------


@pytest.fixture
def upload(monkeypatch):
    saved = AsyncMock()
    monkeypatch.setattr(
        SupabaseGateway, "authenticated_user", AsyncMock(return_value=USER)
    )
    permission = AsyncMock()
    monkeypatch.setattr(SupabaseGateway, "assert_workspace_permission", permission)
    monkeypatch.setattr(SupabaseGateway, "save_expense_bill", saved)
    settings = Settings(_env_file=None)
    app.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(app)

    def send(content: bytes, name: str = "bill.pdf", workspace: str = WORKSPACE):
        return client.post(
            "/api/v1/expense-bills",
            json={
                "workspace_id": workspace,
                "file_name": name,
                "data_base64": base64.b64encode(content).decode() or "AAAA",
            },
            headers={"Authorization": "Bearer t"},
        )

    send.saved, send.permission = saved, permission
    yield send
    app.dependency_overrides.clear()


def test_a_real_pdf_and_real_images_are_stored(upload) -> None:
    for content, name, mime in (
        (PDF, "vendor bill.pdf", "application/pdf"),
        (image("PNG"), "photo.png", "image/png"),
        (image("JPEG"), "photo.jpg", "image/jpeg"),
    ):
        response = upload(content, name)
        assert response.status_code == 200, response.text
        assert response.json()["content_type"] == mime
        assert response.json()["path"].startswith(f"{USER['id']}/")
    assert upload.saved.await_count == 3
    upload.permission.assert_awaited_with("t", WORKSPACE, "expenses.manage")


def test_renamed_executable_is_rejected_whatever_its_name(upload) -> None:
    exe = b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 200
    for name in ("bill.pdf", "photo.png", "photo.jpg", "bill.PDF.exe"):
        response = upload(exe, name)
        assert response.status_code == 400, name
        assert "Only PDF" in response.json()["detail"]
    assert upload.saved.await_count == 0


def test_script_disguised_as_png_is_rejected(upload) -> None:
    response = upload(b"<script>alert(1)</script>", "logo.png")
    assert response.status_code == 400
    assert upload.saved.await_count == 0


def test_image_with_appended_script_is_stored_clean(upload) -> None:
    payload = b"<script>alert('owned')</script>"
    response = upload(image("PNG") + payload, "photo.png")

    assert response.status_code == 200
    stored = upload.saved.await_args.args[1]
    assert payload not in stored


def test_oversize_file_is_rejected(upload) -> None:
    response = upload(PDF + b"\x00" * (5 * 1024 * 1024))
    assert response.status_code == 413
    assert upload.saved.await_count == 0


def test_user_without_workspace_permission_cannot_upload(upload) -> None:
    upload.permission.side_effect = SupabaseGatewayError("no permission")
    response = upload(PDF)
    assert response.status_code == 400
    assert upload.saved.await_count == 0


def test_invalid_base64_is_rejected(upload) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/expense-bills",
        json={"workspace_id": WORKSPACE, "file_name": "a.pdf", "data_base64": "!!!!"},
        headers={"Authorization": "Bearer t"},
    )
    assert response.status_code == 400
    assert upload.saved.await_count == 0
