from app.core.config import Settings


def test_whitebooks_production_urls_include_gst_prefix() -> None:
    settings = Settings(_env_file=None)

    token_url = (
        f"{settings.whitebooks_base_url.rstrip('/')}"
        f"{settings.whitebooks_token_path}"
    )
    gstin_url = (
        f"{settings.whitebooks_base_url.rstrip('/')}"
        f"{settings.whitebooks_gstin_path.format(gstin='29AAAAA0000A1Z5')}"
    )

    assert token_url == "https://api.whitebooks.in/gst/oauth/token"
    assert gstin_url == (
        "https://api.whitebooks.in/gst/api/v1/gstin/29AAAAA0000A1Z5"
    )
