import io
import json
import tarfile

import httpx
import pytest

from app.cli.export_storage import ExportError, export_storage
from app.core.config import Settings

SETTINGS = Settings(
    _env_file=None,
    supabase_url="https://x.supabase.co",
    supabase_service_role_key="service-key",
)

# bucket -> folder path -> entries. A folder has id None, a file has an id.
TREE = {
    "expense-bills": {
        "": [{"name": "user1", "id": None}],
        "user1/": [{"name": "abc", "id": None}],
        "user1/abc/": [{"name": "bill.pdf", "id": "1"}],
    },
    "document-links": {
        "": [{"name": "ws1", "id": None}],
        "ws1/": [{"name": "t1.pdf", "id": "2"}, {"name": "t2.pdf", "id": "3"}],
    },
}
FILES = {
    "expense-bills/user1/abc/bill.pdf": b"%PDF bill",
    "document-links/ws1/t1.pdf": b"%PDF one",
    "document-links/ws1/t2.pdf": b"%PDF two",
}


def handler(request: httpx.Request) -> httpx.Response:
    assert request.headers["authorization"] == "Bearer service-key"
    path = request.url.path
    if "/object/list/" in path:
        bucket = path.rsplit("/", 1)[1]
        prefix = json.loads(request.content)["prefix"]
        return httpx.Response(200, json=TREE[bucket].get(prefix, []))
    name = path.split("/storage/v1/object/", 1)[1]
    if name in FILES:
        return httpx.Response(200, content=FILES[name])
    return httpx.Response(404)


def test_every_file_in_every_bucket_is_exported_with_its_content() -> None:
    out = io.BytesIO()

    summary = export_storage(SETTINGS, out, transport=httpx.MockTransport(handler))

    assert summary == {"files": 3, "bytes": sum(len(v) for v in FILES.values())}
    out.seek(0)
    with tarfile.open(fileobj=out) as archive:
        exported = {m.name: archive.extractfile(m).read() for m in archive.getmembers()}
    assert exported == FILES


def test_a_file_that_cannot_be_read_fails_the_whole_export() -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        if "/object/list/" not in request.url.path:
            return httpx.Response(500)
        return handler(request)

    with pytest.raises(ExportError, match="bill.pdf"):
        export_storage(SETTINGS, io.BytesIO(), transport=httpx.MockTransport(broken))


def test_missing_credentials_are_refused() -> None:
    with pytest.raises(ExportError):
        export_storage(Settings(_env_file=None), io.BytesIO())
