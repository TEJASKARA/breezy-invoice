import type { Company, Payslip, TemplateSettings } from "@/lib/mvp-store"
import { cleanPayslipFileName } from "@/lib/payslip-calculations"
import { trackAction } from "@/lib/usage-tracking"

type PayslipPdfInput = { payslip: Payslip; entity?: Company; template: TemplateSettings; canRemoveBranding?: boolean }

export async function createPayslipPdf(input: PayslipPdfInput) {
  const { exportPayslipDocument } = await import("@/lib/payslip-document-export")
  return exportPayslipDocument(input)
}

export async function downloadPayslipPdf(input: PayslipPdfInput) {
  const doc = await createPayslipPdf(input)
  doc.save(payslipPdfFileName(input.payslip))
  trackAction("payslip_pdf_downloaded")
}

export function payslipPdfFileName(payslip: Payslip) {
  const date = payslip.paymentDate || payslip.month
  return `${cleanPayslipFileName(payslip.employeeName)}_${cleanPayslipFileName(date)}.pdf`
}

export async function createPayslipPdfFile(input: PayslipPdfInput) {
  const doc = await createPayslipPdf(input)
  return {
    name: payslipPdfFileName(input.payslip),
    data: new Uint8Array(doc.output("arraybuffer")),
  }
}
