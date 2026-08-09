import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.config import Settings, get_settings
from app.schemas.gst import GstVerificationResponse
from app.services.gstinapi import (
    GstinApiClient,
    GstinApiConfigurationError,
    GstinApiRequestError,
)

router = APIRouter()

GSTIN_PATTERN = re.compile(
    r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"
)


@router.get("/verify", response_model=GstVerificationResponse)
async def verify_gstin(
    settings: Annotated[Settings, Depends(get_settings)],
    gstin: str = Query(min_length=15, max_length=15),
) -> GstVerificationResponse:
    normalized_gstin = gstin.strip().upper()
    if not GSTIN_PATTERN.fullmatch(normalized_gstin):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid 15-character GSTIN.",
        )

    try:
        data = await GstinApiClient(settings).verify_gstin(normalized_gstin)
    except GstinApiConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except GstinApiRequestError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=str(exc),
        ) from exc

    return GstVerificationResponse(
        gstin=normalized_gstin,
        pan=normalized_gstin[2:12],
        data=data,
    )
