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
