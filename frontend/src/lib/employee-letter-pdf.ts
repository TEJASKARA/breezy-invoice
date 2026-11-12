import type { Company, Employee, EmployeeLetter, TemplateSettings } from "@/lib/mvp-store"
import type { SalaryLine } from "@/lib/salary-structure"

function safe(value: string) { return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "employee" }

function plainLetterLine(value: string) {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .trim()
}

/** The PDF already renders the date, recipient and subject. Remove copies pasted
 * into the editable body, and print simple Markdown as clean document text. */
function printableLetterBody(body: string, letter: EmployeeLetter, employee: Employee) {
  const title = letter.title.replace(/[^a-z0-9]+/gi, "").toLowerCase()
  const employeeName = employee.employeeName.replace(/\s+/g, " ").trim().toLowerCase()
  const kept: string[] = []
  for (const rawLine of body.replace(/\r/g, "").split("\n")) {
    const line = plainLetterLine(rawLine)
    if (!line) {
      if (kept.length && kept.at(-1) !== "") kept.push("")
      continue
    }
    const compact = line.replace(/[^a-z0-9]+/gi, "").toLowerCase()
    const isRepeatedHeader = compact === title || /^date\s*:/i.test(line) || /^to\s*[:,]?$/i.test(line) || /^subject\s*:/i.test(line)
    if (isRepeatedHeader || line.replace(/\s+/g, " ").toLowerCase() === employeeName) continue
    kept.push(line)
  }
  return kept.join("\n").trim()
}

