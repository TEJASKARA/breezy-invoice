import { getExpenseBillFile } from "@/lib/expense-bills"
import { createInvoicePdfFile } from "@/lib/invoice-pdf"
import type { Company, Customer, Employee, Expense, Invoice, Payslip, Proforma, Setup, TallySettings, TemplateSettings } from "@/lib/mvp-store"
import { createPayslipPdfFile } from "@/lib/payslip-pdf"
import { createTallyPayrollXml, createTallySalesXml } from "@/lib/tally-xml"
import { downloadZip, type ZipFile } from "@/lib/zip-download"

export type ExportCategory = "invoices" | "proformas" | "expenses" | "employees" | "attendance" | "payslips"

type CompleteExportInput = {
  entity: Company
  customers: Customer[]
  employees: Employee[]
  invoices: Invoice[]
  proformas: Proforma[]
  payslips: Payslip[]
  expenses: Expense[]
  setup: Setup | null
  template: TemplateSettings
  tallySettings: TallySettings
  categories: ExportCategory[]
  dateFrom: string
  dateTo: string
}

const encoder = new TextEncoder()
const clean = (value: string) => value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "export"

function addSheet(XLSX: typeof import("xlsx"), workbook: import("xlsx").WorkBook, name: string, rows: Record<string, unknown>[]) {
  const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: "No records in the selected period" }])
  worksheet["!cols"] = Array.from({ length: Math.max(1, Object.keys(rows[0] || {}).length) }, () => ({ wch: 20 }))
  XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31))
}

function attendanceRows(setup: Setup | null, entityId: string, dateFrom: string, dateTo: string, employees: Employee[]) {
  return Object.values(setup?.attendanceDrafts || {})
    .filter((draft) => draft.entityId === entityId && `${draft.month}-01` >= dateFrom.slice(0, 7) + "-01" && `${draft.month}-01` <= dateTo.slice(0, 7) + "-01")
    .flatMap((draft) => Object.entries(draft.employeeRecords).flatMap(([employeeId, records]) => {
      const employee = employees.find((item) => item.id === employeeId)
      return records.filter((record) => record.date >= dateFrom && record.date <= dateTo).map((record) => ({
        Month: draft.month,
        Date: record.date,
        "Employee Code": employee?.employeeCode || "",
        "Employee Name": employee?.employeeName || "Unknown employee",
        Status: record.status.replaceAll("_", " "),
      }))
    }))
}

export async function downloadCompleteDataExport(input: CompleteExportInput) {
  const XLSX = await import("xlsx")
  const workbook = XLSX.utils.book_new()
  const files: ZipFile[] = []
  const selected = new Set(input.categories)

  if (selected.has("invoices")) addSheet(XLSX, workbook, "Invoices", input.invoices.map((invoice) => ({
    "Invoice Number": invoice.sourceNumber || invoice.number,
    Date: invoice.date,
    Customer: invoice.companyName,
    Taxable: invoice.taxableAmount,
    CGST: invoice.cgstAmount,
    SGST: invoice.sgstAmount,
    IGST: invoice.igstAmount,
    Total: invoice.amount,
    Status: invoice.status,
  })))
  if (selected.has("proformas")) addSheet(XLSX, workbook, "Quotations", input.proformas.map((proforma) => ({
    "Quotation Number": proforma.number,
    Date: proforma.date,
    "Valid Until": proforma.validUntil || "",
    Customer: proforma.companyName,
    Total: proforma.amount,
    Status: proforma.status,
  })))
  if (selected.has("expenses")) addSheet(XLSX, workbook, "Expenses", input.expenses.map((expense) => ({
    Date: expense.date,
    Name: expense.name,
    Category: expense.category,
    Vendor: expense.vendorName,
    Amount: expense.amount,
    "Payment Status": expense.paymentStatus,
    Notes: expense.notes,
    "Bill File": expense.billName || "",
  })))
  if (selected.has("employees")) addSheet(XLSX, workbook, "Employees", input.employees.map((employee) => ({
    "Employee Code": employee.employeeCode,
    "Employee Name": employee.employeeName,
    Designation: employee.designation,
    Department: employee.department,
    PAN: employee.pan,
    UAN: employee.uan,
    "ESI Number": employee.esiNumber,
    Bank: employee.bankName,
    "Bank Account": employee.bankAccount,
    IFSC: employee.ifsc,
    Status: employee.employmentStatus,
  })))
  if (selected.has("attendance")) addSheet(XLSX, workbook, "Attendance", attendanceRows(input.setup, input.entity.id, input.dateFrom, input.dateTo, input.employees))
  if (selected.has("payslips")) addSheet(XLSX, workbook, "Payslips", input.payslips.map((payslip) => ({
    Month: payslip.month,
    "Employee Code": payslip.employeeCode,
    "Employee Name": payslip.employeeName,
    "Gross Pay": payslip.grossPay,
    Deductions: payslip.totalDeductions,
    "Net Pay": payslip.netPay,
    "Working Days": payslip.workingDays,
    "Payable Days": payslip.payableDays,
    Status: payslip.status,
  })))

  const workbookData = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer
  files.push({ name: "Excel/ChanaX-data-export.xlsx", data: new Uint8Array(workbookData) })

  if (selected.has("invoices")) {
    for (const invoice of input.invoices) {
      const customer = input.customers.find((item) => item.id === invoice.customerId)
      const pdf = await createInvoicePdfFile({ invoice, entity: input.entity, customer, template: input.template })
      files.push({ ...pdf, name: `Invoices/PDF/${pdf.name}` })
    }
    const xml = createTallySalesXml({ companyName: input.tallySettings.companyName, invoices: input.invoices, customers: input.customers, settings: input.tallySettings })
    files.push({ name: "Invoices/Tally-Sales.xml", data: encoder.encode(xml) })
  }

  if (selected.has("proformas")) {
    const proformaTemplate = { ...input.template, elements: { ...input.template.elements, invoiceTitle: { ...input.template.elements.invoiceTitle, label: "QUOTATION / PROFORMA" } } }
    for (const proforma of input.proformas) {
      const customer = input.customers.find((item) => item.id === proforma.customerId)
      const pdf = await createInvoicePdfFile({ invoice: proforma, entity: input.entity, customer, template: proformaTemplate, documentType: "quotation" })
      files.push({ ...pdf, name: `Quotations/PDF/${pdf.name.replace(/\.pdf$/i, "_quotation.pdf")}` })
    }
  }

  if (selected.has("payslips")) {
    for (const payslip of input.payslips) {
      const pdf = await createPayslipPdfFile({ payslip, entity: input.entity, template: input.template })
      files.push({ ...pdf, name: `Payslips/PDF/${pdf.name}` })
    }
    const xml = createTallyPayrollXml({ companyName: input.tallySettings.companyName, payslips: input.payslips, employees: input.employees, settings: input.tallySettings })
    files.push({ name: "Payslips/Tally-Payroll.xml", data: encoder.encode(xml) })
  }

  if (selected.has("expenses")) {
    for (const expense of input.expenses.filter((item) => item.billPath)) {
      try {
        files.push({ name: `Expenses/Bills/${expense.billName || `${clean(expense.name)}-bill`}`, data: await getExpenseBillFile(expense.billPath!) })
      } catch {
        files.push({ name: `Expenses/Bills/${clean(expense.name)}-unavailable.txt`, data: encoder.encode("The stored bill could not be downloaded. Please retry from the Expenses page.") })
      }
    }
  }

  const archive = `ChanaX-${clean(input.entity.companyName)}-${input.dateFrom}-to-${input.dateTo}.zip`
  downloadZip(files, archive)
  return files.length
}
