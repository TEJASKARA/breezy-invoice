export type GstTaxMode = "split" | "igst"
type TaxAmounts = { cgstAmount?: number | string; sgstAmount?: number | string; igstAmount?: number | string }
export type GstDraftLine = {
  quantity?: string; unitPrice?: string
  taxableAmount: string; totalAmount: string
  cgstAmount: string; sgstAmount: string; igstAmount: string
  cgstRate: string; sgstRate: string; igstRate: string
  amountBasis: "taxable" | "total"
}
const money = (value: number) => Math.round(value * 100) / 100
const input = (value: number) => value > 0 ? String(money(value)) : ""
const rate = (value: string) => Math.min(100, Math.max(0, Number(value) || 0))
export const gstRateOptions = [0, 5, 12, 18, 28] as const
export const unitPriceFromTaxable = (amount: number, quantity = 1) => quantity > 0 ? Math.round(amount / quantity * 1_000_000) / 1_000_000 : 0
const unitPriceFields = (line: GstDraftLine, taxable: number) => line.quantity === undefined ? {} : {
  unitPrice: taxable > 0 ? String(unitPriceFromTaxable(taxable, Number(line.quantity))) : "",
}
export function updateDraftQuantity<T extends GstDraftLine>(line: T, quantity: string): T {
  const price = line.unitPrice === undefined ? unitPriceFromTaxable(Number(line.taxableAmount) || 0, Number(line.quantity ?? 1)) : Number(line.unitPrice) || 0
  const taxableAmount = input(Math.max(0, Number(quantity) || 0) * price)
  const updated = recalculateDraftLineFromTaxable({ ...line, quantity, taxableAmount, amountBasis: "taxable" })
  return { ...updated, unitPrice: line.unitPrice ?? (price ? String(price) : "") }
}
export function updateDraftUnitPrice<T extends GstDraftLine>(line: T, unitPrice: string): T {
  const taxableAmount = input(Math.max(0, Number(line.quantity ?? 1) || 0) * Math.max(0, Number(unitPrice) || 0))
  return { ...recalculateDraftLineFromTaxable({ ...line, unitPrice, taxableAmount, amountBasis: "taxable" }), unitPrice }
}
const tax = (line: GstDraftLine, amount: number) => ({
  cgstAmount: money(amount * rate(line.cgstRate) / 100),
  sgstAmount: money(amount * rate(line.sgstRate) / 100),
  igstAmount: money(amount * rate(line.igstRate) / 100),
})
export function recalculateDraftLineFromTaxable<T extends GstDraftLine>(line: T): T {
  const taxable = Math.max(0, Number(line.taxableAmount) || 0)
  const taxes = tax(line, taxable)
  return { ...line, ...unitPriceFields(line, taxable), cgstAmount: input(taxes.cgstAmount), sgstAmount: input(taxes.sgstAmount),
    igstAmount: input(taxes.igstAmount), totalAmount: input(taxable + taxes.cgstAmount + taxes.sgstAmount + taxes.igstAmount) }
}
export function recalculateDraftLineFromTotal<T extends GstDraftLine>(line: T): T {
  const total = money(Math.max(0, Number(line.totalAmount) || 0))
  const totalRate = rate(line.igstRate) || rate(line.cgstRate) + rate(line.sgstRate)
  const taxes = tax(line, total / (1 + totalRate / 100))
  // Keep the entered inclusive total exact after rounding tax components to paise.
  const taxable = money(total - taxes.cgstAmount - taxes.sgstAmount - taxes.igstAmount)
  return { ...line, ...unitPriceFields(line, taxable), taxableAmount: input(taxable), cgstAmount: input(taxes.cgstAmount),
    sgstAmount: input(taxes.sgstAmount), igstAmount: input(taxes.igstAmount), totalAmount: input(total) }
}
export function recalculateGstDraftLine<T extends GstDraftLine>(line: T): T {
  return line.amountBasis === "total" && line.totalAmount
    ? recalculateDraftLineFromTotal(line) : recalculateDraftLineFromTaxable(line)
}
export function applyInvoiceTaxMode<T extends GstDraftLine>(line: T, mode: GstTaxMode, selectedRate?: number): T {
  const totalRate = selectedRate ?? (rate(line.igstRate) || rate(line.cgstRate) + rate(line.sgstRate))
  const normalized = mode === "igst"
    ? { ...line, igstRate: input(totalRate), cgstRate: "", sgstRate: "", cgstAmount: "", sgstAmount: "" }
    : { ...line, cgstRate: input(totalRate / 2), sgstRate: input(totalRate / 2), igstRate: "", igstAmount: "" }
  return recalculateGstDraftLine(normalized)
}
export function inferInvoiceTaxMode(lines: (TaxAmounts & { igstRate?: number | string })[]): GstTaxMode {
  return lines.some((line) => Number(line.igstAmount) > 0 || Number(line.igstRate) > 0) ? "igst" : "split"
}
export function invoiceTaxError(invoice: TaxAmounts & { gstTaxMode?: GstTaxMode; lineItems?: TaxAmounts[] }): string {
  const lines = [invoice, ...(invoice.lineItems || [])]
  if (lines.some((line) => [line.cgstAmount, line.sgstAmount, line.igstAmount].some((amount) => amount != null && (!Number.isFinite(Number(amount)) || Number(amount) < 0)))) {
    return "Tax amounts must be valid non-negative numbers."
  }
  const hasIgst = lines.some((line) => Number(line.igstAmount) > 0)
  const hasSplit = lines.some((line) => Number(line.cgstAmount) > 0 || Number(line.sgstAmount) > 0)
  if (hasIgst && hasSplit || invoice.gstTaxMode === "split" && hasIgst || invoice.gstTaxMode === "igst" && hasSplit) {
    return "Use one tax type for the entire invoice: either IGST or CGST + SGST. Apply it to all lines before saving."
  }
  return ""
}
export function assertInvoiceTaxMode(invoice: Parameters<typeof invoiceTaxError>[0]): void {
  const error = invoiceTaxError(invoice)
  if (error) throw new Error(error)
}
