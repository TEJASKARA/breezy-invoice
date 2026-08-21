import { useMemo, useRef, useState } from "react"
import { Copy, Download, Eye, FileSpreadsheet, Pencil, Plus, Trash2, Upload, UserPlus, X } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PayslipPreview } from "@/components/payslip-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type Employee, type PayrollComponent, type Payslip, useMvpStore } from "@/lib/mvp-store"
import { cleanPayslipFileName, defaultDeductions, defaultEarnings, formatSalaryMonth, nextSalaryMonth, payrollId, sumPayrollComponents } from "@/lib/payslip-calculations"
import { createPayslipPdfFile, downloadPayslipPdf } from "@/lib/payslip-pdf"
import { parseDocumentStatus, parseMoney, pickCell, readSpreadsheet } from "@/lib/spreadsheet"
import { downloadZip } from "@/lib/zip-download"
import { useWorkspaceAccess } from "@/lib/workspace-access"

type PayslipDraft = Omit<Payslip, "id">
type ImportPayslip = Omit<Payslip, "id">
type ImportEmployee = Omit<Employee, "id">

const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
const currentMonth = () => new Date().toISOString().slice(0, 7)
const cloneComponents = (items: PayrollComponent[]) => items.map((item) => ({ ...item, id: payrollId() }))
const normalizedLabel = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")

const blankEmployee = (entityId = ""): Omit<Employee, "id"> => ({
  entityId,
  employeeCode: "",
  employeeName: "",
  designation: "",
  department: "",
  pan: "",
  uan: "",
  esiNumber: "",
  bankName: "",
  bankAccount: "",
  ifsc: "",
  employmentStatus: "Regular Full-time",
  joiningDate: "",
  defaultEarnings: defaultEarnings(),
  defaultDeductions: defaultDeductions(),
})

function amountFor(items: PayrollComponent[], ...labels: string[]) {
  const wanted = new Set(labels.map(normalizedLabel))
  return items.find((item) => wanted.has(normalizedLabel(item.label)))?.amount || 0
}

