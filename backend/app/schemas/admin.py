from typing import Any, Literal

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
    matched_email: str | None = None


class PlatformWorkspaceSearchResponse(BaseModel):
    workspaces: list[PlatformWorkspaceResponse]


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


class PlatformUsageReportResponse(BaseModel):
    since_days: int
    generated_at: str
    scope: dict[str, Any]
    totals: dict[str, Any]
    pages: list[dict[str, Any]] = []
    features: list[dict[str, Any]] = []
    daily: list[dict[str, Any]] = []
    users: list[dict[str, Any]] = []
    workspaces: list[dict[str, Any]] = []
    inactive_workspaces: list[dict[str, Any]] = []
    recent: list[dict[str, Any]] = []
    extras: dict[str, Any] | None = None

class PurgeRequestCreate(BaseModel):
    subscription_code: str = Field(min_length=3, max_length=80)
    reason: str = Field(min_length=3, max_length=500)

class PurgeApproval(BaseModel):
    request_id: str
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


UUID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class AdminSetupTargetResponse(BaseModel):
    user_id: str
    email: str | None = None
    phone: str | None = None
    full_name: str | None = None
    account_type: str = "unselected"
    signed_up_at: str | None = None
    last_sign_in_at: str | None = None
    workspace_id: str | None = None
    workspace_name: str | None = None
    subscription_code: str | None = None
    workspace_status: str | None = None
    setup_completed: bool = False
    active_entities: int = 0


class AdminCompleteSetupRequest(BaseModel):
    workspace_id: str = Field(pattern=UUID_PATTERN)
    entity_id: str = Field(pattern=UUID_PATTERN)
    setup: dict[str, Any]
    entity: dict[str, Any]
    notify_user: bool = True


class AdminCompleteSetupResponse(BaseModel):
    message: str
    workspace_id: str
    subscription_code: str | None = None
    email: str | None = None
    gst_verified: bool = False
    email_sent: bool = False
