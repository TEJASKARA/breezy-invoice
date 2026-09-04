from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_name: str = "ChanaX API"
    api_v1_prefix: str = "/api/v1"
    frontend_origins: str = "http://localhost:5173"
    frontend_url: str = "http://localhost:5173"

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    account_deletion_cron_secret: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_from_name: str = "ChanaX"
    smtp_use_tls: bool = True

    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    razorpay_mode: str = "test"

    whitebooks_base_url: str = "https://api.whitebooks.in"
    whitebooks_client_id: str = ""
    whitebooks_client_secret: str = ""
    whitebooks_email: str = ""
    whitebooks_gstin_path: str = "/public/search"
    whitebooks_timeout_seconds: float = 20

    redis_url: str = "redis://localhost:6379/0"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.frontend_origins.split(",")
            if origin.strip()
        ]

    @property
    def team_invite_redirect_url(self) -> str:
        return f"{self.frontend_url.rstrip('/')}/workspace"

    @property
    def whitebooks_is_configured(self) -> bool:
        return bool(
            self.whitebooks_base_url
            and self.whitebooks_client_id
            and self.whitebooks_client_secret
            and self.whitebooks_email
        )

    @property
    def smtp_is_configured(self) -> bool:
        return bool(
            self.smtp_host
            and self.smtp_username
            and self.smtp_password
            and self.smtp_from_email
        )

    @property
    def razorpay_is_configured(self) -> bool:
        return bool(
            self.razorpay_key_id
            and self.razorpay_key_secret
            and self.razorpay_webhook_secret
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
