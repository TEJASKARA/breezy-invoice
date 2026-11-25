"""Export every file in the private storage buckets as a tar stream (for backups).

Supabase backups do NOT include uploaded files, so expense bills and shared PDFs
need their own copy. Run inside the API container so the service key stays there:

    docker compose -f compose.production.yaml exec -T api \
        python -m app.cli.export_storage > storage.tar

Progress and a summary go to stderr; the tar goes to stdout. Exits non-zero if any file
could not be read, so a broken backup is never mistaken for a good one.
"""

import io
import sys
import tarfile
import time
from typing import BinaryIO

import httpx

from app.core.config import Settings, get_settings

BUCKETS = ("expense-bills", "document-links")
PAGE = 1000


class ExportError(RuntimeError):
    pass


def _list_files(
    client: httpx.Client, base: str, bucket: str, prefix: str = ""
) -> list[str]:
    """All file paths under a prefix, descending into folders."""
    paths: list[str] = []
    offset = 0
    while True:
        response = client.post(
            f"{base}/storage/v1/object/list/{bucket}",
            json={"prefix": prefix, "limit": PAGE, "offset": offset},
        )
        if response.is_error:
            raise ExportError(
                f"Could not list {bucket}/{prefix}: HTTP {response.status_code}"
            )
        items = response.json()
        for item in items:
            name = f"{prefix}{item['name']}"
            if item.get("id") is None:  # a folder
                paths.extend(_list_files(client, base, bucket, f"{name}/"))
            else:
                paths.append(name)
        if len(items) < PAGE:
            return paths
        offset += PAGE


def export_storage(
    settings: Settings,
    out: BinaryIO,
    buckets: tuple[str, ...] = BUCKETS,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, int]:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise ExportError("Supabase backend credentials are missing.")
    base = settings.supabase_url.rstrip("/")
    key = settings.supabase_service_role_key
    summary = {"files": 0, "bytes": 0}
    with (
        httpx.Client(
            timeout=60,
            transport=transport,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        ) as client,
        tarfile.open(fileobj=out, mode="w|") as archive,
    ):
        for bucket in buckets:
            for path in _list_files(client, base, bucket):
                response = client.get(f"{base}/storage/v1/object/{bucket}/{path}")
                if response.is_error:
                    raise ExportError(
                        f"Could not read {bucket}/{path}: HTTP {response.status_code}"
                    )
                info = tarfile.TarInfo(f"{bucket}/{path}")
                info.size = len(response.content)
                info.mtime = int(time.time())
                archive.addfile(info, io.BytesIO(response.content))
                summary["files"] += 1
                summary["bytes"] += info.size
    return summary


def main() -> int:
    try:
        summary = export_storage(get_settings(), sys.stdout.buffer)
    except (ExportError, httpx.HTTPError) as error:
        print(f"STORAGE EXPORT FAILED: {error}", file=sys.stderr)
        return 1
    print(
        f"Exported {summary['files']} files ({summary['bytes']} bytes).",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
