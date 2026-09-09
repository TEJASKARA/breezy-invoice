import type { AttendanceDayRecord, Company, PayslipAttendance } from "@/lib/mvp-store"
import { attendancePresentDays, cleanPayslipFileName, formatSalaryMonth } from "@/lib/payslip-calculations"

export type AttendanceExportRow = {
  employeeName: string
  employeeCode: string
  designation: string
  department: string
  dailyRecords: AttendanceDayRecord[]
  attendance: PayslipAttendance
  workingDays: number
  payableDays: number
  deductionAmount: number
}

export type AttendanceExportInput = {
  entity: Company
  month: string
  calendar: PayslipAttendance
  rows: AttendanceExportRow[]
}

const statusCodes = {
  present: "P",
  half_day: "HD",
  paid_leave: "PL",
  unpaid_leave: "A",
} as const

function monthDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number)
  return Number.isFinite(year) && Number.isFinite(monthNumber) ? new Date(year, monthNumber, 0).getDate() : 0
}

function dateForDay(month: string, day: number) {
  return `${month}-${String(day).padStart(2, "0")}`
}

function calendarCode(input: AttendanceExportInput, row: AttendanceExportRow, day: number) {
  const dateValue = dateForDay(input.month, day)
  const date = new Date(`${dateValue}T00:00:00`)
  if ((date.getDay() === 6 && input.calendar.saturdayWeeklyOff) || (date.getDay() === 0 && input.calendar.sundayWeeklyOff)) return "WO"
  if (input.calendar.holidays.some((holiday) => holiday.date === dateValue)) return "H"
  const record = row.dailyRecords.find((item) => item.date === dateValue)
  return record ? statusCodes[record.status] : "-"
}

function fileStem(input: AttendanceExportInput) {
  return `Attendance_${cleanPayslipFileName(input.entity.companyName)}_${cleanPayslipFileName(input.month)}`
}

export async function downloadAttendanceExcel(input: AttendanceExportInput) {
  const XLSX = await import("xlsx")
  const days = monthDays(input.month)
  const dayHeaders = Array.from({ length: days }, (_, index) => String(index + 1).padStart(2, "0"))
  const dailyRows = input.rows.map((row) => [
    row.employeeName,
    row.employeeCode,
    row.designation,
    row.department,
    ...Array.from({ length: days }, (_, index) => calendarCode(input, row, index + 1)),
    attendancePresentDays(row.attendance),
    row.attendance.halfDays,
    row.attendance.paidLeaveDays,
    row.attendance.unpaidLeaveDays,
  ])
  const dailySheet = XLSX.utils.aoa_to_sheet([
    [`${input.entity.companyName} - Monthly Attendance`],
    ["Month", formatSalaryMonth(input.month)],
    [],
    ["Employee Name", "Employee Code", "Designation", "Department", ...dayHeaders, "Present", "Half-days", "Paid leave", "Unpaid leave"],
    ...dailyRows,
  ])
  dailySheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(3, days + 7) } }]
  dailySheet["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 22 }, { wch: 22 }, ...Array.from({ length: days }, () => ({ wch: 5 })), { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 12 }]
  dailySheet["!autofilter"] = { ref: `A4:${XLSX.utils.encode_col(days + 7)}${dailyRows.length + 4}` }
  dailySheet["!freeze"] = { xSplit: 4, ySplit: 4 }

  const summaryRows = input.rows.map((row) => [
    row.employeeName,
    row.employeeCode,
    row.workingDays,
    attendancePresentDays(row.attendance),
    row.attendance.halfDays,
    row.attendance.paidLeaveDays,
    row.attendance.unpaidLeaveDays,
    row.attendance.excessLeaveDays || 0,
    row.payableDays,
    row.deductionAmount,
  ])
  const summarySheet = XLSX.utils.aoa_to_sheet([
    [`${input.entity.companyName} - Payroll Attendance Summary`],
    ["Month", formatSalaryMonth(input.month)],
    [],
    ["Employee Name", "Employee Code", "Working Days", "Present", "Half-days", "Paid Leave", "Unpaid Leave", "Excess Leave", "Payable Days", "LOP Deduction (INR)"],
    ...summaryRows,
  ])
  summarySheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }]
  summarySheet["!cols"] = [{ wch: 28 }, { wch: 16 }, ...Array.from({ length: 7 }, () => ({ wch: 14 })), { wch: 20 }]
  summarySheet["!autofilter"] = { ref: `A4:J${summaryRows.length + 4}` }
  summarySheet["!freeze"] = { xSplit: 2, ySplit: 4 }
  for (let rowIndex = 5; rowIndex <= summaryRows.length + 4; rowIndex += 1) {
    const cell = summarySheet[`J${rowIndex}`]
    if (cell) cell.z = "#,##0.00"
  }

  const legendSheet = XLSX.utils.aoa_to_sheet([
    ["Attendance code", "Meaning"],
    ["P", "Present"],
    ["HD", "Half-day"],
    ["PL", "Paid leave"],
    ["A", "Absent / unpaid leave"],
    ["WO", "Weekly off"],
    ["H", "Public holiday"],
    ["-", "Not marked"],
    [],
    ["Public holidays"],
    ...input.calendar.holidays.map((holiday) => [holiday.date, holiday.name]),
  ])
  legendSheet["!cols"] = [{ wch: 20 }, { wch: 42 }]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, dailySheet, "Daily Attendance")
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Payroll Summary")
  XLSX.utils.book_append_sheet(workbook, legendSheet, "Legend")
  XLSX.writeFile(workbook, `${fileStem(input)}.xlsx`, { compression: true })
}

