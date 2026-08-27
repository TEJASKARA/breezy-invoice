from typing import Literal

from pydantic import BaseModel, Field

WorkspaceRole = Literal["admin", "hr", "accountant", "viewer", "custom"]


class TeamInvitationRequest(BaseModel):
    workspace_id: str = Field(min_length=36, max_length=36)
    email: str = Field(min_length=3, max_length=320)
    role: WorkspaceRole
    permissions: list[str] = Field(default_factory=list, max_length=15)


class TeamInvitationResponse(BaseModel):
    kind: Literal["member", "invitation"]
    email: str
    email_sent: bool
    message: str
