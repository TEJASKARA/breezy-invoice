import type { Invoice } from "./mvp-store.tsx"

/** Hours after creation during which a generated invoice can still be deleted. */
export const INVOICE_DELETE_WINDOW_HOURS = 24

/**
 * Drafts can always be deleted. A generated invoice (manual or bulk) can be
 * deleted for 24 hours after it was created, to undo mistakes; after that it
 * must be corrected so the audit trail is kept. Replacement invoices and
 * cancelled or amended invoices are never deleted.
 */
export function canDeleteInvoice(invoice: Pick<Invoice, "status" | "createdAt" | "correctsInvoiceId">, now = Date.now()) {
  if (invoice.status === "Draft") return true
  if (invoice.status !== "Generated" || invoice.correctsInvoiceId || !invoice.createdAt) return false
  const created = Date.parse(invoice.createdAt)
  return Number.isFinite(created) && now - created < INVOICE_DELETE_WINDOW_HOURS * 60 * 60 * 1000
}
