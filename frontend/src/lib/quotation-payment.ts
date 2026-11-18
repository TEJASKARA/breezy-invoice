import type { Invoice, TemplateSettings } from "@/lib/mvp-store"

/**
 * Payment details printed on a quotation. A quotation saved with its own
 * payment details uses those; older quotations fall back to the template.
 * The UPI QR always comes from the template when it is switched on there.
 */
export function quotationPayment(invoice: Invoice, template: Pick<TemplateSettings, "showQuotationPaymentDetails" | "quotationPaymentDetails" | "quotationPaymentQrDataUrl">) {
  const own = (invoice as Invoice & { paymentDetails?: string }).paymentDetails
  const text = (own ?? (template.showQuotationPaymentDetails ? template.quotationPaymentDetails : "")).trim()
  const qr = template.showQuotationPaymentDetails ? template.quotationPaymentQrDataUrl || "" : ""
  return { text, qr, show: Boolean(text || qr) }
}