export async function createEmployeeLetterPdf({ letter, employee, entity, template, canRemoveBranding = false }: { letter: EmployeeLetter; employee: Employee; entity?: Company; template: TemplateSettings; canRemoveBranding?: boolean }) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true })
  const margin = 20
  const pageWidth = 210
  const pageHeight = 297
  const logoSize = Math.min(36, Math.max(14, template.logoSize / 3))
  const showChanaxBranding = template.showChanaxBranding || !canRemoveBranding
  const colour = (hex: string): [number, number, number] => {
    const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "FFFFFF"
    return [Number.parseInt(normalized.slice(0, 2), 16), Number.parseInt(normalized.slice(2, 4), 16), Number.parseInt(normalized.slice(4, 6), 16)]
  }
  const paintPage = () => {
    const background = colour(template.pageColor)
    doc.setFillColor(...background)
    doc.rect(0, 0, pageWidth, pageHeight, "F")
    if (template.watermarkEnabled && template.watermarkText.trim()) {
      const opacity = Math.min(0.3, Math.max(0.05, template.watermarkOpacity))
      const watermarkColour = background.map((channel) => Math.round(channel * (1 - opacity) + 82 * opacity)) as [number, number, number]
      doc.setTextColor(...watermarkColour); doc.setFont("helvetica", "bold"); doc.setFontSize(31)
      doc.text(template.watermarkText.trim().slice(0, 48).toUpperCase(), pageWidth / 2, pageHeight / 2, { align: "center", angle: 32 })
    }
    if (showChanaxBranding) {
      doc.setTextColor(148, 163, 184); doc.setFont("helvetica", "normal"); doc.setFontSize(6.5)
      doc.text("Created by ChanaX", pageWidth - margin, pageHeight - 7, { align: "right" })
    }
  }
  paintPage()
  let y = 22
  if (template.logoDataUrl) {
    try { doc.addImage(template.logoDataUrl, template.logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG", margin, y, logoSize, logoSize); y += logoSize + 6 } catch { /* keep letter usable if an old image cannot be decoded */ }
  }
  doc.setTextColor(20); doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.text(entity?.companyName || "Company", margin, y)
  y += 7; doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90)
  doc.text(doc.splitTextToSize(entity?.billingAddress || entity?.premisesAddress || "", 120), margin, y)
  y += 16; doc.setDrawColor(190); doc.line(margin, y, 190, y); y += 12
  doc.setTextColor(20); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(letter.title, 105, y, { align: "center" })
  y += 14; doc.setFont("helvetica", "normal"); doc.setFontSize(10)
  doc.text(`Date: ${letter.issueDate}`, margin, y); y += 9
  doc.text(`To,`, margin, y); y += 6; doc.setFont("helvetica", "bold"); doc.text(employee.employeeName, margin, y); y += 5
  doc.setFont("helvetica", "normal"); doc.text(`${employee.designation}${employee.department ? `, ${employee.department}` : ""}`, margin, y); y += 11
  doc.setFont("helvetica", "bold"); doc.text(`Subject: ${letter.subject}`, margin, y); y += 10
  doc.setFont("helvetica", "normal")
  const startContinuationPage = () => {
    doc.addPage(); paintPage()
    doc.setTextColor(90); doc.setFont("helvetica", "bold"); doc.setFontSize(9)
    doc.text(`${letter.title} - continued`, margin, 22)
    doc.setDrawColor(190); doc.line(margin, 26, 190, 26)
    doc.setTextColor(20); doc.setFont("helvetica", "normal"); doc.setFontSize(10)
    return 36
  }
  const paragraphs = printableLetterBody(letter.body, letter, employee).split(/\n{2,}/).filter(Boolean)
  // Loaded only for letters that carry salary details.
  const salaryHelpers = letter.salary && letter.salary.display !== "none" ? await import("@/lib/letter-salary") : null
  // Salary sentence goes after the salutation and opening paragraph.
  const salaryParagraph = salaryHelpers?.letterSalaryParagraph(letter.letterType, letter.salary, "INR ")
  if (salaryParagraph) paragraphs.splice(Math.min(2, paragraphs.length), 0, salaryParagraph)
  for (const paragraph of paragraphs) {
    const lines = doc.splitTextToSize(paragraph, 170) as string[]
    let remaining = [...lines]
    while (remaining.length) {
      const availableLines = Math.floor((264 - y) / 5)
      if (availableLines < 1) y = startContinuationPage()
      const chunk = remaining.splice(0, Math.max(1, Math.floor((264 - y) / 5)))
      doc.text(chunk, margin, y)
      y += chunk.length * 5
      if (remaining.length) y = startContinuationPage()
    }
    y += 4
  }
  const signatureHeight = template.signatureMode === "uploaded" && template.signatureDataUrl ? 25 : 12
  if (Math.max(y + 12, 238) + signatureHeight > (showChanaxBranding ? 282 : 290)) y = startContinuationPage()
  y = Math.max(y + 12, 238)
  if (template.signatureMode === "uploaded" && template.signatureDataUrl) {
    try { doc.addImage(template.signatureDataUrl, template.signatureDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG", margin, y, 35, 15); y += 18 } catch { /* fallback to typed signatory */ }
  }
  doc.setFont("helvetica", "bold"); doc.text(letter.signatureName || `For ${entity?.companyName || "Company"}`, margin, y)
  y += 5; doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text("Authorised signatory", margin, y)

  const structure = salaryHelpers?.letterSalaryStructure(letter.letterType, letter.salary)
  if (structure && structure.earnings.length) {
    doc.addPage(); paintPage()
    let row = 24
    doc.setTextColor(20); doc.setFont("helvetica", "bold"); doc.setFontSize(13)
    doc.text(letter.letterType === "offer" ? "ANNEXURE A - SALARY STRUCTURE" : "ANNEXURE A - LAST DRAWN SALARY STRUCTURE", 105, row, { align: "center" })
    row += 9; doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(70)
    doc.text(`${employee.employeeName}${employee.designation ? ` - ${employee.designation}` : ""}`, margin, row)
    doc.text(`Annual CTC: ${salaryHelpers?.formatRupees(structure.annualCtc, "INR ")}`, 190, row, { align: "right" })
    row += 7
    const amountX = 150, annualX = 190
    const header = () => {
      doc.setFillColor(235, 238, 243); doc.rect(margin, row - 5, 170, 8, "F")
      doc.setTextColor(20); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5)
      doc.text("Component", margin + 2, row); doc.text("Monthly (INR)", amountX, row, { align: "right" }); doc.text("Annual (INR)", annualX - 2, row, { align: "right" })
      row += 8
    }
    const amount = (value: number) => Math.round(value).toLocaleString("en-IN")
    const section = (title: string, lines: SalaryLine[]) => {
      if (!lines.length) return
      doc.setTextColor(100); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5)
      doc.text(title.toUpperCase(), margin + 2, row); row += 6
      doc.setTextColor(30); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5)
      for (const item of lines) {
        doc.text(item.label, margin + 2, row); doc.text(amount(item.monthly), amountX, row, { align: "right" }); doc.text(amount(item.annual), annualX - 2, row, { align: "right" })
        row += 6
      }
    }
    const total = (label: string, monthly: number) => {
      doc.setDrawColor(200); doc.line(margin, row - 4, 190, row - 4)
      doc.setTextColor(20); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5)
      doc.text(label, margin + 2, row); doc.text(amount(monthly), amountX, row, { align: "right" }); doc.text(amount(monthly * 12), annualX - 2, row, { align: "right" })
      row += 9
    }
    header()
    section("Earnings", structure.earnings); total("Gross salary", structure.grossMonthly)
    section("Employee deductions", structure.employeeDeductions); total("Net take-home salary", structure.netMonthly)
    section("Employer contributions", structure.employerContributions); total("Total cost to company (CTC)", structure.monthlyCtc)
    row += 2; doc.setTextColor(100); doc.setFont("helvetica", "normal"); doc.setFontSize(8)
    doc.text(doc.splitTextToSize("PF, ESIC, Professional Tax and gratuity are calculated as per the rules applicable on the date of this letter and may change with law. Income tax, if any, is deducted as per the employee's declarations.", 170), margin, row)
  }
  return doc
}

export function employeeLetterFileName(letter: EmployeeLetter, employee: Employee) {
  return `${safe(employee.employeeName)}_${letter.letterType}_${letter.issueDate}.pdf`
}
