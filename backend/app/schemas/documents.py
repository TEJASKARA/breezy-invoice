import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class EmployeeLetterEmailRequest(BaseModel):
    workspace_id: str = Field(min_length=36, max_length=36)
    letter_id: str = Field(min_length=36, max_length=36)
    to_email: str = Field(min_length=3, max_length=320)
    employee_name: str = Field(min_length=1, max_length=200)
    subject: str = Field(min_length=1, max_length=300)
    message: str = Field(min_length=1, max_length=5000)
    filename: str = Field(min_length=1, max_length=240)
    pdf_base64: str = Field(min_length=4, max_length=20_000_000)

    @field_validator("to_email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Enter a valid employee email address.")
        return normalized


class EmployeeLetterEmailResponse(BaseModel):
    message: str


class DocumentEmailRequest(BaseModel):
    workspace_id: str = Field(min_length=36, max_length=36)
    document_id: str = Field(min_length=36, max_length=36)
    to_email: str = Field(min_length=3, max_length=320)
    document_type: Literal["invoice", "quotation"]
    document_number: str = Field(min_length=1, max_length=200)
    subject: str = Field(min_length=1, max_length=300)
    message: str = Field(min_length=1, max_length=5000)
    filename: str = Field(min_length=1, max_length=240)
    pdf_base64: str = Field(min_length=4, max_length=20_000_000)

    @field_validator("to_email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Enter a valid recipient email address.")
        return normalized


class DocumentEmailResponse(BaseModel):
    message: str
