import type { Setup } from "@/lib/mvp-store"
import type { WorkspaceCreditAccount, WorkspaceSubscription } from "@/lib/workspace-access-service"

export type FreeDocumentKind = "invoice" | "payslip"

export type FreeDocumentAllowance = {
  kind: FreeDocumentKind
  limit: number
  used: number
  remaining: number
  hasGstin: boolean
  gstStatus: WorkspaceCreditAccount["gst_status"]
}

function savedUsage(subscription: WorkspaceSubscription, kind: FreeDocumentKind) {
  const value = Number(subscription.limits[kind === "invoice" ? "invoiceUsage" : "payslipUsage"])
  return Number.isFinite(value) && value >= 0 ? value : 0
}

export function hasRegisteredGstin(setup: Setup | null) {
  return setup?.hasGstin ?? Boolean(setup?.gstin?.trim())
}

export function getFreeDocumentAllowance(
  setup: Setup | null,
  subscription: WorkspaceSubscription | null,
  creditAccount: WorkspaceCreditAccount | null,
  kind: FreeDocumentKind,
  recordsCurrentlySaved: number,
): FreeDocumentAllowance | null {
  if (creditAccount) {
    const limit = creditAccount.free_credits_granted + creditAccount.monthly_credits_remaining + creditAccount.topup_credits_remaining
    const used = creditAccount.free_credits_used
    const remaining = Math.max(0, creditAccount.free_credits_granted - used) + creditAccount.monthly_credits_remaining + creditAccount.topup_credits_remaining
    return { kind, limit, used, remaining, hasGstin: creditAccount.gst_status === "verified", gstStatus: creditAccount.gst_status }
  }
  if (!subscription || subscription.plan_key !== "free") return null
  const hasGstin = hasRegisteredGstin(setup)
  const limit = 10
  const used = Math.max(recordsCurrentlySaved, savedUsage(subscription, kind))
  return { kind, limit, used, remaining: Math.max(0, limit - used), hasGstin: false, gstStatus: hasGstin ? "provisional" : "no_gst" }
}

export function freeAllowanceError(allowance: FreeDocumentAllowance | null, requested: number) {
  if (!allowance || requested <= allowance.remaining) return null
  const documentName = allowance.kind === "invoice" ? "invoice" : "payslip"
  return `Your workspace has ${allowance.remaining} shared document credit${allowance.remaining === 1 ? "" : "s"} remaining, so this request for ${requested} ${documentName}${requested === 1 ? "" : "s"} cannot be saved.`
}
