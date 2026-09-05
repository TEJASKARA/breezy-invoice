import type { Setup } from "@/lib/mvp-store"
import type { WorkspaceCreditAccount, WorkspaceSubscription } from "@/lib/workspace-access-service"

export type FreeDocumentKind = "invoice" | "payslip" | "quotation"

export type FreeDocumentAllowance = {
  kind: FreeDocumentKind
  limit: number
  used: number
  remaining: number
  hasGstin: boolean
  gstStatus: WorkspaceCreditAccount["gst_status"]
}

function savedUsage(subscription: WorkspaceSubscription, kind: FreeDocumentKind) {
  const key = kind === "invoice" ? "invoiceUsage" : kind === "payslip" ? "payslipUsage" : "quotationUsage"
  const value = Number(subscription.limits[key])
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
    const quotation = kind === "quotation"
    const freeGranted = quotation ? creditAccount.free_quotation_credits_granted ?? creditAccount.free_credits_granted : creditAccount.free_credits_granted
    const used = quotation ? creditAccount.free_quotation_credits_used ?? 0 : creditAccount.free_credits_used
    const monthlyRemaining = quotation ? creditAccount.monthly_quotation_credits_remaining ?? creditAccount.monthly_credits_remaining : creditAccount.monthly_credits_remaining
    const topupRemaining = quotation ? creditAccount.topup_quotation_credits_remaining ?? creditAccount.topup_credits_remaining : creditAccount.topup_credits_remaining
    const limit = freeGranted + monthlyRemaining + topupRemaining
    const remaining = Math.max(0, freeGranted - used) + monthlyRemaining + topupRemaining
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
  const documentName = allowance.kind === "invoice" ? "invoice" : allowance.kind === "payslip" ? "payslip" : "quotation"
  const creditName = allowance.kind === "quotation" ? "quotation credit" : "document credit"
  return `Your workspace has ${allowance.remaining} ${creditName}${allowance.remaining === 1 ? "" : "s"} remaining, so this request for ${requested} ${documentName}${requested === 1 ? "" : "s"} cannot be saved.`
}
