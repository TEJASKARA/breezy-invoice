from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "breezyaccounts",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)


@celery_app.task(name="breezyaccounts.health_check")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
