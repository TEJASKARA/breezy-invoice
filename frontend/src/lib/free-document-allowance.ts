import type { Setup } from "@/lib/mvp-store"
import type { WorkspaceSubscription } from "@/lib/workspace-access-service"

export type FreeDocumentKind = "invoice" | "payslip"

export type FreeDocumentAllowance = {
  kind: FreeDocumentKind
  limit: number
  used: number
  remaining: number
  hasGstin: boolean
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
  kind: FreeDocumentKind,
  recordsCurrentlySaved: number,
): FreeDocumentAllowance | null {
  if (!subscription || subscription.plan_key !== "free") return null
  const hasGstin = hasRegisteredGstin(setup)
  const limit = hasGstin ? 15 : 5
  const used = Math.max(recordsCurrentlySaved, savedUsage(subscription, kind))
  return { kind, limit, used, remaining: Math.max(0, limit - used), hasGstin }
}

export function freeAllowanceError(allowance: FreeDocumentAllowance | null, requested: number) {
  if (!allowance || requested <= allowance.remaining) return null
  const documentName = allowance.kind === "invoice" ? "invoice" : "payslip"
  const registration = allowance.hasGstin ? "GST-registered" : "non-GST"
  return `Your free ${registration} workspace includes ${allowance.limit} ${documentName}${allowance.limit === 1 ? "" : "s"}. You have ${allowance.remaining} remaining, so this request for ${requested} cannot be saved.`
}
