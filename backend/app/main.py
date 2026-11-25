from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.rate_limit import (
    RateLimiter,
    RateLimitMiddleware,
    build_rules,
    exempt_patterns,
)

settings = get_settings()
rate_limiter = RateLimiter(
    build_rules(settings.api_v1_prefix), exempt_patterns(settings.api_v1_prefix)
)

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url=None,
)

# Added before CORS so CORS stays outermost and 429 replies still carry its headers.
if settings.rate_limit_enabled:
    app.add_middleware(RateLimitMiddleware, limiter=rate_limiter)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/health", tags=["System"])
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "chanax-api",
        "environment": settings.app_env,
    }
