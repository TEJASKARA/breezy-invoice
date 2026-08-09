from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_name: str = "BreezyInvoice API"
    api_v1_prefix: str = "/api/v1"
    frontend_origins: str = "http://localhost:5173"

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    gstinapi_base_url: str = "https://gstinapi.in"
    gstinapi_key: str = ""
    gstinapi_timeout_seconds: float = 15

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
    def gstinapi_is_configured(self) -> bool:
        return bool(self.gstinapi_base_url and self.gstinapi_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