export async function downloadAttendancePdf(input: AttendanceExportInput) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true })
  const days = monthDays(input.month)
  const dayBlocks = Array.from({ length: Math.ceil(days / 15) }, (_, index) => ({ start: index * 15 + 1, end: Math.min(days, index * 15 + 15) }))
  const pageWidth = 297
  const margin = 10
  const employeeWidth = 49
  const dayWidth = 9
  const rowHeight = 7
  const rowsPerPage = 21

  const header = (subtitle: string) => {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(15)
    doc.setTextColor(24, 24, 27)
    doc.text(`${input.entity.companyName} - Monthly Attendance`, margin, 12)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text(`${formatSalaryMonth(input.month)} | ${subtitle}`, margin, 18)
    doc.text(`Generated ${new Date().toLocaleDateString("en-IN")}`, pageWidth - margin, 12, { align: "right" })
  }

  let firstPage = true
  for (const block of dayBlocks) {
    for (let offset = 0; offset < input.rows.length || offset === 0; offset += rowsPerPage) {
      if (!firstPage) doc.addPage("a4", "landscape")
      firstPage = false
      const pageRows = input.rows.slice(offset, offset + rowsPerPage)
      header(`Daily register - days ${block.start} to ${block.end}`)
      let y = 27
      doc.setFillColor(24, 24, 27)
      doc.rect(margin, y, employeeWidth + (block.end - block.start + 1) * dayWidth, rowHeight, "F")
      doc.setTextColor(255, 255, 255)
      doc.setFont("helvetica", "bold")
      doc.setFontSize(7)
      doc.text("Employee", margin + 2, y + 4.7)
      for (let day = block.start; day <= block.end; day += 1) doc.text(String(day).padStart(2, "0"), margin + employeeWidth + (day - block.start) * dayWidth + dayWidth / 2, y + 4.7, { align: "center" })
      y += rowHeight
      pageRows.forEach((row, rowIndex) => {
        if (rowIndex % 2 === 0) {
          doc.setFillColor(247, 248, 250)
          doc.rect(margin, y, employeeWidth + (block.end - block.start + 1) * dayWidth, rowHeight, "F")
        }
        doc.setTextColor(39, 39, 42)
        doc.setFont("helvetica", "normal")
        doc.setFontSize(6.5)
        doc.text((doc.splitTextToSize(`${row.employeeName} (${row.employeeCode})`, employeeWidth - 3) as string[])[0], margin + 2, y + 4.7)
        for (let day = block.start; day <= block.end; day += 1) doc.text(calendarCode(input, row, day), margin + employeeWidth + (day - block.start) * dayWidth + dayWidth / 2, y + 4.7, { align: "center" })
        y += rowHeight
      })
      doc.setFontSize(7)
      doc.setTextColor(100, 116, 139)
      doc.text("P Present | HD Half-day | PL Paid leave | A Absent/unpaid | WO Weekly off | H Holiday | - Not marked", margin, 202)
      doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - margin, 202, { align: "right" })
      if (!input.rows.length) {
        doc.setFontSize(10)
        doc.text("No employees are available for this entity.", margin, 45)
      }
    }
  }

  const summaryHeaders = ["Employee", "Working", "Present", "Half", "Paid", "Unpaid", "Excess", "Payable", "LOP (INR)"]
  const summaryWidths = [65, 23, 23, 20, 22, 22, 22, 23, 37]
  for (let offset = 0; offset < input.rows.length || offset === 0; offset += rowsPerPage) {
    doc.addPage("a4", "landscape")
    header("Payroll attendance summary")
    let y = 27
    let x = margin
    doc.setFillColor(24, 24, 27)
    doc.rect(margin, y, summaryWidths.reduce((sum, width) => sum + width, 0), rowHeight, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    summaryHeaders.forEach((label, index) => { doc.text(label, x + 2, y + 4.7); x += summaryWidths[index] })
    y += rowHeight
    input.rows.slice(offset, offset + rowsPerPage).forEach((row, rowIndex) => {
      if (rowIndex % 2 === 0) {
        doc.setFillColor(247, 248, 250)
        doc.rect(margin, y, summaryWidths.reduce((sum, width) => sum + width, 0), rowHeight, "F")
      }
      const values = [row.employeeName, row.workingDays, attendancePresentDays(row.attendance), row.attendance.halfDays, row.attendance.paidLeaveDays, row.attendance.unpaidLeaveDays, row.attendance.excessLeaveDays || 0, row.payableDays, row.deductionAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })]
      x = margin
      doc.setTextColor(39, 39, 42)
      doc.setFont("helvetica", "normal")
      doc.setFontSize(6.5)
      values.forEach((value, index) => { doc.text(String(value), x + 2, y + 4.7); x += summaryWidths[index] })
      y += rowHeight
    })
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(7)
    doc.text(`Weekly offs: Saturday ${input.calendar.saturdayWeeklyOff ? "included" : "not included"}, Sunday ${input.calendar.sundayWeeklyOff ? "included" : "not included"} | Holidays: ${input.calendar.holidays.length}`, margin, 202)
    doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - margin, 202, { align: "right" })
  }
  doc.save(`${fileStem(input)}.pdf`)
}
