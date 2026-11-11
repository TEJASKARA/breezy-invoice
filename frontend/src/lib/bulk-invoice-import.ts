import type { Company, Customer, Invoice, InvoiceLineItem } from "./mvp-store"
import { normalizeSpreadsheetDate, parseDocumentStatus, pickCell } from "./spreadsheet.ts"

export type ImportCustomer = Omit<Customer, "id">
export type ImportInvoice = Omit<Invoice, "id" | "number">
export type BulkRowResult =
  | { ok: true; invoice: ImportInvoice; newCustomer?: ImportCustomer }
  | { ok: false; row: number; reason: string }

const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const hsnSacPattern = /^(?:[0-9]{4}|[0-9]{6}|[0-9]{8})$/
/** CGST/SGST are half of these; IGST uses the full rate. */
const GST_RATES = new Set([0.05, 0.1, 0.125, 0.25, 0.75, 1, 1.5, 2.5, 3, 5, 6, 9, 12, 14, 18, 28, 40])

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const money = (value: string) => {
  const cleaned = value.replace(/[₹,\s]/g, "")
  return cleaned ? Number(cleaned) : NaN
}

type TaxInput = { rate?: number; amount?: number }

/** A tax column can hold a rate ("2.5", "2.5%", a "CGST %" column) or an amount. */
function readTax(row: Record<string, unknown>, name: "CGST" | "SGST" | "IGST", base: number): TaxInput | null {
  const rateCell = pickCell(row, `${name} %`, `${name} Rate`, `${name} Percent`, `${name} Percentage`)
  if (rateCell) {
    const rate = money(rateCell.replace("%", ""))
    return Number.isFinite(rate) && rate >= 0 ? { rate } : null
  }
  const cell = pickCell(row, `${name} Amount`, name, `${name} Amt`)
  if (!cell) return {}
  if (cell.endsWith("%")) {
    const rate = money(cell.slice(0, -1))
    return Number.isFinite(rate) && rate >= 0 ? { rate } : null
  }
  const value = money(cell)
  if (!Number.isFinite(value) || value < 0) return null
  // "2.5" next to an invoice of thousands is a rate, not ₹2.50 of tax.
  if (value > 0 && GST_RATES.has(value) && base > 0 && value < base / 100) return { rate: value }
  return { amount: value }
}

export type ResolvedAmounts = { taxableAmount: number; cgstAmount: number; sgstAmount: number; igstAmount: number; amount: number }

/** Taxable value from either the taxable amount or the invoice total, with tax given as rates or amounts. */
export function resolveAmounts(input: { taxable: number; total: number; cgst: TaxInput; sgst: TaxInput; igst: TaxInput }): ResolvedAmounts | null {
  const taxes = [input.cgst, input.sgst, input.igst]
  const fixed = taxes.reduce((sum, tax) => sum + (tax.amount || 0), 0)
  const rateSum = taxes.reduce((sum, tax) => sum + (tax.rate || 0), 0)
  let taxable: number
  if (Number.isFinite(input.taxable) && input.taxable > 0) taxable = round2(input.taxable)
  else if (Number.isFinite(input.total) && input.total > 0) taxable = round2((input.total - fixed) / (1 + rateSum / 100))
  else return null
  if (!(taxable > 0)) return null
  const amountOf = (tax: TaxInput) => tax.rate !== undefined ? round2(taxable * tax.rate / 100) : round2(tax.amount || 0)
  let cgstAmount = amountOf(input.cgst)
  let sgstAmount = amountOf(input.sgst)
  const igstAmount = amountOf(input.igst)
  const computedTotal = round2(taxable + cgstAmount + sgstAmount + igstAmount)
  const usedTotal = !(Number.isFinite(input.taxable) && input.taxable > 0) && Number.isFinite(input.total) && input.total > 0
  if (usedTotal) {
    // Keep the invoice total exactly as entered: rounding paise go to the taxable value.
    const difference = round2(input.total - computedTotal)
    if (difference !== 0) taxable = round2(taxable + difference)
    return { taxableAmount: taxable, cgstAmount, sgstAmount, igstAmount, amount: round2(input.total) }
  }
  if (cgstAmount < 0) cgstAmount = 0
  if (sgstAmount < 0) sgstAmount = 0
  const total = Number.isFinite(input.total) && input.total > 0 ? round2(input.total) : computedTotal
  return { taxableAmount: taxable, cgstAmount, sgstAmount, igstAmount, amount: total }
}

