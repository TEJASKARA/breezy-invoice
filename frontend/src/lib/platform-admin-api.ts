import { supabase } from "@/lib/supabase"

const apiUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "")

export type PlatformWorkspace = {
  workspace_id: string
  name: string
  subscription_code: string
  status: "active" | "suspended" | "closed"
  document_credits_remaining: number
  quotation_credits_remaining: number
  matched_email: string | null
}

export type CreditGrantResult = {
  workspace_id: string
  credits_added: number
  quotation_credits_added: number
  topup_credits_remaining: number
  topup_quotation_credits_remaining: number
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiUrl) throw new Error("The ChanaX backend URL has not been configured.")
  if (!supabase) throw new Error("Supabase is not configured.")
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("Sign in again to access platform administration.")
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })
  let payload: unknown = null
  try { payload = await response.json() } catch { /* handled below */ }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? String((payload as { detail?: unknown }).detail || "")
      : ""
    throw new Error(detail || "The platform administration request failed.")
  }
  return payload as T
}

export function loadPlatformAdminAccess() {
  return adminRequest<{ is_super_admin: boolean }>("/api/v1/admin/me")
    .then((result) => result.is_super_admin)
}

export function findPlatformWorkspaces(identifier: string) {
  const query = new URLSearchParams({ query: identifier.trim() })
  return adminRequest<{ workspaces: PlatformWorkspace[] }>(
    `/api/v1/admin/workspaces?${query}`,
  ).then((result) => result.workspaces)
}

export function grantPlatformCredits(subscriptionCode: string, creditAmount: number, reason: string) {
  return adminRequest<CreditGrantResult>("/api/v1/admin/credit-grants", {
    method: "POST",
    body: JSON.stringify({
      subscription_code: subscriptionCode.trim(),
      credit_amount: creditAmount,
      reason: reason.trim(),
    }),
  })
}

export type UsageScope =
  | { type: "platform" }
  | { type: "workspace"; workspace_id: string; name: string; subscription_code: string; status: string; owner_email: string | null; created_at: string }
  | { type: "user"; user_id: string; email: string; signed_up_at: string; last_sign_in_at: string | null; workspaces: { workspace_id: string; name: string; subscription_code: string; role: string }[] }

export type UsageReport = {
  since_days: number
  generated_at: string
  scope: UsageScope
  totals: {
    page_views: number
    actions: number
    active_users: number
    active_workspaces: number
    last_activity_at: string | null
    /** Platform view only: every subscriber workspace, and those created in the period. */
    total_workspaces?: number
    new_workspaces?: number
  }
  pages: { name: string; views: number; users: number; workspaces: number; last_used_at: string }[]
  features: { name: string; uses: number; items: number; users: number; workspaces: number; last_used_at: string }[]
  daily: { day: string; page_views: number; actions: number; active_users: number }[]
  users: { user_id: string; email: string | null; events: number; actions: number; last_seen_at: string; last_page: string | null }[]
  workspaces: { workspace_id: string; name: string; subscription_code: string; owner_email: string | null; events: number; actions: number; users: number; last_seen_at: string }[]
  /** Platform view only: subscriber workspaces with no activity in the period. */
  inactive_workspaces: { workspace_id: string; name: string; subscription_code: string; status: string; owner_email: string | null; created_at: string; last_activity_at: string | null }[]
  recent: { occurred_at: string; event_type: "page_view" | "action"; event_name: string; email: string | null; subscription_code: string | null }[]
}

/** Developer-only usage report: whole platform, one subscription code, or one user email. */
export function loadUsageReport(days: number, identifier?: string) {
  const query = new URLSearchParams({ days: String(days) })
  if (identifier?.trim()) query.set("query", identifier.trim())
  return adminRequest<UsageReport>(`/api/v1/admin/usage?${query}`)
}
