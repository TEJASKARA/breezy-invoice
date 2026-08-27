from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.routes.gst import _bearer_token
from app.core.config import Settings, get_settings
from app.schemas.team import TeamInvitationRequest, TeamInvitationResponse
from app.services.supabase_gateway import SupabaseGateway, SupabaseGatewayError

router = APIRouter()


def _rpc_invitation_result(value: Any, email: str) -> dict[str, str]:
    if isinstance(value, list) and value:
        value = value[0]
    if not isinstance(value, dict):
        raise SupabaseGatewayError("Supabase returned an invalid invitation result.")
    kind = str(value.get("kind") or "")
    if kind not in {"member", "invitation"}:
        raise SupabaseGatewayError("Supabase returned an invalid invitation type.")
    return {"kind": kind, "email": str(value.get("email") or email)}


@router.post("/invitations", response_model=TeamInvitationResponse)
async def create_team_invitation(
    invitation: TeamInvitationRequest,
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> TeamInvitationResponse:
    access_token = _bearer_token(authorization)
    gateway = SupabaseGateway(settings)
    normalized_email = invitation.email.strip().lower()
    try:
        await gateway.authenticated_user(access_token)
        result = _rpc_invitation_result(
            await gateway.user_rpc(
                access_token,
                "breezy_invite_workspace_user",
                {
                    "target_workspace_id": invitation.workspace_id,
                    "target_email": normalized_email,
                    "target_role": invitation.role,
                    "target_permissions": invitation.permissions,
                },
            ),
            normalized_email,
        )
        if result["kind"] == "member":
            return TeamInvitationResponse(
                kind="member",
                email=result["email"],
                email_sent=False,
                message="This existing ChanaX user now has workspace access.",
            )

        try:
            await gateway.send_auth_invitation(
                result["email"],
                settings.team_invite_redirect_url,
                {"invited_to_workspace": invitation.workspace_id},
            )
        except SupabaseGatewayError:
            await gateway.user_rpc(
                access_token,
                "breezy_revoke_workspace_invitation_by_email",
                {
                    "target_workspace_id": invitation.workspace_id,
                    "target_email": result["email"],
                },
            )
            raise

        return TeamInvitationResponse(
            kind="invitation",
            email=result["email"],
            email_sent=True,
            message="Invitation email sent.",
        )
    except SupabaseGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
