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


class DocumentWhatsAppRequest(BaseModel):
    workspace_id: str = Field(min_length=36, max_length=36)
    document_id: str = Field(min_length=36, max_length=36)
    to_number: str = Field(min_length=8, max_length=24)
    document_type: Literal["invoice", "quotation"]
    document_number: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=1000)
    filename: str = Field(min_length=1, max_length=240)
    pdf_base64: str = Field(min_length=4, max_length=20_000_000)

    @field_validator("to_number")
    @classmethod
    def valid_whatsapp_number(cls, value: str) -> str:
        """Returns digits only with country code, e.g. 919876543210."""
        cleaned = re.sub(r"[\s\-().]", "", value.strip())
        if cleaned.startswith("+"):
            cleaned = cleaned[1:]
        elif cleaned.startswith("00"):
            cleaned = cleaned[2:]
        if not cleaned.isdigit():
            raise ValueError("Enter a valid WhatsApp number using digits only.")
        # A bare 10-digit Indian mobile number: add the country code.
        if len(cleaned) == 10 and cleaned[0] in "6789":
            cleaned = f"91{cleaned}"
        elif len(cleaned) == 11 and cleaned.startswith("0") and cleaned[1] in "6789":
            cleaned = f"91{cleaned[1:]}"
        if not 10 <= len(cleaned) <= 15 or cleaned.startswith("0"):
            raise ValueError(
                "Enter the WhatsApp number with its country code, e.g. +91 98765 43210."
            )
        return cleaned

    @field_validator("filename")
    @classmethod
    def pdf_filename(cls, value: str) -> str:
        cleaned = re.sub(r"[\\/\r\n\x00]", "_", value.strip())
        return cleaned if cleaned.lower().endswith(".pdf") else f"{cleaned}.pdf"


class DocumentWhatsAppResponse(BaseModel):
    message: str