/**
 * One workbook row. B2B (a GSTIN is given or saved) needs a valid GSTIN and a
 * billing address, and HSN/SAC when the entity is GST-registered. B2C needs
 * only the customer name; everything else is optional.
 */
export function parseBulkInvoiceRow(
  row: Record<string, unknown>,
  rowNumber: number,
  context: { entity?: Company; entityName: string; isGstEntity: boolean; savedCustomers: Customer[] },
): BulkRowResult {
  const fail = (reason: string): BulkRowResult => ({ ok: false, row: rowNumber, reason })
  const customerName = pickCell(row, "Customer Name", "Company Name", "Customer", "Party Name", "Name").replace(/\s+/g, " ")
  if (!customerName) return fail("customer name is missing")
  const saved = context.savedCustomers.find((customer) => customer.companyName.trim().toLowerCase() === customerName.toLowerCase())

  const suppliedGstin = pickCell(row, "GSTIN", "GST Number", "GST No").toUpperCase().replace(/\s+/g, "")
  if (suppliedGstin && !gstinPattern.test(suppliedGstin)) return fail(`GSTIN ${suppliedGstin} is not a valid 15-character GSTIN`)
  const gstin = suppliedGstin || saved?.gstin || ""
  const isB2b = Boolean(gstin)
  const suppliedPan = pickCell(row, "PAN").toUpperCase().replace(/\s+/g, "")
  if (suppliedPan && !panPattern.test(suppliedPan)) return fail(`PAN ${suppliedPan} is not valid`)
  if (suppliedPan && gstin && gstin.slice(2, 12) !== suppliedPan) return fail("PAN does not match the GSTIN")
  const pan = suppliedPan || saved?.pan || (gstin ? gstin.slice(2, 12) : "")
  const billingAddress = pickCell(row, "Billing Address", "Address") || saved?.billingAddress || ""
  if (isB2b && !billingAddress) return fail("B2B customer (with GSTIN) needs a billing address")
  const premisesAddress = pickCell(row, "Premises Address", "Shipping Address") || saved?.premisesAddress || billingAddress

  const suppliedHsn = pickCell(row, "HSN/SAC", "HSN SAC", "HSN", "SAC", "HSN Code")
  if (suppliedHsn && !hsnSacPattern.test(suppliedHsn)) return fail(`HSN/SAC ${suppliedHsn} must have 4, 6 or 8 digits`)
  const entityHsn = context.entity?.hsnSac || context.entity?.hsnSacCodes?.[0] || ""
  const hsnSac = suppliedHsn || saved?.hsnSac || entityHsn || ""
  if (isB2b && context.isGstEntity && !hsnSac) return fail("B2B invoice needs an HSN/SAC code (or set one on the entity)")

  const sourceNumber = pickCell(row, "Invoice Number", "Invoice No", "Invoice #", "Bill Number", "Bill No")
  if (!sourceNumber) return fail("invoice number is missing")
  const date = normalizeSpreadsheetDate(pickCell(row, "Invoice Date", "Date", "Bill Date"))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("invoice date is missing or not a date")

  const taxable = money(pickCell(row, "Taxable Amount", "Taxable Value", "Taxable", "Sub Total", "Subtotal", "Base Amount"))
  const total = money(pickCell(row, "Invoice Total", "Total Amount", "Grand Total", "Total", "Invoice Amount", "Amount"))
  const base = Number.isFinite(total) && total > 0 ? total : taxable
  const cgst = readTax(row, "CGST", base)
  const sgst = readTax(row, "SGST", base)
  const igst = readTax(row, "IGST", base)
  if (!cgst || !sgst || !igst) return fail("CGST, SGST or IGST is not a valid number")
  const amounts = resolveAmounts({ taxable, total, cgst, sgst, igst })
  if (!amounts) return fail("enter an Invoice Total or a Taxable Amount above zero")
  if (amounts.igstAmount > 0 && (amounts.cgstAmount > 0 || amounts.sgstAmount > 0)) return fail("use either CGST + SGST or IGST, not both")
  if (!context.isGstEntity && (amounts.cgstAmount || amounts.sgstAmount || amounts.igstAmount)) {
    return fail("this entity has no GSTIN, so its invoices can't include GST")
  }

  const tdsAmount = money(pickCell(row, "TDS Amount", "TDS")) || 0
  const otherDeduction = money(pickCell(row, "Other Deduction")) || 0
  const suppliedNet = money(pickCell(row, "Net Receivable"))
  const description = pickCell(row, "Description", "Item", "Product", "Particulars", "Item Description")
  const lineItem: InvoiceLineItem = {
    id: crypto.randomUUID(),
    description,
    hsnSac,
    taxableAmount: amounts.taxableAmount,
    cgstAmount: amounts.cgstAmount,
    sgstAmount: amounts.sgstAmount,
    igstAmount: amounts.igstAmount,
  }
  const invoice: ImportInvoice = {
    entityName: context.entityName,
    customerId: saved?.id,
    companyName: saved?.companyName || customerName,
    sourceNumber,
    date,
    description,
    hsnSac,
    ...amounts,
    tdsAmount,
    otherDeduction,
    netReceivable: Number.isFinite(suppliedNet) && suppliedNet > 0 ? suppliedNet : round2(amounts.amount - tdsAmount - otherDeduction),
    lineItems: [lineItem],
    status: parseDocumentStatus(pickCell(row, "Status")),
  }
  const newCustomer: ImportCustomer | undefined = saved ? undefined : {
    entityId: context.entity?.id || "",
    companyName: customerName,
    billingAddress,
    hasGstin: isB2b,
    gstin,
    pan,
    premisesAddress,
    hsnSac: suppliedHsn,
  }
  return { ok: true, invoice, newCustomer }
}

