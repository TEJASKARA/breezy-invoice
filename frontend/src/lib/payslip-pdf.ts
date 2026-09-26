import type { jsPDF as JsPdfDocument } from "jspdf"

import type { Company, Payslip, TemplateSettings } from "@/lib/mvp-store"
import { amountInWords, attendancePresentDays, cleanPayslipFileName, formatSalaryMonth, maskBankAccount } from "@/lib/payslip-calculations"
import { trackAction } from "@/lib/usage-tracking"

const pageWidth = 210
const margin = 16

function colour(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "2563EB"
  return [Number.parseInt(normalized.slice(0, 2), 16), Number.parseInt(normalized.slice(2, 4), 16), Number.parseInt(normalized.slice(4, 6), 16)]
}

function money(value: number) {
  return `INR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fontName(style: TemplateSettings["fontStyle"]) {
  if (style === "serif") return "times"
  if (style === "mono") return "courier"
  return "helvetica"
}

function addLogo(doc: JsPdfDocument, logoDataUrl: string, x: number, y: number) {
  try {
    doc.addImage(logoDataUrl, logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG", x, y, 20, 20, undefined, "FAST")
    return true
  } catch {
    return false
  }
}

export async function createPayslipPdf({ payslip, entity, template }: { payslip: Payslip; entity?: Company; template: TemplateSettings }) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  const accent = colour(template.accentColor)
  const ink: [number, number, number] = [24, 24, 27]
  const muted: [number, number, number] = [100, 116, 139]
  const soft: [number, number, number] = [247, 248, 250]
  const red: [number, number, number] = [225, 29, 72]
  const baseFont = fontName(template.fontStyle)
  const entityName = entity?.companyName || payslip.entityName || "Issuing entity"

  doc.setFont(baseFont, "normal")
  doc.setTextColor(...ink)
  const logoShown = Boolean(template.logoDataUrl && addLogo(doc, template.logoDataUrl, margin, 18))
  const headerX = 42
  if (!logoShown) {
    doc.setFillColor(...accent)
    doc.roundedRect(margin, 18, 20, 20, 2, 2, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFont(baseFont, "bold")
    doc.setFontSize(17)
    doc.text(entityName.charAt(0).toUpperCase(), margin + 10, 31, { align: "center" })
  }
  doc.setTextColor(...ink)
  doc.setFont(baseFont, "bold")
  doc.setFontSize(16)
  doc.text(entityName, headerX, 24)
  doc.setFont(baseFont, "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(...muted)
  const address = doc.splitTextToSize(entity?.billingAddress || entity?.premisesAddress || "Address not provided", 88) as string[]
  doc.text(address.slice(0, 3), headerX, 30)
  if (entity?.gstin) doc.text(`GSTIN: ${entity.gstin}`, headerX, 30 + Math.min(address.length, 3) * 4)

  doc.setTextColor(...accent)
  doc.setFont(baseFont, "bold")
  doc.setFontSize(20)
  doc.text("SALARY PAYSLIP", pageWidth - margin, 24, { align: "right" })
  doc.setTextColor(...ink)
  doc.setFontSize(9)
  doc.text(`Pay Period: ${formatSalaryMonth(payslip.month)}`, pageWidth - margin, 31, { align: "right" })
  if (payslip.paymentDate) {
    doc.setTextColor(...muted)
    doc.setFont(baseFont, "normal")
    doc.text(`Payment date: ${payslip.paymentDate}`, pageWidth - margin, 36, { align: "right" })
  }
  doc.setDrawColor(225, 228, 233)
  doc.line(margin, 50, pageWidth - margin, 50)

  doc.setFillColor(...soft)
  doc.roundedRect(margin, 59, pageWidth - margin * 2, 34, 3, 3, "F")
  const detail = (x: number, label: string, primary: string, secondary: string) => {
    doc.setFont(baseFont, "bold")
    doc.setFontSize(7)
    doc.setTextColor(148, 163, 184)
    doc.text(label.toUpperCase(), x, 67)
    doc.setFontSize(9)
    doc.setTextColor(...ink)
    doc.text(primary || "-", x, 74)
    doc.setFont(baseFont, "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(...muted)
    doc.text(doc.splitTextToSize(secondary || "-", 38).slice(0, 2), x, 79)
  }
  detail(22, "Employee name", payslip.employeeName, `ID: ${payslip.employeeCode || "-"}`)
  detail(68, "Job designation", payslip.designation, payslip.department)
  detail(114, "Tax & employment", `PAN: ${payslip.pan || "-"}`, payslip.employmentStatus)
  detail(158, "Disbursal bank", payslip.bankName, `A/C: ${maskBankAccount(payslip.bankAccount)}`)

  if (payslip.attendance) {
    const attendanceItems = [
      ["Working", payslip.workingDays],
      ["Present", attendancePresentDays(payslip.attendance)],
      ["Leave taken", payslip.attendance.paidLeaveDays],
      ["Excess leave", payslip.attendance.excessLeaveDays || 0],
      ["LOP days", payslip.attendance.lossOfPayDays ?? payslip.attendance.unpaidLeaveDays],
      ["Payable", payslip.payableDays],
    ] as const
    doc.setFillColor(...soft)
    doc.roundedRect(margin, 98, pageWidth - margin * 2, 13, 2, 2, "F")
    const attendanceWidth = (pageWidth - margin * 2) / attendanceItems.length
    attendanceItems.forEach(([label, value], index) => {
      const x = margin + 4 + index * attendanceWidth
      doc.setFont(baseFont, "normal")
      doc.setFontSize(6.5)
      doc.setTextColor(...muted)
      doc.text(label, x, 103)
      doc.setFont(baseFont, "bold")
      doc.setFontSize(8.5)
      doc.setTextColor(...(label === "Payable" ? accent : ink))
      doc.text(String(value), x, 108)
    })
  }

  const leftX = margin
  const rightX = 110
  const tableWidth = 84
  const tableStart = payslip.attendance ? 117 : 108
  const drawPayroll = (x: number, title: string, items: Payslip["earnings"], totalLabel: string, total: number, deduction = false) => {
    doc.setFont(baseFont, "bold")
    doc.setFontSize(9)
    doc.setTextColor(...ink)
    doc.text(title.toUpperCase(), x, tableStart)
    doc.setFontSize(7)
    doc.setTextColor(...(deduction ? red : accent))
    doc.text("IN INR", x + tableWidth, tableStart, { align: "right" })
    doc.setDrawColor(220, 224, 230)
    doc.line(x, tableStart + 4, x + tableWidth, tableStart + 4)
    let y = tableStart + 12
    items.filter((item) => item.label || item.amount).slice(0, 8).forEach((item) => {
      doc.setFont(baseFont, "normal")
      doc.setFontSize(8)
      doc.setTextColor(...muted)
      doc.text((doc.splitTextToSize(item.label || "Other", 52) as string[])[0], x, y)
      doc.setFont(baseFont, "bold")
      doc.setTextColor(...(deduction ? red : ink))
      doc.text(`${deduction ? "-" : ""}${money(item.amount)}`, x + tableWidth, y, { align: "right" })
      doc.setDrawColor(235, 237, 241)
      doc.line(x, y + 4, x + tableWidth, y + 4)
      y += 11
    })
    doc.setFont(baseFont, "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(...ink)
    doc.text(totalLabel, x, y + 2)
    doc.setTextColor(...(deduction ? red : accent))
    doc.text(money(total), x + tableWidth, y + 2, { align: "right" })
    return y + 8
  }
  const leftBottom = drawPayroll(leftX, "Earnings & benefits", payslip.earnings, "Total Earnings (A)", payslip.grossPay)
  const rightBottom = drawPayroll(rightX, "Deductions & tax withholdings", payslip.deductions, "Total Deductions (B)", payslip.totalDeductions, true)
  const summaryY = Math.max(196, leftBottom + 12, rightBottom + 12)

  doc.setDrawColor(...accent)
  doc.setLineWidth(0.6)
  doc.roundedRect(margin, summaryY, pageWidth - margin * 2, 29, 3, 3)
  doc.setFont(baseFont, "bold")
  doc.setFontSize(7)
  doc.setTextColor(148, 163, 184)
  doc.text("NET TAKE-HOME SALARY (A - B)", margin + 6, summaryY + 8)
  doc.setFontSize(18)
  doc.setTextColor(...accent)
  doc.text(money(payslip.netPay), margin + 6, summaryY + 20)
  doc.setFontSize(7)
  doc.setTextColor(148, 163, 184)
  doc.text("NET SALARY IN WORDS", pageWidth - margin - 6, summaryY + 8, { align: "right" })
  doc.setFont(baseFont, "italic")
  doc.setFontSize(8)
  doc.setTextColor(...ink)
  doc.text((doc.splitTextToSize(amountInWords(payslip.netPay), 86) as string[]).slice(0, 2), pageWidth - margin - 6, summaryY + 15, { align: "right" })

  doc.setDrawColor(225, 228, 233)
  doc.line(margin, 273, pageWidth - margin, 273)
  doc.setFont(baseFont, "normal")
  doc.setFontSize(7.5)
  doc.setTextColor(...muted)
  doc.text(`Working days: ${payslip.workingDays || "-"}  |  Payable days: ${payslip.payableDays || "-"}`, margin, payslip.attendance ? 277 : 280)
  if (payslip.attendance) doc.text(`Half days: ${payslip.attendance.halfDays}  |  Excess leave: ${payslip.attendance.excessLeaveDays || 0}  |  LOP deduction: ${money(payslip.attendance.leaveDeductionAmount || 0)}`, margin, 282)
  doc.text("This is a computer-generated payslip.", pageWidth - margin, payslip.attendance ? 282 : 280, { align: "right" })

  return doc
}

export async function downloadPayslipPdf(input: { payslip: Payslip; entity?: Company; template: TemplateSettings }) {
  const doc = await createPayslipPdf(input)
  doc.save(payslipPdfFileName(input.payslip))
  trackAction("payslip_pdf_downloaded")
}

export function payslipPdfFileName(payslip: Payslip) {
  const date = payslip.paymentDate || payslip.month
  return `${cleanPayslipFileName(payslip.employeeName)}_${cleanPayslipFileName(date)}.pdf`
}

export async function createPayslipPdfFile(input: { payslip: Payslip; entity?: Company; template: TemplateSettings }) {
  const doc = await createPayslipPdf(input)
  return {
    name: payslipPdfFileName(input.payslip),
    data: new Uint8Array(doc.output("arraybuffer")),
  }
}
