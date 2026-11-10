import { customerErrorMessage } from "@/lib/customer-errors"
import type { GstVerification } from "@/lib/gst-api"
import type { Company, Setup } from "@/lib/mvp-store"
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
  if (!apiUrl) throw new Error("This service is temporarily unavailable. Please try again later.")
  if (!supabase) throw new Error("Your account connection is temporarily unavailable. Please try again later.")
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
    const raw = payload && typeof payload === "object" && "detail" in payload
      ? (payload as { detail?: unknown }).detail
      : ""
    const detail = Array.isArray(raw)
      ? raw.map((item) => (item && typeof item === "object" && "msg" in item ? String(item.msg) : String(item))).join("; ")
      : String(raw || "")
    // Platform admins are developers: show the real reason, not sanitised customer copy.
    customerErrorMessage({ message: detail, status: response.status }, "The platform administration request failed.")
    throw new Error(`${detail || "The platform administration request failed."} (HTTP ${response.status})`)
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
export function requestPlatformPurge(subscriptionCode: string, reason: string) { return adminRequest<{ request_id: string; message: string }>("/api/v1/admin/data-lifecycle/purge-requests", { method: "POST", body: JSON.stringify({ subscription_code: subscriptionCode, reason }) }) }
export function approvePlatformPurge(requestId: string, code: string) { return adminRequest<{ message: string }>("/api/v1/admin/data-lifecycle/purge-approvals", { method: "POST", body: JSON.stringify({ request_id: requestId, code }) }) }

export type UsageScope =
  | { type: "platform" }
  | { type: "workspace"; workspace_id: string; name: string; subscription_code: string; status: string; owner_email: string | null; created_at: string }
  | { type: "user"; user_id: string; email: string | null; signed_up_at: string; last_sign_in_at: string | null; workspaces: { workspace_id: string; name: string; subscription_code: string; role: string }[] }

export type UsageExtras = {
  anonymous_site_views: number
  new_users: { day: string; email: string | null; phone: string | null }[]
  daily_signups: { day: string; users: number }[]
  page_features: { page: string; name: string; uses: number; users: number }[]
  /** Signed up but never saved workspace setup. Older backends omit it. */
  setup_pending?: SetupPendingUser[]
  /** Daily sign-ups by method (IST days). */
  signup_methods?: { day: string; phone: number; email: number }[]
}

export type WorkspaceOverview = {
  workspace_id: string
  name: string
  subscription_code: string
  status: string
  business: {
    firm_name: string | null
    legal_name: string | null
    trade_name: string | null
    gstin: string | null
    pan: string | null
    gst_registration_status: string | null
    has_gstin: boolean
    industry: string | null
    mailing_address: string | null
    setup_completed: boolean
  }
  gst_status: string | null
  verified_gstin: string | null
  entities: { name: string | null; gstin: string | null; moved: boolean }[]
  invoices: { total: number; generated: number; draft: number; cancelled: number; in_period: number }
  quotations: { total: number; converted: number; in_period: number }
}

export type SetupPendingUser = {
  user_id: string
  email: string | null
  phone: string | null
  full_name: string | null
  signed_up_at: string
  last_sign_in_at: string | null
  workspace_id: string
  subscription_code: string
}

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
  extras?: UsageExtras
  /** Workspace / user views: company, GST and document counts. */
  workspace_overviews?: WorkspaceOverview[]
}

/** Developer-only usage report: whole platform, one subscription code, or one user email. */
export function loadUsageReport(days: number, identifier?: string) {
  const query = new URLSearchParams({ days: String(days) })
  if (identifier?.trim()) query.set("query", identifier.trim())
  return adminRequest<UsageReport>(`/api/v1/admin/usage?${query}`)
}


export type SetupTarget = {
  user_id: string
  email: string | null
  phone: string | null
  full_name: string | null
  account_type: "unselected" | "ca" | "founder" | "employee" | string
  signed_up_at: string | null
  last_sign_in_at: string | null
  workspace_id: string | null
  workspace_name: string | null
  subscription_code: string | null
  workspace_status: string | null
  setup_completed: boolean
  active_entities: number
}

export type CompleteSetupResult = {
  message: string
  workspace_id: string
  subscription_code: string | null
  email: string | null
  gst_verified: boolean
  email_sent: boolean
}

/** Find a user by email or subscription code, with their setup state. */
export function findSetupTarget(identifier: string) {
  const query = new URLSearchParams({ query: identifier.trim() })
  return adminRequest<SetupTarget>(`/api/v1/admin/user-setup?${query}`)
}

