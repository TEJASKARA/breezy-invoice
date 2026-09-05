from typing import Literal

from pydantic import BaseModel, Field


class PlatformAdminAccessResponse(BaseModel):
    is_super_admin: bool


class PlatformWorkspaceResponse(BaseModel):
    workspace_id: str
    name: str
    subscription_code: str
    status: Literal["active", "suspended", "closed"]
    document_credits_remaining: int
    quotation_credits_remaining: int


class SpecialCreditGrantRequest(BaseModel):
    subscription_code: str = Field(min_length=3, max_length=80)
    credit_amount: int = Field(ge=1, le=100000)
    reason: str = Field(min_length=3, max_length=500)


class SpecialCreditGrantResponse(BaseModel):
    workspace_id: str
    credits_added: int
    quotation_credits_added: int
    topup_credits_remaining: int
    topup_quotation_credits_remaining: int
