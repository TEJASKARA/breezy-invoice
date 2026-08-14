import type { User } from "@supabase/supabase-js"

import { supabase } from "@/lib/supabase"

export type WorkspaceRole = "owner" | "admin" | "hr" | "accountant" | "viewer" | "custom"
export type WorkspacePermission =
  | "workspace.read" | "workspace.manage" | "team.manage"
  | "entities.read" | "entities.manage"
  | "invoices.read" | "invoices.manage"
  | "payslips.read" | "payslips.manage"
  | "expenses.read" | "expenses.manage"
  | "data_export.read" | "data_export.manage"
  | "templates.read" | "templates.manage"

export type Workspace = {
  id: string
  owner_user_id: string
  name: string
  subscription_code: string
  status: "active" | "suspended" | "closed"
  created_at: string
}

export type WorkspaceMembership = {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  permissions: WorkspacePermission[]
  status: "invited" | "active" | "disabled"
  joined_at: string | null
}

export type WorkspaceSubscription = {
  id: string
  workspace_id: string
  plan_key: string
  status: "trialing" | "active" | "past_due" | "paused" | "cancelled" | "expired"
  trial_ends_at: string | null
  current_period_ends_at: string | null
  cancel_at_period_end: boolean
  limits: Record<string, unknown>
}

export type WorkspaceMember = WorkspaceMembership & {
  profile: { full_name: string; email: string | null; avatar_path: string | null } | null
}

export type WorkspaceInvitation = {
  id: string
  email: string
  role: Exclude<WorkspaceRole, "owner">
  permissions: WorkspacePermission[]
  status: "pending" | "accepted" | "revoked" | "expired"
  expires_at: string
  created_at: string
}

export function allowsWorkspacePermission(membership: WorkspaceMembership | null, permission: WorkspacePermission) {
  if (!membership || membership.status !== "active") return false
  if (membership.role === "owner" || membership.role === "admin") return true
  if (membership.permissions.includes(permission)) return true
  if (permission.endsWith(".read")) {
    return membership.permissions.includes(permission.replace(/\.read$/, ".manage") as WorkspacePermission)
  }
  return false
}