export function EmployeesPage() {
  const {
    companies,
    employees,
    payslips,
    template,
    addEmployee,
    addEmployees,
    updateEmployee,
    deleteEmployee,
    addPayslip,
    addPayslips,
    updatePayslip,
    deletePayslip,
  } = useMvpStore()
  const { can } = useWorkspaceAccess()
  const canManage = can("payslips.manage")
  const [selectedEntityId, setSelectedEntityId] = useState(companies[0]?.id || "")
  const [showEmployeeForm, setShowEmployeeForm] = useState(false)
  const [employeeDraft, setEmployeeDraft] = useState<Omit<Employee, "id">>(blankEmployee(companies[0]?.id || ""))
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null)
  const [showPayslipForm, setShowPayslipForm] = useState(false)
  const [editingPayslipId, setEditingPayslipId] = useState<string | null>(null)
  const [payslipDraft, setPayslipDraft] = useState<PayslipDraft | null>(null)
  const [rememberStructure, setRememberStructure] = useState(true)
  const [previewPayslip, setPreviewPayslip] = useState<Payslip | null>(null)
  const [employeeImportPreview, setEmployeeImportPreview] = useState<ImportEmployee[]>([])
  const [bulkPreview, setBulkPreview] = useState<ImportPayslip[]>([])
  const [bulkDownloadPending, setBulkDownloadPending] = useState(false)
  const [bulkPayslipsSaved, setBulkPayslipsSaved] = useState(false)
  const [bulkMonth, setBulkMonth] = useState(currentMonth())
  const [excludedPayslipEmployeeIds, setExcludedPayslipEmployeeIds] = useState<string[]>([])
  const [bulkEmployeeSearch, setBulkEmployeeSearch] = useState("")
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ type: "employee" | "payslip"; id: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const employeeFileInput = useRef<HTMLInputElement>(null)

  const entityEmployees = useMemo(() => employees.filter((employee) => employee.entityId === selectedEntityId), [employees, selectedEntityId])
  const entityPayslips = useMemo(() => payslips.filter((payslip) => payslip.entityId === selectedEntityId), [payslips, selectedEntityId])
  const selectedEntity = companies.find((company) => company.id === selectedEntityId)
  const existingBulkPayslipEmployeeIds = useMemo(() => new Set(payslips.filter((payslip) => payslip.entityId === selectedEntityId && payslip.month === bulkMonth).map((payslip) => payslip.employeeId)), [payslips, selectedEntityId, bulkMonth])
  const eligibleBulkEmployees = entityEmployees.filter((employee) => !existingBulkPayslipEmployeeIds.has(employee.id))
  const selectedBulkEmployeeCount = eligibleBulkEmployees.filter((employee) => !excludedPayslipEmployeeIds.includes(employee.id)).length
  const normalizedBulkEmployeeSearch = bulkEmployeeSearch.trim().toLowerCase()
  const visibleBulkEmployees = normalizedBulkEmployeeSearch
    ? entityEmployees.filter((employee) => [employee.employeeName, employee.employeeCode, employee.designation, employee.department].some((value) => value.toLowerCase().includes(normalizedBulkEmployeeSearch)))
    : entityEmployees

  const clearMessages = () => {
    setNotice("")
    setError("")
  }

  const changeEntity = (entityId: string) => {
    setSelectedEntityId(entityId)
    setEmployeeDraft(blankEmployee(entityId))
    setShowEmployeeForm(false)
    setShowPayslipForm(false)
    setEmployeeImportPreview([])
    setBulkPreview([])
    setBulkPayslipsSaved(false)
    setExcludedPayslipEmployeeIds([])
    setBulkEmployeeSearch("")
    clearMessages()
  }

  const saveEmployee = async () => {
    clearMessages()
    const employeeName = employeeDraft.employeeName.trim()
    const employeeCode = employeeDraft.employeeCode.trim().toUpperCase()
    if (!employeeDraft.entityId || !employeeName || !employeeCode) {
      setError("Select an entity and enter the employee name and employee code.")
      return
    }
    const duplicate = employees.some((employee) => employee.entityId === employeeDraft.entityId && employee.employeeCode.toUpperCase() === employeeCode && employee.id !== editingEmployeeId)
    if (duplicate) {
      setError("This employee code already exists for the selected entity.")
      return
    }
    const normalized = { ...employeeDraft, employeeName, employeeCode, pan: employeeDraft.pan.trim().toUpperCase(), ifsc: employeeDraft.ifsc.trim().toUpperCase() }
    setSaving(true)
    try {
      if (editingEmployeeId) {
        await updateEmployee(editingEmployeeId, normalized)
        setNotice(`${employeeName}'s employee profile was updated.`)
      } else {
        await addEmployee(normalized)
        setNotice(`${employeeName} was added. You can now generate a payslip.`)
      }
      setEmployeeDraft(blankEmployee(selectedEntityId))
      setEditingEmployeeId(null)
      setShowEmployeeForm(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The employee could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  const editEmployee = (employee: Employee) => {
    clearMessages()
    setEmployeeDraft({ ...employee, defaultEarnings: cloneComponents(employee.defaultEarnings), defaultDeductions: cloneComponents(employee.defaultDeductions) })
    setEditingEmployeeId(employee.id)
    setShowEmployeeForm(true)
  }

  const downloadEmployeeTemplate = () => {
    const link = document.createElement("a")
    link.href = "/templates/BreezyInvoice-employee-import-template.xlsx"
    link.download = "BreezyInvoice-employee-import-template.xlsx"
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const importEmployeesFile = async (file: File) => {
    clearMessages()
    setEmployeeImportPreview([])
    try {
      const rows = await readSpreadsheet(file)
      const imported: ImportEmployee[] = []
      const problems: string[] = []
      const codesInFile = new Set<string>()
      rows.forEach((row, index) => {
        const rowNumber = index + 2
        const employeeCode = pickCell(row, "Employee Code", "Employee ID").trim().toUpperCase()
        const employeeName = pickCell(row, "Employee Name", "Name").trim()
        if (!employeeCode && !employeeName) return
        if (employeeCode.startsWith("EXAMPLE-")) return
        if (!employeeCode || !employeeName) {
          problems.push(`Row ${rowNumber}: employee code and employee name are required.`)
          return
        }
        if (codesInFile.has(employeeCode)) {
          problems.push(`Row ${rowNumber}: employee code ${employeeCode} is repeated in the file.`)
          return
        }
        if (entityEmployees.some((employee) => employee.employeeCode.toUpperCase() === employeeCode)) {
          problems.push(`Row ${rowNumber}: employee code ${employeeCode} already exists for this entity.`)
          return
        }
        const pan = pickCell(row, "PAN", "PAN Number").toUpperCase()
        const ifsc = pickCell(row, "IFSC", "IFSC Code").toUpperCase()
        const joiningDate = pickCell(row, "Joining Date", "Date of Joining")
        if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
          problems.push(`Row ${rowNumber}: PAN must use a valid format such as ABCDE1234F.`)
          return
        }
        if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
          problems.push(`Row ${rowNumber}: IFSC must use a valid 11-character format.`)
          return
        }
        if (joiningDate && !/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) {
          problems.push(`Row ${rowNumber}: joining date must use YYYY-MM-DD.`)
          return
        }
        const money = (...names: string[]) => Math.max(0, parseMoney(pickCell(row, ...names)) || 0)
        codesInFile.add(employeeCode)
        imported.push({
          entityId: selectedEntityId,
          employeeCode,
          employeeName,
          designation: pickCell(row, "Designation", "Job Title"),
          department: pickCell(row, "Department"),
          pan,
          uan: pickCell(row, "UAN", "UAN Number"),
          esiNumber: pickCell(row, "ESI Number", "ESIC Number", "ESI"),
          bankName: pickCell(row, "Bank Name"),
          bankAccount: pickCell(row, "Bank Account Number", "Bank Account", "Account Number"),
          ifsc,
          employmentStatus: pickCell(row, "Employment Status", "Status") || "Regular Full-time",
          joiningDate,
          defaultEarnings: [
            { id: payrollId(), label: "Basic Salary", amount: money("Basic Salary", "Basic") },
            { id: payrollId(), label: "House Rent Allowance (HRA)", amount: money("HRA", "House Rent Allowance") },
            { id: payrollId(), label: "Special Allowance", amount: money("Special Allowance") },
          ],
          defaultDeductions: [
            { id: payrollId(), label: "Provident Fund (PF)", amount: money("PF", "Provident Fund") },
            { id: payrollId(), label: "Professional Tax", amount: money("Professional Tax", "PT") },
            { id: payrollId(), label: "TDS / Income Tax", amount: money("TDS", "Income Tax") },
          ],
        })
      })
      if (!imported.length) {
        setError(problems.length ? problems.slice(0, 6).join(" ") : "No employee rows were found. Use the downloadable BreezyInvoice employee template.")
        return
      }
      setEmployeeImportPreview(imported)
      setNotice(`${imported.length} employee${imported.length === 1 ? "" : "s"} ready to add to ${selectedEntity?.companyName}.`)
      if (problems.length) setError(`${problems.length} row${problems.length === 1 ? "" : "s"} need correction: ${problems.slice(0, 4).join(" ")}${problems.length > 4 ? " Review the remaining rows in the file." : ""}`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "The employee spreadsheet could not be read.")
    }
  }

  const findPreviousPayslip = (employeeId: string, month: string) =>
    payslips
      .filter((payslip) => payslip.employeeId === employeeId && payslip.month < month)
      .sort((a, b) => b.month.localeCompare(a.month))[0]

  const draftForEmployee = (employee: Employee, month: string): PayslipDraft => {
    const previous = findPreviousPayslip(employee.id, month)
    const earnings = cloneComponents(previous?.earnings?.length ? previous.earnings : employee.defaultEarnings)
    const deductions = cloneComponents(previous?.deductions?.length ? previous.deductions : employee.defaultDeductions)
    const grossPay = sumPayrollComponents(earnings)
    const totalDeductions = sumPayrollComponents(deductions)
    if (previous) setNotice(`Copied salary details from ${formatSalaryMonth(previous.month)}. You can change any amount before saving.`)
    return {
      entityId: employee.entityId,
      entityName: companies.find((company) => company.id === employee.entityId)?.companyName || "",
      employeeId: employee.id,
      employeeName: employee.employeeName,
      employeeCode: employee.employeeCode,
      designation: employee.designation,
      department: employee.department,
      pan: employee.pan,
      uan: employee.uan,
      esiNumber: employee.esiNumber,
      bankName: employee.bankName,
      bankAccount: employee.bankAccount,
      ifsc: employee.ifsc,
      employmentStatus: employee.employmentStatus,
      month,
      paymentDate: "",
      workingDays: 30,
      payableDays: 30,
      earnings,
      deductions,
      grossPay,
      totalDeductions,
      netPay: grossPay - totalDeductions,
      status: "Draft",
    }
  }

  const openPayslipForm = (employeeId = entityEmployees[0]?.id || "", month = currentMonth()) => {
    clearMessages()
    if (!selectedEntityId) {
      setError("Add or select an entity first.")
      return
    }
    if (!employeeId) {
      setError("Add an employee first, then create the payslip.")
      setShowEmployeeForm(true)
      setEmployeeDraft(blankEmployee(selectedEntityId))
      return
    }
    const employee = employees.find((item) => item.id === employeeId)
    if (!employee) return
    setPayslipDraft(draftForEmployee(employee, month))
    setEditingPayslipId(null)
    setRememberStructure(true)
    setShowPayslipForm(true)
  }

  const selectPayslipEmployee = (employeeId: string) => {
    const employee = employees.find((item) => item.id === employeeId)
    if (employee) setPayslipDraft(draftForEmployee(employee, payslipDraft?.month || currentMonth()))
  }

  const changePayslipMonth = (month: string) => {
    if (!payslipDraft) return
    const employee = employees.find((item) => item.id === payslipDraft.employeeId)
    if (employee && !editingPayslipId) setPayslipDraft(draftForEmployee(employee, month))
    else setPayslipDraft({ ...payslipDraft, month })
  }

  const updateComponent = (kind: "earnings" | "deductions", itemId: string, changes: Partial<PayrollComponent>) => {
    if (!payslipDraft) return
    const items = payslipDraft[kind].map((item) => item.id === itemId ? { ...item, ...changes } : item)
    const next = { ...payslipDraft, [kind]: items }
    const grossPay = kind === "earnings" ? sumPayrollComponents(items) : sumPayrollComponents(next.earnings)
    const totalDeductions = kind === "deductions" ? sumPayrollComponents(items) : sumPayrollComponents(next.deductions)
    setPayslipDraft({ ...next, grossPay, totalDeductions, netPay: grossPay - totalDeductions })
  }

  const removeComponent = (kind: "earnings" | "deductions", itemId: string) => {
    if (!payslipDraft) return
    const items = payslipDraft[kind].filter((item) => item.id !== itemId)
    const next = { ...payslipDraft, [kind]: items }
    const grossPay = sumPayrollComponents(next.earnings)
    const totalDeductions = sumPayrollComponents(next.deductions)
    setPayslipDraft({ ...next, grossPay, totalDeductions, netPay: grossPay - totalDeductions })
  }

  const addComponent = (kind: "earnings" | "deductions") => {
    if (!payslipDraft) return
    setPayslipDraft({ ...payslipDraft, [kind]: [...payslipDraft[kind], { id: payrollId(), label: "", amount: 0 }] })
  }

  const savePayslip = async () => {
    clearMessages()
    if (!payslipDraft || !payslipDraft.employeeId || !payslipDraft.month) {
      setError("Select an employee and salary month.")
      return
    }
    if (payslipDraft.netPay < 0 || payslipDraft.grossPay <= 0) {
      setError("Total earnings must be greater than zero and deductions cannot exceed earnings.")
      return
    }
    const duplicate = payslips.find((payslip) => payslip.employeeId === payslipDraft.employeeId && payslip.month === payslipDraft.month && payslip.id !== editingPayslipId)
    if (duplicate) {
      setError(`A payslip already exists for ${payslipDraft.employeeName} in ${formatSalaryMonth(payslipDraft.month)}. Edit the existing payslip instead.`)
      return
    }
    const cleaned = {
      ...payslipDraft,
      earnings: payslipDraft.earnings.filter((item) => item.label.trim()).map((item) => ({ ...item, label: item.label.trim(), amount: Math.max(0, item.amount) })),
      deductions: payslipDraft.deductions.filter((item) => item.label.trim()).map((item) => ({ ...item, label: item.label.trim(), amount: Math.max(0, item.amount) })),
      generatedAt: payslipDraft.status === "Generated" ? new Date().toISOString() : undefined,
    }
    setSaving(true)
    try {
      if (editingPayslipId) {
        await updatePayslip(editingPayslipId, cleaned)
        setNotice(`${cleaned.employeeName}'s ${formatSalaryMonth(cleaned.month)} payslip was updated.`)
      } else {
        await addPayslip(cleaned)
        setNotice(`${cleaned.employeeName}'s ${formatSalaryMonth(cleaned.month)} payslip was saved.`)
      }
      if (rememberStructure) await updateEmployee(cleaned.employeeId, { defaultEarnings: cloneComponents(cleaned.earnings), defaultDeductions: cloneComponents(cleaned.deductions) })
      setShowPayslipForm(false)
      setPayslipDraft(null)
      setEditingPayslipId(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payslip could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  const editPayslip = (payslip: Payslip) => {
    clearMessages()
    setPayslipDraft({ ...payslip, earnings: cloneComponents(payslip.earnings), deductions: cloneComponents(payslip.deductions) })
    setEditingPayslipId(payslip.id)
    setRememberStructure(false)
    setShowPayslipForm(true)
  }

  const copyPayslipToNextMonth = (payslip: Payslip) => {
    clearMessages()
    const month = nextSalaryMonth(payslip.month)
    setPayslipDraft({
      ...payslip,
      month,
      paymentDate: "",
      status: "Draft",
      generatedAt: undefined,
      earnings: cloneComponents(payslip.earnings),
      deductions: cloneComponents(payslip.deductions),
    })
    setEditingPayslipId(null)
    setRememberStructure(true)
    setShowPayslipForm(true)
    setNotice(`Copied ${formatSalaryMonth(payslip.month)} into ${formatSalaryMonth(month)}. Change anything that is different, then save.`)
  }

  const preparePayslipsFromSavedSalary = () => {
    clearMessages()
    setBulkPreview([])
    setBulkPayslipsSaved(false)
    if (!bulkMonth || !/^\d{4}-\d{2}$/.test(bulkMonth)) {
      setError("Select a valid salary month.")
      return
    }
    const selectedEmployees = entityEmployees.filter((employee) =>
      !excludedPayslipEmployeeIds.includes(employee.id) &&
      !payslips.some((payslip) => payslip.employeeId === employee.id && payslip.month === bulkMonth),
    )
    if (!selectedEmployees.length) {
      setError("Select at least one employee who does not already have a payslip for this month.")
      return
    }
    const invalidEmployees: string[] = []
    const prepared = selectedEmployees.flatMap((employee): ImportPayslip[] => {
      const earnings = cloneComponents(employee.defaultEarnings).filter((item) => item.label.trim() && item.amount > 0)
      const deductions = cloneComponents(employee.defaultDeductions).filter((item) => item.label.trim() && item.amount > 0)
      const grossPay = sumPayrollComponents(earnings)
      const totalDeductions = sumPayrollComponents(deductions)
      if (grossPay <= 0 || totalDeductions > grossPay) {
        invalidEmployees.push(employee.employeeName)
        return []
      }
      return [{
        entityId: employee.entityId,
        entityName: selectedEntity?.companyName || "",
        employeeId: employee.id,
        employeeName: employee.employeeName,
        employeeCode: employee.employeeCode,
        designation: employee.designation,
        department: employee.department,
        pan: employee.pan,
        uan: employee.uan,
        esiNumber: employee.esiNumber,
        bankName: employee.bankName,
        bankAccount: employee.bankAccount,
        ifsc: employee.ifsc,
        employmentStatus: employee.employmentStatus,
        month: bulkMonth,
        paymentDate: "",
        workingDays: 30,
        payableDays: 30,
        earnings,
        deductions,
        grossPay,
        totalDeductions,
        netPay: grossPay - totalDeductions,
        status: "Generated",
        generatedAt: new Date().toISOString(),
      }]
    })
    if (!prepared.length) {
      setError("The selected employees do not have a valid saved salary. Add earnings to their employee profiles first.")
      return
    }
    setBulkPreview(prepared)
    setNotice(`${prepared.length} selected payslip${prepared.length === 1 ? " is" : "s are"} ready using saved employee salaries.${invalidEmployees.length ? ` ${invalidEmployees.length} employee${invalidEmployees.length === 1 ? " was" : "s were"} skipped because the saved salary is invalid.` : ""}`)
  }

  const downloadBulkTemplate = async () => {
    clearMessages()
    if (!selectedEntityId || !entityEmployees.length) {
      setError("Select an entity with at least one employee before downloading the monthly template.")
      return
    }
    const XLSX = await import("xlsx")
    const rows = entityEmployees.map((employee) => {
      const previous = findPreviousPayslip(employee.id, bulkMonth)
      const earnings = previous?.earnings?.length ? previous.earnings : employee.defaultEarnings
      const deductions = previous?.deductions?.length ? previous.deductions : employee.defaultDeductions
      return {
        "Employee Code": employee.employeeCode,
        "Employee Name": employee.employeeName,
        "Salary Month": bulkMonth,
        "Working Days": previous?.workingDays || 30,
        "Payable Days": previous?.payableDays || 30,
        "Basic Salary": amountFor(earnings, "Basic Salary"),
        "HRA": amountFor(earnings, "House Rent Allowance (HRA)", "HRA"),
        "Special Allowance": amountFor(earnings, "Special Allowance"),
        "Bonus / Incentive": amountFor(earnings, "Bonus / Incentive", "Performance Bonus", "Bonus"),
        "Other Earnings": amountFor(earnings, "Other Earnings", "Other Allowance"),
        "PF": amountFor(deductions, "Provident Fund (PF)", "PF"),
        "ESI": amountFor(deductions, "ESI"),
        "Professional Tax": amountFor(deductions, "Professional Tax", "PT"),
        "TDS": amountFor(deductions, "TDS / Income Tax", "TDS"),
        "Loan / Advance Recovery": amountFor(deductions, "Loan / Advance Recovery"),
        "Other Deductions": amountFor(deductions, "Other Deductions"),
        "Payment Date": "",
        "Status": "Generated",
      }
    })
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(rows)
    worksheet["!cols"] = Object.keys(rows[0]).map((heading) => ({ wch: Math.max(14, heading.length + 2) }))
    XLSX.utils.book_append_sheet(workbook, worksheet, "Monthly Payslips")
    XLSX.writeFile(workbook, `BreezyInvoice-payslips-${bulkMonth}.xlsx`, { compression: true })
  }

  const importBulkFile = async (file: File) => {
    clearMessages()
    try {
      const rows = await readSpreadsheet(file)
      const imported: ImportPayslip[] = []
      const skipped: string[] = []
      rows.forEach((row, index) => {
        const code = pickCell(row, "Employee Code", "Employee ID").toUpperCase()
        const name = pickCell(row, "Employee Name", "Employee")
        const employee = entityEmployees.find((item) => item.employeeCode.toUpperCase() === code) || entityEmployees.find((item) => item.employeeName.toLowerCase() === name.toLowerCase())
        const month = pickCell(row, "Salary Month", "Month") || bulkMonth
        if (!employee || !/^\d{4}-\d{2}$/.test(month)) {
          skipped.push(`row ${index + 2}`)
          return
        }
        const earnings = [
          { id: payrollId(), label: "Basic Salary", amount: parseMoney(pickCell(row, "Basic Salary", "Basic")) || 0 },
          { id: payrollId(), label: "House Rent Allowance (HRA)", amount: parseMoney(pickCell(row, "HRA", "House Rent Allowance")) || 0 },
          { id: payrollId(), label: "Special Allowance", amount: parseMoney(pickCell(row, "Special Allowance")) || 0 },
          { id: payrollId(), label: "Bonus / Incentive", amount: parseMoney(pickCell(row, "Bonus / Incentive", "Bonus", "Incentive")) || 0 },
          { id: payrollId(), label: "Other Earnings", amount: parseMoney(pickCell(row, "Other Earnings", "Other Allowance")) || 0 },
        ].filter((item) => item.amount > 0)
        const deductions = [
          { id: payrollId(), label: "Provident Fund (PF)", amount: parseMoney(pickCell(row, "PF", "Provident Fund")) || 0 },
          { id: payrollId(), label: "ESI", amount: parseMoney(pickCell(row, "ESI")) || 0 },
          { id: payrollId(), label: "Professional Tax", amount: parseMoney(pickCell(row, "Professional Tax", "PT")) || 0 },
          { id: payrollId(), label: "TDS / Income Tax", amount: parseMoney(pickCell(row, "TDS", "Income Tax")) || 0 },
          { id: payrollId(), label: "Loan / Advance Recovery", amount: parseMoney(pickCell(row, "Loan / Advance Recovery", "Loan Recovery")) || 0 },
          { id: payrollId(), label: "Other Deductions", amount: parseMoney(pickCell(row, "Other Deductions")) || 0 },
        ].filter((item) => item.amount > 0)
        const grossPay = sumPayrollComponents(earnings)
        const totalDeductions = sumPayrollComponents(deductions)
        if (grossPay <= 0 || totalDeductions > grossPay) {
          skipped.push(`row ${index + 2}`)
          return
        }
        imported.push({
          entityId: employee.entityId,
          entityName: selectedEntity?.companyName || "",
          employeeId: employee.id,
          employeeName: employee.employeeName,
          employeeCode: employee.employeeCode,
          designation: employee.designation,
          department: employee.department,
          pan: employee.pan,
          uan: employee.uan,
          esiNumber: employee.esiNumber,
          bankName: employee.bankName,
          bankAccount: employee.bankAccount,
          ifsc: employee.ifsc,
          employmentStatus: employee.employmentStatus,
          month,
          paymentDate: pickCell(row, "Payment Date"),
          workingDays: Number(pickCell(row, "Working Days")) || 0,
          payableDays: Number(pickCell(row, "Payable Days")) || 0,
          earnings,
          deductions,
          grossPay,
          totalDeductions,
          netPay: grossPay - totalDeductions,
          status: parseDocumentStatus(pickCell(row, "Status")),
          generatedAt: new Date().toISOString(),
        })
      })
      const unique = imported.filter((item) => !payslips.some((existing) => existing.employeeId === item.employeeId && existing.month === item.month))
      const duplicateCount = imported.length - unique.length
      if (!unique.length) {
        setError("No new valid payslips were found. Check employee codes, salary month, and whether those months already exist.")
        return
      }
      setBulkPreview(unique)
      setBulkPayslipsSaved(false)
      setNotice(`${unique.length} payslips are ready to import${skipped.length ? `; ${skipped.length} invalid rows were skipped` : ""}${duplicateCount ? `; ${duplicateCount} existing payslips were skipped` : ""}.`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "The spreadsheet could not be read.")
    }
  }

  const downloadBulkPayslipZip = async () => {
    if (!selectedEntity || !bulkPreview.length) return
    setBulkDownloadPending(true)
    clearMessages()
    try {
      const files = []
      for (const [index, importedPayslip] of bulkPreview.entries()) {
        const payslip: Payslip = { ...importedPayslip, id: `bulk-payslip-${index}` }
        files.push(await createPayslipPdfFile({ payslip, entity: selectedEntity, template }))
      }
      downloadZip(files, `Payslips_${cleanPayslipFileName(selectedEntity.companyName)}_${cleanPayslipFileName(bulkMonth)}.zip`)
      setNotice(`${files.length} payslip PDFs downloaded in one ZIP folder.`)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "The payslip ZIP could not be created.")
    } finally {
      setBulkDownloadPending(false)
    }
  }

  if (!companies.length) {
    return <Card><CardHeader><CardTitle>Add an entity first</CardTitle><CardDescription>Payslips are generated by an entity. Create an entity, then add its employees here.</CardDescription></CardHeader></Card>
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Payroll"
        title="Employees & payslips"
        description="Add employees separately or through Excel, reuse last month’s salary, and generate individual or bulk payslips."
        actions={canManage ? <>
          <Button variant="outline" onClick={() => { setEmployeeDraft(blankEmployee(selectedEntityId)); setEditingEmployeeId(null); setShowEmployeeForm(true); clearMessages() }}><UserPlus />Add employee</Button>
          <Button onClick={() => openPayslipForm()}><Plus />Create payslip</Button>
        </> : null}
      />

      {!canManage ? <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">You have view-only access to employees and payslips. You can preview and download saved payslips, but record changes require payroll management permission.</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Bulk add employees</CardTitle>
          <CardDescription>Download the employee Excel template, enter one employee per row, and upload it to the selected entity.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_auto_auto] md:items-end">
          <div className="space-y-2"><Label htmlFor="payroll-entity">Payslip-generating entity</Label><select id="payroll-entity" className={selectClass} value={selectedEntityId} onChange={(event) => changeEntity(event.target.value)}>{companies.map((company) => <option key={company.id} value={company.id}>{company.companyName}</option>)}</select></div>
          {canManage ? <Button variant="outline" onClick={downloadEmployeeTemplate}><Download />Download employee template</Button> : null}
          {canManage ? <><input ref={employeeFileInput} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importEmployeesFile(file); event.target.value = "" }} /><Button onClick={() => employeeFileInput.current?.click()}><Upload />Upload completed Excel</Button></> : null}
        </CardContent>
      </Card>

      {canManage ? <Card>
        <CardHeader>
          <CardTitle>Bulk payslip generation</CardTitle>
          <CardDescription>Generate payslips directly from saved employee salaries, or use Excel when monthly amounts need wider changes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_auto_auto_auto] md:items-end">
            <div className="space-y-2"><Label htmlFor="bulk-month">Salary month</Label><Input id="bulk-month" type="month" value={bulkMonth} onChange={(event) => { setBulkMonth(event.target.value); setBulkPreview([]); setBulkPayslipsSaved(false) }} /></div>
            <Button disabled={!selectedBulkEmployeeCount} onClick={preparePayslipsFromSavedSalary}><FileSpreadsheet />Generate from saved salaries</Button>
            <Button variant="outline" onClick={() => void downloadBulkTemplate()}><Download />Download monthly Excel</Button>
            <><input ref={fileInput} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBulkFile(file); event.target.value = "" }} /><Button variant="outline" onClick={() => fileInput.current?.click()}><Upload />Upload monthly Excel</Button></>
          </div>

          <div className="rounded-xl border">
            <div className="space-y-4 border-b p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-medium">Choose employees</p><p className="text-sm text-muted-foreground">{selectedBulkEmployeeCount} of {eligibleBulkEmployees.length} eligible employees selected. Existing payslips for {formatSalaryMonth(bulkMonth)} cannot be selected again.</p></div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { const visibleIds = new Set(visibleBulkEmployees.map((employee) => employee.id)); setExcludedPayslipEmployeeIds((current) => current.filter((id) => !visibleIds.has(id))) }}>Select shown</Button>
                  <Button size="sm" variant="outline" onClick={() => setExcludedPayslipEmployeeIds((current) => [...new Set([...current, ...visibleBulkEmployees.map((employee) => employee.id)])])}>Deselect shown</Button>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input aria-label="Search employees for payslip generation" value={bulkEmployeeSearch} onChange={(event) => setBulkEmployeeSearch(event.target.value)} placeholder="Search employee name, code, designation, or department…" />
                {bulkEmployeeSearch && <Button size="sm" variant="ghost" onClick={() => setBulkEmployeeSearch("")}>Clear search</Button>}
              </div>
              {normalizedBulkEmployeeSearch && <p className="text-xs text-muted-foreground">Showing {visibleBulkEmployees.length} matching employee{visibleBulkEmployees.length === 1 ? "" : "s"}.</p>}
            </div>
            <div className="max-h-80 overflow-auto">
              <Table>
                <TableHeader><TableRow><TableHead className="w-12">Use</TableHead><TableHead>Employee</TableHead><TableHead>Saved gross</TableHead><TableHead>Saved deductions</TableHead><TableHead>Net salary</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>{visibleBulkEmployees.length ? visibleBulkEmployees.map((employee) => {
                  const alreadyExists = existingBulkPayslipEmployeeIds.has(employee.id)
                  const grossPay = sumPayrollComponents(employee.defaultEarnings)
                  const totalDeductions = sumPayrollComponents(employee.defaultDeductions)
                  const checked = !alreadyExists && !excludedPayslipEmployeeIds.includes(employee.id)
                  return <TableRow key={employee.id} className={alreadyExists ? "opacity-60" : undefined}>
                    <TableCell><input type="checkbox" aria-label={`Generate payslip for ${employee.employeeName}`} disabled={alreadyExists} checked={checked} onChange={(event) => setExcludedPayslipEmployeeIds((current) => event.target.checked ? current.filter((id) => id !== employee.id) : [...new Set([...current, employee.id])])} /></TableCell>
                    <TableCell><p className="font-medium">{employee.employeeName}</p><p className="text-xs text-muted-foreground">{employee.employeeCode}</p></TableCell>
                    <TableCell>₹{grossPay.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-red-600">₹{totalDeductions.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="font-medium">₹{(grossPay - totalDeductions).toLocaleString("en-IN")}</TableCell>
                    <TableCell>{alreadyExists ? <Badge variant="secondary">Already generated</Badge> : grossPay > 0 && totalDeductions <= grossPay ? <Badge variant="outline">Ready</Badge> : <Badge variant="destructive">Salary required</Badge>}</TableCell>
                  </TableRow>
                }) : <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">{entityEmployees.length ? "No employees match this search." : "Add employees before generating payslips."}</TableCell></TableRow>}</TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card> : null}

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{notice}</p>}

      {canManage && showEmployeeForm && (
        <EmployeeForm
          draft={employeeDraft}
          setDraft={setEmployeeDraft}
          editing={Boolean(editingEmployeeId)}
          saving={saving}
          onCancel={() => { setShowEmployeeForm(false); setEditingEmployeeId(null) }}
          onSave={saveEmployee}
        />
      )}

      {canManage && showPayslipForm && payslipDraft && (
        <Card>
          <CardHeader><CardTitle>{editingPayslipId ? "Edit payslip" : "Create individual payslip"}</CardTitle><CardDescription>Select an employee and month. BreezyInvoice automatically starts with the most recent saved salary structure.</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2 md:col-span-2"><Label htmlFor="payslip-employee">Employee</Label><select id="payslip-employee" disabled={Boolean(editingPayslipId)} className={selectClass} value={payslipDraft.employeeId} onChange={(event) => selectPayslipEmployee(event.target.value)}>{entityEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode} — {employee.employeeName}</option>)}</select></div>
              <div className="space-y-2"><Label htmlFor="payslip-month">Salary month</Label><Input id="payslip-month" type="month" value={payslipDraft.month} onChange={(event) => changePayslipMonth(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="payment-date">Payment date</Label><Input id="payment-date" type="date" value={payslipDraft.paymentDate} onChange={(event) => setPayslipDraft({ ...payslipDraft, paymentDate: event.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="working-days">Working days</Label><Input id="working-days" type="number" min="0" max="31" value={payslipDraft.workingDays} onChange={(event) => setPayslipDraft({ ...payslipDraft, workingDays: Number(event.target.value) })} /></div>
              <div className="space-y-2"><Label htmlFor="payable-days">Payable days</Label><Input id="payable-days" type="number" min="0" max="31" value={payslipDraft.payableDays} onChange={(event) => setPayslipDraft({ ...payslipDraft, payableDays: Number(event.target.value) })} /></div>
              <div className="space-y-2"><Label htmlFor="payslip-status">Status</Label><select id="payslip-status" className={selectClass} value={payslipDraft.status} onChange={(event) => setPayslipDraft({ ...payslipDraft, status: event.target.value as Payslip["status"] })}><option value="Draft">Draft</option><option value="Generated">Generated</option></select></div>
            </div>
            <div className="grid gap-7 lg:grid-cols-2">
              <ComponentEditor title="Earnings & benefits" items={payslipDraft.earnings} onAdd={() => addComponent("earnings")} onChange={(id, changes) => updateComponent("earnings", id, changes)} onRemove={(id) => removeComponent("earnings", id)} />
              <ComponentEditor title="Deductions & tax" items={payslipDraft.deductions} onAdd={() => addComponent("deductions")} onChange={(id, changes) => updateComponent("deductions", id, changes)} onRemove={(id) => removeComponent("deductions", id)} deductions />
            </div>
            <div className="grid gap-3 rounded-xl bg-muted p-4 text-sm sm:grid-cols-3">
              <div><span className="text-muted-foreground">Gross earnings</span><p className="text-lg font-semibold">₹{payslipDraft.grossPay.toLocaleString("en-IN")}</p></div>
              <div><span className="text-muted-foreground">Total deductions</span><p className="text-lg font-semibold text-red-600">₹{payslipDraft.totalDeductions.toLocaleString("en-IN")}</p></div>
              <div><span className="text-muted-foreground">Net take-home</span><p className="text-lg font-semibold text-blue-600">₹{payslipDraft.netPay.toLocaleString("en-IN")}</p></div>
            </div>
            <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={rememberStructure} onChange={(event) => setRememberStructure(event.target.checked)} /><span><strong>Use these salary components next month.</strong><span className="block text-muted-foreground">You can still edit every amount when the next payslip is created.</span></span></label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={saving} onClick={() => { setShowPayslipForm(false); setEditingPayslipId(null) }}>Cancel</Button>
              <Button variant="outline" disabled={saving} onClick={() => setPreviewPayslip({ ...payslipDraft, id: editingPayslipId || "preview" })}><Eye />Preview</Button>
              <Button disabled={saving} onClick={() => void savePayslip()}>{saving ? "Saving…" : editingPayslipId ? "Save changes" : "Save payslip"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {canManage && bulkPreview.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Bulk payslip preview</CardTitle><CardDescription>Review the calculated totals before saving this monthly payroll batch.</CardDescription></CardHeader>
          <CardContent>
            <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Month</TableHead><TableHead>Gross</TableHead><TableHead>Deductions</TableHead><TableHead>Net pay</TableHead></TableRow></TableHeader><TableBody>{bulkPreview.slice(0, 12).map((payslip) => <TableRow key={`${payslip.employeeId}-${payslip.month}`}><TableCell className="font-medium">{payslip.employeeName}</TableCell><TableCell>{formatSalaryMonth(payslip.month)}</TableCell><TableCell>₹{payslip.grossPay.toLocaleString("en-IN")}</TableCell><TableCell className="text-red-600">₹{payslip.totalDeductions.toLocaleString("en-IN")}</TableCell><TableCell className="font-semibold">₹{payslip.netPay.toLocaleString("en-IN")}</TableCell></TableRow>)}</TableBody></Table>
            <div className="mt-4 flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => { setBulkPreview([]); setBulkPayslipsSaved(false) }}>{bulkPayslipsSaved ? "Close" : "Cancel"}</Button><Button variant="outline" disabled={bulkDownloadPending || saving} onClick={() => void downloadBulkPayslipZip()}><Download />{bulkDownloadPending ? "Preparing ZIP…" : `Download ${bulkPreview.length} PDFs (ZIP)`}</Button><Button disabled={bulkPayslipsSaved || saving} onClick={async () => { const count = bulkPreview.length; setSaving(true); clearMessages(); try { await addPayslips(bulkPreview); await Promise.all(bulkPreview.map((item) => updateEmployee(item.employeeId, { defaultEarnings: cloneComponents(item.earnings), defaultDeductions: cloneComponents(item.deductions) }))); setBulkPayslipsSaved(true); setNotice(`${count} payslips were generated and saved. You can now download the complete batch as a ZIP.`) } catch (caught) { setError(caught instanceof Error ? caught.message : "The payslip batch could not be saved.") } finally { setSaving(false) } }}>{saving ? "Saving…" : bulkPayslipsSaved ? "Payslips generated" : `Generate ${bulkPreview.length} payslips`}</Button></div>
          </CardContent>
        </Card>
      )}

      {previewPayslip && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Payslip preview</CardTitle><CardDescription>Check the final layout before downloading.</CardDescription></div><Button size="icon" variant="ghost" aria-label="Close preview" onClick={() => setPreviewPayslip(null)}><X /></Button></CardHeader>
          <CardContent className="space-y-4"><div className="overflow-auto rounded-xl bg-muted p-3 sm:p-6"><PayslipPreview payslip={previewPayslip} entity={companies.find((company) => company.id === previewPayslip.entityId)} template={template} /></div><div className="flex justify-end"><Button onClick={() => void downloadPayslipPdf({ payslip: previewPayslip, entity: companies.find((company) => company.id === previewPayslip.entityId), template })}><Download />Download PDF</Button></div></CardContent>
        </Card>
      )}

      {canManage && employeeImportPreview.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Bulk employee preview</CardTitle><CardDescription>Review the employee master records before adding them to {selectedEntity?.companyName}.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Designation</TableHead><TableHead>PAN</TableHead><TableHead>Bank</TableHead><TableHead>Basic salary</TableHead></TableRow></TableHeader>
              <TableBody>{employeeImportPreview.slice(0, 15).map((employee) => <TableRow key={employee.employeeCode}><TableCell><p className="font-medium">{employee.employeeName}</p><p className="text-xs text-muted-foreground">{employee.employeeCode}</p></TableCell><TableCell>{employee.designation || "—"}<p className="text-xs text-muted-foreground">{employee.department}</p></TableCell><TableCell>{employee.pan || "—"}</TableCell><TableCell>{employee.bankName || "—"}</TableCell><TableCell>₹{amountFor(employee.defaultEarnings, "Basic Salary").toLocaleString("en-IN")}</TableCell></TableRow>)}</TableBody>
            </Table>
            {employeeImportPreview.length > 15 && <p className="mt-3 text-sm text-muted-foreground">Showing 15 of {employeeImportPreview.length} employees.</p>}
            <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => setEmployeeImportPreview([])}>Cancel</Button><Button disabled={saving} onClick={async () => { const count = employeeImportPreview.length; setSaving(true); clearMessages(); try { await addEmployees(employeeImportPreview); setEmployeeImportPreview([]); setNotice(`${count} employee${count === 1 ? "" : "s"} added to ${selectedEntity?.companyName}.`) } catch (caught) { setError(caught instanceof Error ? caught.message : "The employees could not be imported.") } finally { setSaving(false) } }}>{saving ? "Saving…" : `Add ${employeeImportPreview.length} employees`}</Button></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div><CardTitle>Employee master</CardTitle><CardDescription>{entityEmployees.length} employee{entityEmployees.length === 1 ? "" : "s"} saved for {selectedEntity?.companyName}.</CardDescription></div>
          </div>
        </CardHeader>
        <CardContent>
          <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Designation</TableHead><TableHead>PAN</TableHead><TableHead>Bank</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
            {entityEmployees.length ? entityEmployees.map((employee) => <TableRow key={employee.id}><TableCell><p className="font-medium">{employee.employeeName}</p><p className="text-xs text-muted-foreground">{employee.employeeCode}</p></TableCell><TableCell>{employee.designation || "—"}<p className="text-xs text-muted-foreground">{employee.department}</p></TableCell><TableCell>{employee.pan || "—"}</TableCell><TableCell>{employee.bankName || "—"}</TableCell><TableCell className="text-right">{!canManage ? <span className="text-xs text-muted-foreground">View only</span> : pendingDelete?.type === "employee" && pendingDelete.id === employee.id ? <span className="inline-flex gap-1"><Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button><Button size="sm" variant="destructive" onClick={async () => { try { await deleteEmployee(employee.id); setPendingDelete(null); setNotice(`${employee.employeeName} was removed from the active employee master. Existing payslips were kept.`) } catch (caught) { setError(caught instanceof Error ? caught.message : "The employee could not be deleted.") } }}>Confirm</Button></span> : <span className="inline-flex"><Button size="icon" variant="ghost" aria-label={`Edit ${employee.employeeName}`} onClick={() => editEmployee(employee)}><Pencil /></Button><Button size="icon" variant="ghost" aria-label={`Create payslip for ${employee.employeeName}`} onClick={() => openPayslipForm(employee.id)}><Plus /></Button><Button size="icon" variant="ghost" aria-label={`Delete ${employee.employeeName}`} onClick={() => setPendingDelete({ type: "employee", id: employee.id })}><Trash2 /></Button></span>}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Add the first employee for this entity.</TableCell></TableRow>}
          </TableBody></Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payslip history</CardTitle><CardDescription>Saved payslips remain available to preview, edit, copy into the next month, download, or delete.</CardDescription></CardHeader>
        <CardContent>
          <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Month</TableHead><TableHead>Net pay</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
            {entityPayslips.length ? entityPayslips.map((payslip) => <TableRow key={payslip.id}><TableCell className="font-medium">{payslip.employeeName}<p className="text-xs font-normal text-muted-foreground">{payslip.employeeCode}</p></TableCell><TableCell>{formatSalaryMonth(payslip.month)}</TableCell><TableCell>₹{payslip.netPay.toLocaleString("en-IN")}</TableCell><TableCell><Badge variant={payslip.status === "Draft" ? "secondary" : "outline"}>{payslip.status}</Badge></TableCell><TableCell className="text-right">{pendingDelete?.type === "payslip" && pendingDelete.id === payslip.id && canManage ? <span className="inline-flex gap-1"><Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button><Button size="sm" variant="destructive" onClick={async () => { try { await deletePayslip(payslip.id); setPendingDelete(null); setNotice(`${payslip.employeeName}'s ${formatSalaryMonth(payslip.month)} payslip was deleted.`) } catch (caught) { setError(caught instanceof Error ? caught.message : "The payslip could not be deleted.") } }}>Confirm</Button></span> : <span className="inline-flex"><Button size="icon" variant="ghost" aria-label="Preview payslip" onClick={() => setPreviewPayslip(payslip)}><Eye /></Button>{canManage ? <><Button size="icon" variant="ghost" aria-label="Edit payslip" onClick={() => editPayslip(payslip)}><Pencil /></Button><Button size="icon" variant="ghost" aria-label="Copy into next month" onClick={() => copyPayslipToNextMonth(payslip)}><Copy /></Button></> : null}<Button size="icon" variant="ghost" aria-label="Download payslip PDF" onClick={() => void downloadPayslipPdf({ payslip, entity: companies.find((company) => company.id === payslip.entityId), template })}><Download /></Button>{canManage ? <Button size="icon" variant="ghost" aria-label="Delete payslip" onClick={() => setPendingDelete({ type: "payslip", id: payslip.id })}><Trash2 /></Button> : null}</span>}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-40 text-center text-muted-foreground">Create an individual payslip or upload the monthly Excel file.</TableCell></TableRow>}
          </TableBody></Table>
        </CardContent>
      </Card>
    </div>
  )
}

function EmployeeForm({ draft, setDraft, editing, saving, onCancel, onSave }: { draft: Omit<Employee, "id">; setDraft: (employee: Omit<Employee, "id">) => void; editing: boolean; saving: boolean; onCancel: () => void; onSave: () => void }) {
  const field = (key: keyof Omit<Employee, "id">, value: string) => setDraft({ ...draft, [key]: value })
  return (
    <Card>
      <CardHeader><CardTitle>{editing ? "Edit employee" : "Add employee"}</CardTitle><CardDescription>Save stable employee and bank details once. Monthly payslips will reuse them automatically.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2"><Label htmlFor="employee-code">Employee code *</Label><Input id="employee-code" value={draft.employeeCode} onChange={(event) => field("employeeCode", event.target.value)} placeholder="EMP-001" /></div>
          <div className="space-y-2"><Label htmlFor="employee-name">Employee name *</Label><Input id="employee-name" value={draft.employeeName} onChange={(event) => field("employeeName", event.target.value)} placeholder="Rahul Sharma" /></div>
          <div className="space-y-2"><Label htmlFor="employee-status">Employment status</Label><select id="employee-status" className={selectClass} value={draft.employmentStatus} onChange={(event) => field("employmentStatus", event.target.value)}><option>Regular Full-time</option><option>Part-time</option><option>Contract</option><option>Intern</option></select></div>
          <div className="space-y-2"><Label htmlFor="designation">Designation</Label><Input id="designation" value={draft.designation} onChange={(event) => field("designation", event.target.value)} placeholder="Accounts Executive" /></div>
          <div className="space-y-2"><Label htmlFor="department">Department</Label><Input id="department" value={draft.department} onChange={(event) => field("department", event.target.value)} placeholder="Finance" /></div>
          <div className="space-y-2"><Label htmlFor="joining-date">Joining date</Label><Input id="joining-date" type="date" value={draft.joiningDate} onChange={(event) => field("joiningDate", event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="employee-pan">PAN</Label><Input id="employee-pan" maxLength={10} className="uppercase" value={draft.pan} onChange={(event) => field("pan", event.target.value)} placeholder="ABCDE1234F" /></div>
          <div className="space-y-2"><Label htmlFor="employee-uan">UAN</Label><Input id="employee-uan" value={draft.uan} onChange={(event) => field("uan", event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="employee-esi">ESI number</Label><Input id="employee-esi" value={draft.esiNumber} onChange={(event) => field("esiNumber", event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="bank-name">Bank name</Label><Input id="bank-name" value={draft.bankName} onChange={(event) => field("bankName", event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="bank-account">Bank account</Label><Input id="bank-account" value={draft.bankAccount} onChange={(event) => field("bankAccount", event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="ifsc">IFSC</Label><Input id="ifsc" className="uppercase" value={draft.ifsc} onChange={(event) => field("ifsc", event.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button><Button disabled={saving} onClick={onSave}>{saving ? "Saving…" : editing ? "Save changes" : "Add employee"}</Button></div>
      </CardContent>
    </Card>
  )
}

function ComponentEditor({ title, items, onAdd, onChange, onRemove, deductions = false }: { title: string; items: PayrollComponent[]; onAdd: () => void; onChange: (id: string, changes: Partial<PayrollComponent>) => void; onRemove: (id: string) => void; deductions?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-semibold">{title}</h3><Button type="button" size="sm" variant="outline" onClick={onAdd}><Plus />Add row</Button></div>
      <div className="space-y-2">{items.map((item) => <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_130px_36px] gap-2"><Input aria-label={`${title} description`} value={item.label} onChange={(event) => onChange(item.id, { label: event.target.value })} placeholder={deductions ? "Other deduction" : "Other earning"} /><Input aria-label={`${item.label || title} amount`} type="number" min="0" value={item.amount || ""} onChange={(event) => onChange(item.id, { amount: Number(event.target.value) || 0 })} placeholder="0.00" /><Button type="button" size="icon" variant="ghost" aria-label={`Remove ${item.label || "row"}`} onClick={() => onRemove(item.id)}><Trash2 /></Button></div>)}</div>
    </div>
  )
}
