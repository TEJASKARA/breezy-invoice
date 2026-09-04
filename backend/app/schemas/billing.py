from typing import Literal

from pydantic import BaseModel, Field

PlanKey = Literal["quarterly", "half_yearly", "annual"]


class BillingOrderRequest(BaseModel):
    workspace_id: str = Field(min_length=36, max_length=36)
    plan_key: PlanKey


class BillingOrderResponse(BaseModel):
    order_id: str
    key_id: str
    amount: int
    currency: Literal["INR"] = "INR"
    plan_key: PlanKey
    plan_name: str
    credits: int
    duration_months: int


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
    current_period_ends_at: str | None = None


class BillingHistoryItem(BaseModel):
    id: str
    plan_key: str
    amount_paise: int
    currency: str
    credits: int
    duration_months: int
    status: str
    provider_order_id: str
    provider_payment_id: str | None = None
    paid_at: str | None = None
    created_at: str


class BillingStatusResponse(BaseModel):
    payments: list[BillingHistoryItem]
