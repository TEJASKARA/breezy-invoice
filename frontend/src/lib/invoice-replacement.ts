import type { Company, Customer, Invoice } from "./mvp-store"

export function replacementInvoiceCompany(original: Invoice, replacement: Pick<Invoice, "entityId" | "entityName">, companies: Company[], customers: Customer[]) {
  const originalEntityId = original.entityId || customers.find((customer) => customer.id === original.customerId)?.entityId
  const originalCompany = originalEntityId
    ? companies.find((company) => company.id === originalEntityId)
    : companies.find((company) => company.companyName === original.entityName)
  const replacementCompany = replacement.entityId
    ? companies.find((company) => company.id === replacement.entityId)
    : companies.find((company) => company.companyName === replacement.entityName)
  if (!originalCompany || !replacementCompany || originalCompany.transferredAt || replacementCompany.transferredAt) {
    throw new Error("Select the original invoice's active issuing company to create its replacement.")
  }
  if (originalCompany.id !== replacementCompany.id) {
    throw new Error("The replacement must use the same issuing company as the original invoice. You can change the customer within that company.")
  }
  return originalCompany
}

export function invoiceReplacementSaveOrder(original: Invoice, replacement: Invoice): [Invoice, Invoice] {
  // One upsert request is atomic. Its first row must exist before the second
  // row's trigger checks correction.replacementInvoiceId.
  return [replacement, original]
}

/** Calendar date (YYYY-MM-DD) in the user's local time zone, matching invoice dates. */
export function localDateFromTimestamp(timestamp: string) {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return ""
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
}

/** Older replacements were saved without regeneratedAt: derive it from the cancelled original. */
export function withRegeneratedDates(invoices: Invoice[]): Invoice[] {
  return invoices.map((invoice) => {
    if (!invoice.correctsInvoiceId || invoice.regeneratedAt) return invoice
    const original = invoices.find((candidate) => candidate.id === invoice.correctsInvoiceId)
    const regeneratedAt = original?.correction?.recordedAt ? localDateFromTimestamp(original.correction.recordedAt) : ""
    return regeneratedAt ? { ...invoice, regeneratedAt } : invoice
  })
}
