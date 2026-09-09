import { supabase } from "@/lib/supabase"
import type { WorkspacePermission, WorkspaceRole } from "@/lib/workspace-access-service"

const apiUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "")

type InvitationResult = {
  kind: "member" | "invitation"
  email: string
  email_sent: boolean
  message: string
}

export async function sendWorkspaceInvitation(
  workspaceId: string,
  email: string,
  role: Exclude<WorkspaceRole, "owner">,
  permissions: WorkspacePermission[],
): Promise<InvitationResult> {
  if (!apiUrl) throw new Error("The ChanaX backend URL has not been configured.")
  if (!supabase) throw new Error("Supabase is not configured.")
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("Sign in again to invite a team member.")

  const response = await fetch(`${apiUrl}/api/v1/team/invitations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspace_id: workspaceId, email, role, permissions }),
  })
  let payload: unknown
  try { payload = await response.json() } catch { payload = null }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? String((payload as { detail?: unknown }).detail || "")
      : ""
    if (detail.includes("Purchase an additional monthly seat")) {
      throw new Error("Both included additional-user seats are already reserved. Disable a team member or add a paid seat before inviting another person.")
    }
    throw new Error(detail || "The invitation could not be sent.")
  }
  return payload as InvitationResult
}
