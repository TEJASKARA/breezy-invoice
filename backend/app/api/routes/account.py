from typing import Annotated

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException

from app.api.routes.gst import _bearer_token
from app.core.config import Settings, get_settings
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError
from app.services.welcome_email import deliver_welcome

router = APIRouter()


@router.post("/welcome", status_code=202)
async def welcome_after_signin(
    background_tasks: BackgroundTasks,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    token = _bearer_token(authorization)
    try:
        user = await SupabaseGateway(settings).authenticated_user(token)
    except SupabaseGatewayError as exc:
        raise HTTPException(401, "Sign in again to continue.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(503, "The account connection is unavailable.") from exc
    if not user.get("email_confirmed_at") or not user.get("email"):
        return {"status": "not_eligible"}
    background_tasks.add_task(deliver_welcome, settings, str(user["id"]))
    return {"status": "scheduled"}
