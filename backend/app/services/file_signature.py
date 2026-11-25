"""Check what an uploaded file really is, from its bytes, never from its name or
declared type.

A renamed executable or script has none of the signatures below, so it is refused.
Images are decoded and re-saved, which drops anything hidden after or inside the
picture (scripts appended to a PNG, metadata, polyglot files). PDFs are refused if
they contain the markers for embedded JavaScript or launch actions.
"""

import io
import re

from PIL import Image, ImageOps, UnidentifiedImageError

# Larger images are refused before decoding so a small file cannot expand to gigabytes.
MAX_IMAGE_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

PDF, PNG, JPEG, WEBP = "application/pdf", "image/png", "image/jpeg", "image/webp"
EXTENSIONS = {PDF: "pdf", PNG: "png", JPEG: "jpg", WEBP: "webp"}
_PILLOW_FORMATS = {PNG: "PNG", JPEG: "JPEG", WEBP: "WEBP"}
_PDF_ACTIVE_CONTENT = re.compile(rb"/(JavaScript|JS|Launch)\b")


class FileRejected(ValueError):
    """The file is not an allowed type, or is damaged or unsafe."""


def sniff(data: bytes) -> str | None:
    """The real type from the first bytes: PDF, PNG, JPEG or WebP, else None."""
    if data.startswith(b"%PDF-"):
        return PDF
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return PNG
    if data.startswith(b"\xff\xd8\xff"):
        return JPEG
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return WEBP
    return None


def _clean_image(data: bytes, mime: str) -> bytes:
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise FileRejected("This image is too large.")
            image.load()
            image = ImageOps.exif_transpose(image)
            output = io.BytesIO()
            options = {"quality": 90} if mime == JPEG else {}
            if mime == JPEG and image.mode not in ("RGB", "L", "CMYK"):
                image = image.convert("RGB")
            image.save(output, format=_PILLOW_FORMATS[mime], **options)
    except FileRejected:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise FileRejected("This image is damaged or not a valid picture.") from exc
    return output.getvalue()


def clean_bill(data: bytes) -> tuple[bytes, str]:
    """Return (safe bytes, real MIME type) for a PDF or image, or raise FileRejected."""
    mime = sniff(data)
    if mime is None:
        raise FileRejected("Only PDF, JPG, PNG or WebP files can be uploaded.")
    if mime == PDF:
        if _PDF_ACTIVE_CONTENT.search(data):
            raise FileRejected("This PDF contains scripts and cannot be uploaded.")
        return data, mime
    return _clean_image(data, mime), mime


def safe_name(file_name: str, mime: str) -> str:
    """A storage-safe name whose extension matches the real content."""
    base = file_name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    base = re.sub(r"\.[^.]*$", "", base)
    base = re.sub(r"[^A-Za-z0-9_-]+", "_", base).strip("_")[:80] or "bill"
    return f"{base}.{EXTENSIONS[mime]}"
