from typing import Any

from pydantic import BaseModel, Field


class GstVerificationResponse(BaseModel):
    gstin: str
    pan: str
    provider: str = "whitebooks"
    cached: bool = False
    workspace_verified: bool = False
    legal_name: str = ""
    trade_name: str = ""
    registration_status: str = ""
    billing_address: str = ""
    premises_address: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