/** Registered GST details for the target workspace (nothing is saved). */
export function lookupSetupGstin(workspaceId: string, gstin: string) {
  const query = new URLSearchParams({ workspace_id: workspaceId, gstin: gstin.trim().toUpperCase() })
  return adminRequest<GstVerification>(`/api/v1/admin/user-setup/gstin?${query}`)
}

/** Completes onboarding on the user's behalf and (optionally) emails them. */
export function completeUserSetup(input: { workspaceId: string; setup: Setup; entity: Company; notifyUser: boolean }) {
  const { id: entityId, ...entity } = input.entity
  return adminRequest<CompleteSetupResult>("/api/v1/admin/user-setup", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      entity_id: entityId,
      setup: input.setup,
      entity,
      notify_user: input.notifyUser,
    }),
  })
}

/** Admin screens are for ChanaX developers: show the real failure reason, never the sanitised customer copy. */
export function adminErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && /^(load failed|failed to fetch|networkerror|network request failed)/i.test(error.message.trim())) {
    return "The server did not answer (network error, or the request was too large and rejected by the web server). Check your connection, then nginx client_max_body_size on api.chanax.in."
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === "string" && error.trim()) return error.trim()
  return fallback
}

export type AnalyticsTestAccount = { user_id: string; email: string; note: string | null; created_at: string | null }

/** Accounts (e.g. internal testers) hidden from platform-wide usage analytics. */
export function loadAnalyticsTestAccounts() {
  return adminRequest<{ accounts: AnalyticsTestAccount[] }>("/api/v1/admin/analytics-exclusions").then((result) => result.accounts)
}

export function addAnalyticsTestAccount(email: string, note?: string) {
  return adminRequest<AnalyticsTestAccount>("/api/v1/admin/analytics-exclusions", {
    method: "POST",
    body: JSON.stringify({ email: email.trim(), note: note?.trim() || null }),
  })
}

export async function removeAnalyticsTestAccount(userId: string) {
  await adminRequest<null>(`/api/v1/admin/analytics-exclusions/${encodeURIComponent(userId)}`, { method: "DELETE" })
}

export type MarketingSummary = {
  /** email_outreach rows by email_status; "unsubscribed" counts email_unsubscribed rows. */
  counts: Partial<Record<"pending" | "sending" | "sent" | "failed" | "skipped" | "none" | "unsubscribed", number>>
  sent_today: number
  uploads: {
    id: string
    source: "gst" | "mca"
    file_name: string
    uploaded_by_email: string | null
    total_rows: number
    valid_rows: number
    missing_email: number
    invalid_email: number
    duplicate_in_file: number
    inserted: number
    already_contacted: number
    created_at: string
  }[]
}

export function loadMarketingSummary() {
  return adminRequest<MarketingSummary>("/api/v1/admin/marketing/summary")
}

export function importMarketingLeads(input: {
  source: "gst" | "mca"
  file_name: string
  total_rows: number
  missing_email: number
  invalid_email: number
  duplicate_in_file: number
  leads: unknown[]
}) {
  return adminRequest<{ upload_id: string; inserted: number; already_contacted: number }>("/api/v1/admin/marketing/import", {
    method: "POST",
    body: JSON.stringify(input),
  })
}


export type PaymentLink = {
  id: string
  workspace_id: string
  workspace_name: string | null
  subscription_code: string | null
  short_url: string | null
  description: string
  base_amount_paise: number
  gst_amount_paise: number
  amount_paise: number
  credits: number
  duration_months: number
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  status: "creating" | "created" | "paid" | "cancelled" | "expired" | "failed"
  paid_at: string | null
  created_at: string
}

export function listPaymentLinks() {
  return adminRequest<{ links: PaymentLink[] }>("/api/v1/admin/payment-links").then((result) => result.links)
}

export function createPaymentLink(input: { subscriptionCode: string; baseAmountPaise: number; credits: number; durationMonths: number; description: string; notifyCustomer: boolean }) {
  return adminRequest<PaymentLink>("/api/v1/admin/payment-links", {
    method: "POST",
    body: JSON.stringify({
      subscription_code: input.subscriptionCode.trim(),
      base_amount_paise: input.baseAmountPaise,
      credits: input.credits,
      duration_months: input.durationMonths,
      description: input.description.trim(),
      notify_customer: input.notifyCustomer,
    }),
  })
}

export function refreshPaymentLink(id: string) {
  return adminRequest<PaymentLink>(`/api/v1/admin/payment-links/${encodeURIComponent(id)}/refresh`, { method: "POST" })
}

export function cancelPaymentLink(id: string) {
  return adminRequest<PaymentLink>(`/api/v1/admin/payment-links/${encodeURIComponent(id)}/cancel`, { method: "POST" })
}
