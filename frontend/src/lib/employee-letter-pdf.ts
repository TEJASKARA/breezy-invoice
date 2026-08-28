import type { Company, Employee, EmployeeLetter, TemplateSettings } from "@/lib/mvp-store"

function safe(value: string) { return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "employee" }

export async function createEmployeeLetterPdf({ letter, employee, entity, template }: { letter: EmployeeLetter; employee: Employee; entity?: Company; template: TemplateSettings }) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true })
  const margin = 20
  let y = 22
  if (template.logoDataUrl) {
    try { doc.addImage(template.logoDataUrl, template.logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG", margin, y, 25, 18); y += 24 } catch { /* keep letter usable if an old image cannot be decoded */ }
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.text(entity?.companyName || "Company", margin, y)
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
  const paragraphs = letter.body.split(/\n+/).filter(Boolean)
  for (const paragraph of paragraphs) {
    const lines = doc.splitTextToSize(paragraph, 170) as string[]
    if (y + lines.length * 5 > 270) { doc.addPage(); y = 22 }
    doc.text(lines, margin, y); y += lines.length * 5 + 4
  }
  y = Math.max(y + 12, 238)
  if (template.signatureMode === "uploaded" && template.signatureDataUrl) {
    try { doc.addImage(template.signatureDataUrl, template.signatureDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG", margin, y, 35, 15); y += 18 } catch { /* fallback to typed signatory */ }
  }
  doc.setFont("helvetica", "bold"); doc.text(letter.signatureName || `For ${entity?.companyName || "Company"}`, margin, y)
  y += 5; doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text("Authorised signatory", margin, y)
  return doc
}

export function employeeLetterFileName(letter: EmployeeLetter, employee: Employee) {
  return `${safe(employee.employeeName)}_${letter.letterType}_${letter.issueDate}.pdf`
}