export async function loadWorkspaceAccess(user: User) {
  if (!supabase) throw new Error("Supabase is not configured.")
  let membershipResult = await supabase
    .from("breezy_workspace_members")
    .select("id, workspace_id, user_id, role, permissions, status, joined_at")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (membershipResult.error) throw new Error(membershipResult.error.message)
  if (!membershipResult.data?.workspace_id) {
    const ensured = await supabase.rpc("breezy_ensure_my_workspace")
    if (ensured.error) {
      const missingFunction = ensured.error.code === "PGRST202" || ensured.error.message.includes("breezy_ensure_my_workspace")
      throw new Error(missingFunction
        ? "Workspace setup is not installed in Supabase yet. Ask the administrator to run the latest BreezyInvoice workspace migration."
        : ensured.error.message)
    }
    membershipResult = await supabase
      .from("breezy_workspace_members")
      .select("id, workspace_id, user_id, role, permissions, status, joined_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    if (membershipResult.error) throw new Error(membershipResult.error.message)
  }
  const membership = membershipResult.data as WorkspaceMembership | null
  if (!membership) return { membership: null, workspace: null, subscription: null }

  const [workspaceResult, subscriptionResult] = await Promise.all([
    supabase.from("breezy_workspaces").select("id, owner_user_id, name, subscription_code, status, created_at").eq("id", membership.workspace_id).single(),
    supabase.from("breezy_subscriptions").select("id, workspace_id, plan_key, status, trial_ends_at, current_period_ends_at, cancel_at_period_end, limits").eq("workspace_id", membership.workspace_id).maybeSingle(),
  ])
  if (workspaceResult.error) throw new Error(workspaceResult.error.message)
  if (subscriptionResult.error) throw new Error(subscriptionResult.error.message)
  return {
    membership,
    workspace: workspaceResult.data as Workspace,
    subscription: subscriptionResult.data as WorkspaceSubscription | null,
  }
}

export const permissionOptions: { permission: WorkspacePermission; label: string }[] = [
  { permission: "entities.read", label: "View entities" },
  { permission: "entities.manage", label: "Manage entities" },
  { permission: "invoices.read", label: "View invoices" },
  { permission: "invoices.manage", label: "Manage invoices" },
  { permission: "payslips.read", label: "View employees and payslips" },
  { permission: "payslips.manage", label: "Manage employees and payslips" },
  { permission: "expenses.read", label: "View expenses" },
  { permission: "expenses.manage", label: "Manage expenses" },
  { permission: "data_export.read", label: "View Data Export" },
  { permission: "data_export.manage", label: "Create exports and ledger mappings" },
  { permission: "templates.read", label: "View templates" },
  { permission: "templates.manage", label: "Edit templates" },
  { permission: "team.manage", label: "Manage team access" },
]

export function permissionsForRole(role: Exclude<WorkspaceRole, "owner">): WorkspacePermission[] {
  if (role === "admin") return []
  if (role === "hr") return ["entities.read", "payslips.read", "payslips.manage"]
  if (role === "accountant") return ["entities.read", "invoices.read", "invoices.manage", "expenses.read", "expenses.manage", "data_export.read", "data_export.manage"]
  if (role === "viewer") return ["entities.read", "invoices.read", "payslips.read", "expenses.read"]
  return []
}

export async function loadWorkspacePeople(workspaceId: string) {
  if (!supabase) throw new Error("Supabase is not configured.")
  const [membersResult, invitationsResult] = await Promise.all([
    supabase.from("breezy_workspace_members").select("id, workspace_id, user_id, role, permissions, status, joined_at").eq("workspace_id", workspaceId).order("created_at"),
    supabase.from("breezy_workspace_invitations").select("id, email, role, permissions, status, expires_at, created_at").eq("workspace_id", workspaceId).eq("status", "pending").order("created_at", { ascending: false }),
  ])
  if (membersResult.error) throw new Error(membersResult.error.message)
  if (invitationsResult.error) throw new Error(invitationsResult.error.message)
  const userIds = (membersResult.data || []).map((member) => member.user_id)
  const profilesResult = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email, avatar_path").in("id", userIds)
    : { data: [], error: null }
  if (profilesResult.error) throw new Error(profilesResult.error.message)
  const profiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]))
  const members = (membersResult.data || []).map((member) => ({ ...member, profile: profiles.get(member.user_id) || null }) as WorkspaceMember)
  return { members, invitations: (invitationsResult.data || []) as WorkspaceInvitation[] }
}

export async function inviteWorkspaceUser(workspaceId: string, email: string, role: Exclude<WorkspaceRole, "owner">, permissions: WorkspacePermission[]) {
  if (!supabase) throw new Error("Supabase is not configured.")
  const { error } = await supabase.rpc("breezy_invite_workspace_user", { target_workspace_id: workspaceId, target_email: email, target_role: role, target_permissions: permissions })
  if (error) throw new Error(error.message)
}

export async function updateWorkspaceMember(workspaceId: string, userId: string, role: Exclude<WorkspaceRole, "owner">, permissions: WorkspacePermission[], status: "active" | "disabled") {
  if (!supabase) throw new Error("Supabase is not configured.")
  const { error } = await supabase.rpc("breezy_update_workspace_member", { target_workspace_id: workspaceId, target_user_id: userId, target_role: role, target_permissions: permissions, target_status: status })
  if (error) throw new Error(error.message)
}

export async function revokeWorkspaceInvitation(workspaceId: string, invitationId: string) {
  if (!supabase) throw new Error("Supabase is not configured.")
  const { error } = await supabase.rpc("breezy_revoke_workspace_invitation", { target_workspace_id: workspaceId, target_invitation_id: invitationId })
  if (error) throw new Error(error.message)
}
