import hashlib
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError

router = APIRouter()

class AnonymousVisit(BaseModel):
    visitor_id: str = Field(min_length=20, max_length=100)

@router.post("/visit", status_code=status.HTTP_204_NO_CONTENT)
async def record_anonymous_visit(visit: AnonymousVisit) -> None:
    # Store only a salted irreversible hash; never retain the browser identifier.
    settings = get_settings()
    digest = hashlib.sha256(f"{settings.supabase_anon_key}:{visit.visitor_id}".encode()).hexdigest()
    try:
        await SupabaseGateway(settings).record_anonymous_visit(digest)
    except SupabaseGatewayError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Analytics is temporarily unavailable.") from exc
