import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class PlatformAdminAccessResponse(BaseModel):
    is_super_admin: bool


class PlatformWorkspaceResponse(BaseModel):
    workspace_id: str
    name: str = "Unnamed workspace"
    subscription_code: str
    status: Literal["active", "suspended", "closed"] = "active"
    document_credits_remaining: int = 0
    quotation_credits_remaining: int = 0
    matched_email: str | None = None

    @field_validator("name", mode="before")
    @classmethod
    def default_name(cls, value: object) -> object:
        # Workspaces created before onboarding finished have no name yet.
        if isinstance(value, str) and value.strip():
            return value
        return "Unnamed workspace"

    @field_validator(
        "document_credits_remaining", "quotation_credits_remaining", mode="before"
    )
    @classmethod
    def default_credits(cls, value: object) -> object:
        return 0 if value is None else value


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
    workspace_overviews: list[dict[str, Any]] = []

class AnalyticsExclusion(BaseModel):
    user_id: str
    email: str
    note: str | None = None
    created_at: str | None = None


class AnalyticsExclusionList(BaseModel):
    accounts: list[AnalyticsExclusion]


class AnalyticsExclusionCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    note: str | None = Field(default=None, max_length=200)


MARKETING_EMAIL = re.compile(
    r"^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$"
)


class MarketingLead(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    contact_name: str | None = Field(default=None, max_length=200)
    business_name: str | None = Field(default=None, max_length=300)
    phone: str | None = Field(default=None, max_length=20)
    state: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    source_ref: str | None = Field(default=None, max_length=40)
    registered_on: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    details: dict[str, str] = Field(default_factory=dict)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not MARKETING_EMAIL.fullmatch(email) or ".." in email:
            raise ValueError(f"Invalid email address: {value}")
        return email

    @field_validator("details")
    @classmethod
    def small_details(cls, value: dict[str, str]) -> dict[str, str]:
        return {key[:40]: str(item)[:300] for key, item in list(value.items())[:12]}


class MarketingImportRequest(BaseModel):
    source: Literal["gst", "mca"]
    file_name: str = Field(min_length=1, max_length=240)
    total_rows: int = Field(ge=0, le=200_000)
    missing_email: int = Field(default=0, ge=0)
    invalid_email: int = Field(default=0, ge=0)
    duplicate_in_file: int = Field(default=0, ge=0)
    leads: list[MarketingLead] = Field(max_length=20_000)


class MarketingImportResponse(BaseModel):
    upload_id: str
    inserted: int
    already_contacted: int


class MarketingSummaryResponse(BaseModel):
    counts: dict[str, int] = Field(default_factory=dict)
    sent_today: int = 0
    uploads: list[dict[str, Any]] = Field(default_factory=list)


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


class PaymentLinkCreateRequest(BaseModel):
    subscription_code: str = Field(min_length=3, max_length=40)
    base_amount_paise: int = Field(ge=100, le=100_000_000)
    credits: int = Field(ge=1, le=1_000_000)
    duration_months: int = Field(ge=1, le=36)
    description: str = Field(min_length=3, max_length=500)
    notify_customer: bool = True


class PaymentLinkResponse(BaseModel):
    id: str
    workspace_id: str
    workspace_name: str | None = None
    subscription_code: str | None = None
    short_url: str | None = None
    description: str
    base_amount_paise: int
    gst_amount_paise: int
    amount_paise: int
    credits: int
    duration_months: int
    customer_name: str | None = None
    customer_email: str | None = None
    customer_phone: str | None = None
    status: str
    paid_at: str | None = None
    created_at: str


class PaymentLinkListResponse(BaseModel):
    links: list[PaymentLinkResponse]
