from typing import Literal

from pydantic import BaseModel, Field

PlanKey = Literal[
    "quarterly",
    "half_yearly",
    "annual",
    "custom_monthly",
    "custom_quarterly",
    "custom_annual",
]


class BillingOrderRequest(BaseModel):
    workspace_id: str = Field(min_length=36, max_length=36)
    plan_key: PlanKey
    monthly_invoices: int | None = Field(default=None, ge=0, le=1_000_000)
    employees: int | None = Field(default=None, ge=0, le=1_000_000)


class BillingOrderResponse(BaseModel):
    order_id: str
    key_id: str
    amount: int
    currency: Literal["INR"] = "INR"
    plan_key: PlanKey
    plan_name: str
    credits: int
    quotation_credits: int
    duration_months: int
    estimated_monthly_invoices: int | None = None
    estimated_employees: int | None = None


class BillingVerificationRequest(BaseModel):
    workspace_id: str = Field(min_length=36, max_length=36)
    razorpay_order_id: str = Field(min_length=5, max_length=100)
    razorpay_payment_id: str = Field(min_length=5, max_length=100)
    razorpay_signature: str = Field(min_length=32, max_length=256)


class BillingVerificationResponse(BaseModel):
    success: bool = True
    already_processed: bool = False
    plan_key: str
    credits_added: int
    quotation_credits_added: int
    current_period_ends_at: str | None = None


class BillingHistoryItem(BaseModel):
    id: str
    plan_key: str
    amount_paise: int
    currency: str
    credits: int
    duration_months: int
    estimated_monthly_invoices: int | None = None
    estimated_employees: int | None = None
    status: str
    provider_order_id: str
    provider_payment_id: str | None = None
    paid_at: str | None = None
    created_at: str


class BillingStatusResponse(BaseModel):
    payments: list[BillingHistoryItem]
