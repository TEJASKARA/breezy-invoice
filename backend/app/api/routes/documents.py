from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.routes.gst import _bearer_token
from app.core.config import Settings, get_settings
from app.schemas.documents import (
    DocumentEmailRequest,
    DocumentEmailResponse,
    DocumentWhatsAppRequest,
    DocumentWhatsAppResponse,
    EmployeeLetterEmailRequest,
    EmployeeLetterEmailResponse,
)
from app.services.email_sender import (
    EmailConfigurationError,
    EmailDeliveryError,
    send_document_email,
    send_employee_letter_email,
)
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError
from app.services.whatsapp_sender import (
    WhatsAppConfigurationError,
    WhatsAppDeliveryError,
    send_document_whatsapp,
)

router = APIRouter()


@router.post("/document-email", response_model=DocumentEmailResponse)
async def email_document(
    request: DocumentEmailRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> DocumentEmailResponse:
    gateway = SupabaseGateway(settings)
    access_token = _bearer_token(authorization)
    try:
        await gateway.authenticated_user(access_token)
        await gateway.assert_workspace_permission(
            access_token, request.workspace_id, "invoices.read"
        )
        await gateway.assert_workspace_document(
            request.workspace_id, request.document_id, request.document_type
        )
        await send_document_email(
            settings,
            to_email=request.to_email,
            subject=request.subject.strip(),
            message=request.message.strip(),
            filename=request.filename,
            pdf_base64=request.pdf_base64,
        )
    except (EmailConfigurationError, EmailDeliveryError, SupabaseGatewayError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return DocumentEmailResponse(
        message=f"The {request.document_type} was emailed to {request.to_email}."
    )


@router.post("/document-whatsapp", response_model=DocumentWhatsAppResponse)
async def whatsapp_document(
    request: DocumentWhatsAppRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> DocumentWhatsAppResponse:
    gateway = SupabaseGateway(settings)
    access_token = _bearer_token(authorization)
    try:
        user = await gateway.authenticated_user(access_token)
        await gateway.assert_workspace_permission(
            access_token, request.workspace_id, "invoices.read"
        )
        await gateway.assert_workspace_document(
            request.workspace_id, request.document_id, request.document_type
        )
        await send_document_whatsapp(
            settings,
            to_number=request.to_number,
            message=request.message.strip(),
            filename=request.filename,
            pdf_base64=request.pdf_base64,
            document_type=request.document_type,
            document_number=request.document_number.strip(),
            document_id=request.document_id,
            workspace_id=request.workspace_id,
            sent_by_user_id=str(user.get("id") or ""),
            sent_by_email=str(user.get("email") or ""),
        )
    except WhatsAppConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except WhatsAppDeliveryError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return DocumentWhatsAppResponse(
        message=(
            f"The {request.document_type} was sent on WhatsApp "
            f"to +{request.to_number}."
        )
    )


@router.post("/employee-letter-email", response_model=EmployeeLetterEmailResponse)
async def email_employee_letter(
    request: EmployeeLetterEmailRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> EmployeeLetterEmailResponse:
    gateway = SupabaseGateway(settings)
    access_token = _bearer_token(authorization)
    try:
        await gateway.authenticated_user(access_token)
        await gateway.assert_workspace_permission(
            access_token, request.workspace_id, "payslips.manage"
        )
        await gateway.assert_workspace_employee_letter(
            request.workspace_id, request.letter_id, request.to_email
        )
        await send_employee_letter_email(
            settings,
            to_email=request.to_email.strip().lower(),
            subject=request.subject.strip(),
            message=request.message.strip(),
            filename=request.filename,
            pdf_base64=request.pdf_base64,
        )
    except (EmailConfigurationError, EmailDeliveryError, SupabaseGatewayError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return EmployeeLetterEmailResponse(
        message=f"The letter was emailed to {request.to_email.strip().lower()}."
    )