const invoiceNumberKey = (value: string) => value.trim().toUpperCase()

type NumberedInvoice = { entityName?: string; sourceNumber?: string; number?: string }

/** Invoice numbers already issued by this entity, normalised for comparison. */
export function existingInvoiceNumbers(invoices: NumberedInvoice[], entityName: string): Set<string> {
  const numbers = new Set<string>()
  for (const invoice of invoices) {
    if (invoice.entityName !== entityName) continue
    for (const value of [invoice.sourceNumber, invoice.number]) if (value) numbers.add(invoiceNumberKey(value))
  }
  return numbers
}

export type SeenInvoiceNumbers = Map<string, { companyName: string; date: string; row: number }>

/**
 * Rejects a row whose invoice number already exists in ChanaX, or that reuses
 * a number from an earlier row for a different customer or date. Rows sharing
 * a number, customer and date are extra lines of the same invoice.
 */
export function invoiceNumberConflict(invoice: ImportInvoice, row: number, existing: Set<string>, seen: SeenInvoiceNumbers): string | null {
  const key = invoiceNumberKey(invoice.sourceNumber || "")
  if (existing.has(key)) return `invoice number ${invoice.sourceNumber} already exists in ChanaX`
  const earlier = seen.get(key)
  if (!earlier) {
    seen.set(key, { companyName: invoice.companyName.trim().toLowerCase(), date: invoice.date, row })
    return null
  }
  if (earlier.companyName !== invoice.companyName.trim().toLowerCase() || earlier.date !== invoice.date) {
    return `invoice number ${invoice.sourceNumber} is already used on row ${earlier.row} for a different customer or date`
  }
  return null
}

/** Flags a batch whose invoice numbers start with different letter prefixes (e.g. AAV vs AVV). */
export function invoicePrefixWarning(numbers: string[]): string {
  const counts = new Map<string, number>()
  for (const value of numbers) {
    const prefix = invoiceNumberKey(value).match(/^[A-Z]+/)?.[0]
    if (prefix) counts.set(prefix, (counts.get(prefix) || 0) + 1)
  }
  if (counts.size < 2) return ""
  const list = [...counts].sort((a, b) => b[1] - a[1]).map(([prefix, count]) => `${prefix} (${count})`).join(", ")
  return `Invoice numbers start with different prefixes: ${list}. Check for a typo before generating.`
}

export function bulkInvoiceTotals(invoices: ImportInvoice[]) {
  const sum = (pick: (invoice: ImportInvoice) => number | undefined) => round2(invoices.reduce((total, invoice) => total + (pick(invoice) || 0), 0))
  return {
    taxableAmount: sum((invoice) => invoice.taxableAmount),
    cgstAmount: sum((invoice) => invoice.cgstAmount),
    sgstAmount: sum((invoice) => invoice.sgstAmount),
    igstAmount: sum((invoice) => invoice.igstAmount),
    amount: sum((invoice) => invoice.amount),
  }
}
