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

function savedUsage(subscription: WorkspaceSubscription) {
  return ["invoiceUsage", "payslipUsage", "quotationUsage"].reduce((total, key) => {
    const value = Number(subscription.limits[key])
    return total + (Number.isFinite(value) && value >= 0 ? value : 0)
  }, 0)
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
  // Invoices, payslips and quotations share one balance.
  if (creditAccount) {
    const freeGranted = creditAccount.free_credits_granted
    const used = creditAccount.free_credits_used
    const monthlyRemaining = creditAccount.monthly_credits_remaining
    const topupRemaining = creditAccount.topup_credits_remaining
    const limit = freeGranted + monthlyRemaining + topupRemaining
    const remaining = Math.max(0, freeGranted - used) + monthlyRemaining + topupRemaining
    return { kind, limit, used, remaining, hasGstin: creditAccount.gst_status === "verified", gstStatus: creditAccount.gst_status }
  }
  if (!subscription || subscription.plan_key !== "free") return null
  const hasGstin = hasRegisteredGstin(setup)
  const limit = 20
  const used = Math.max(recordsCurrentlySaved, savedUsage(subscription))
  return { kind, limit, used, remaining: Math.max(0, limit - used), hasGstin: false, gstStatus: hasGstin ? "provisional" : "no_gst" }
}

export function freeAllowanceError(allowance: FreeDocumentAllowance | null, requested: number) {
  if (!allowance || requested <= allowance.remaining) return null
  const documentName = allowance.kind === "invoice" ? "invoice" : allowance.kind === "payslip" ? "payslip" : "quotation"
  return `Your workspace has ${allowance.remaining} credit${allowance.remaining === 1 ? "" : "s"} remaining, so this request for ${requested} ${documentName}${requested === 1 ? "" : "s"} cannot be saved.`
}
