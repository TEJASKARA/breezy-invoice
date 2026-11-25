import base64
import binascii
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.api.routes.gst import _bearer_token
from app.core.config import Settings, get_settings
from app.services.file_signature import FileRejected, clean_bill, safe_name
from app.services.malware_scan import MalwareFound, ScannerUnavailable, scan_bytes
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError

router = APIRouter()

MAX_BILL_BYTES = 5 * 1024 * 1024


class ExpenseBillRequest(BaseModel):
    workspace_id: str = Field(min_length=36, max_length=36)
    file_name: str = Field(min_length=1, max_length=240)
    data_base64: str = Field(min_length=4, max_length=7_500_000)


class ExpenseBillResponse(BaseModel):
    path: str
    file_name: str
    content_type: str
    size_bytes: int


@router.post("", response_model=ExpenseBillResponse)
async def upload_expense_bill(
    request: ExpenseBillRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ExpenseBillResponse:
    """Check an expense bill's real content, then store it.

    Browsers can no longer write to the bill bucket directly, so every stored bill
    has passed through this check.
    """
    access_token = _bearer_token(authorization)
    gateway = SupabaseGateway(settings)
    try:
        user = await gateway.authenticated_user(access_token)
        await gateway.assert_workspace_permission(
            access_token, request.workspace_id, "expenses.manage"
        )
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    try:
        raw = base64.b64decode(request.data_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The file could not be read.",
        ) from exc
    if len(raw) > MAX_BILL_BYTES:
        raise HTTPException(
            status_code=413,
            detail="The bill must be smaller than 5 MB.",
        )
    try:
        content, mime = clean_bill(raw)
    except FileRejected as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    try:
        await scan_bytes(settings, content)
    except MalwareFound as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This file was blocked because it may contain a virus.",
        ) from exc
    except ScannerUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Files cannot be checked right now. Please try again shortly.",
        ) from exc
    name = safe_name(request.file_name, mime)
    path = f"{user['id']}/{uuid.uuid4()}/{name}"
    try:
        await gateway.save_expense_bill(path, content, mime)
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc
    return ExpenseBillResponse(
        path=path, file_name=name, content_type=mime, size_bytes=len(content)
    )
