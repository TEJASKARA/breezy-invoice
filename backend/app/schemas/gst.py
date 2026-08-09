from typing import Any

from pydantic import BaseModel, Field


class GstVerificationResponse(BaseModel):
    gstin: str
    pan: str
    provider: str = "gstinapi"
    data: dict[str, Any] = Field(default_factory=dict)
