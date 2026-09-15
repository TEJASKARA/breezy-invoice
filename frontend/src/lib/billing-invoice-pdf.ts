import type { BillingPayment } from "@/lib/billing-api"

type BillingInvoicePdfInput = {
  payment: BillingPayment
  workspaceName: string
  customerEmail?: string | null
}

function amount(value: number) {
  return `INR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function date(value: string | null) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "long" }).format(new Date(value))
}

function planName(key: string) {
  return key.replace(/^custom_/, "Custom ").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export async function downloadBillingInvoice({ payment, workspaceName, customerEmail }: BillingInvoicePdfInput) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  const margin = 18
  const right = 192
  const paidOn = payment.paid_at || payment.created_at
  const invoiceReference = `CHX-${payment.provider_payment_id || payment.id.slice(0, 12)}`
  const plan = planName(payment.plan_key)

  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, 210, 12, "F")
  doc.setTextColor(15, 23, 42)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(22)
  doc.text("ChanaX", margin, 30)
  doc.setFontSize(17)
  doc.text("SUBSCRIPTION INVOICE", right, 30, { align: "right" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text("Payment received for your ChanaX subscription", margin, 37)

  doc.setDrawColor(226, 232, 240)
  doc.line(margin, 45, right, 45)
  doc.setTextColor(51, 65, 85)
  doc.setFontSize(9)
  doc.text("BILLED TO", margin, 54)
  doc.text("INVOICE DETAILS", 120, 54)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(15, 23, 42)
  doc.text(workspaceName, margin, 61)
  doc.text(invoiceReference, right, 61, { align: "right" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(71, 85, 105)
  if (customerEmail) doc.text(customerEmail, margin, 67)
  doc.text(`Paid on: ${date(paidOn)}`, right, 67, { align: "right" })
  doc.text(`Payment ID: ${payment.provider_payment_id || "—"}`, right, 73, { align: "right" })

  const tableY = 86
  doc.setFillColor(241, 245, 249)
  doc.rect(margin, tableY, right - margin, 11, "F")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8.5)
  doc.setTextColor(51, 65, 85)
  doc.text("DESCRIPTION", margin + 4, tableY + 7)
  doc.text("PERIOD", 125, tableY + 7)
  doc.text("AMOUNT", right - 4, tableY + 7, { align: "right" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text(`${plan} subscription`, margin + 4, tableY + 20)
  doc.text(`${payment.duration_months} ${payment.duration_months === 1 ? "month" : "months"}`, 125, tableY + 20)
  doc.text(amount(payment.amount_paise / 100), right - 4, tableY + 20, { align: "right" })
  doc.setDrawColor(226, 232, 240)
  doc.line(margin, tableY + 28, right, tableY + 28)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.text("Total paid", 125, tableY + 42)
  doc.setFontSize(13)
  doc.text(amount(payment.amount_paise / 100), right - 4, tableY + 42, { align: "right" })

  doc.setFillColor(240, 253, 244)
  doc.roundedRect(margin, tableY + 58, right - margin, 26, 3, 3, "F")
  doc.setTextColor(22, 101, 52)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.text("Payment successful", margin + 5, tableY + 69)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  doc.text(`${payment.credits} document credits and ${payment.credits} quotation credits were added to this workspace.`, margin + 5, tableY + 76)

  doc.setTextColor(100, 116, 139)
  doc.setFontSize(8)
  doc.text("This is a computer-generated subscription invoice.", 105, 282, { align: "center" })
  doc.save(`chanax-subscription-invoice-${invoiceReference.replace(/[^a-z0-9_-]/gi, "_")}.pdf`)
}
