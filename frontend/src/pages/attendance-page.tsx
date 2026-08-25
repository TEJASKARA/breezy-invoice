import { useMemo, useState } from "react"
import { CalendarCheck2, Download, FileSpreadsheet, Settings2, Users } from "lucide-react"
import { Link } from "react-router-dom"

import { AttendanceEditor } from "@/components/attendance-editor"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type LeavePolicy, type PayrollComponent, type Payslip, type PayslipAttendance, useMvpStore } from "@/lib/mvp-store"
import { calculateLeaveAdjustedAttendance, cleanPayslipFileName, defaultPayslipAttendance, formatSalaryMonth, payrollId, sumPayrollComponents } from "@/lib/payslip-calculations"
import { createPayslipPdfFile } from "@/lib/payslip-pdf"
import { downloadZip } from "@/lib/zip-download"
import { useWorkspaceAccess } from "@/lib/workspace-access"

type AttendanceException = Pick<PayslipAttendance, "halfDays" | "paidLeaveDays" | "unpaidLeaveDays">
type PreparedPayslip = Omit<Payslip, "id">

const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
const currentMonth = () => new Date().toISOString().slice(0, 7)
const leaveDeductionLabel = "Loss of pay (attendance)"
const normalizedLabel = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")
const cloneComponents = (items: PayrollComponent[]) => items.map((item) => ({ ...item, id: payrollId() }))
const blankAttendanceException = (): AttendanceException => ({ halfDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0 })

function withoutLeaveDeduction(items: PayrollComponent[]) {
  return items.filter((item) => normalizedLabel(item.label) !== normalizedLabel(leaveDeductionLabel))
}

function applyAttendance<T extends { month: string; earnings: PayrollComponent[]; deductions: PayrollComponent[] }>(draft: T, attendance: Partial<PayslipAttendance>, policy: LeavePolicy | undefined, leaveUsedBefore: number) {
  const grossPay = sumPayrollComponents(draft.earnings)
  const calculated = calculateLeaveAdjustedAttendance({ month: draft.month, attendance, policy, leaveUsedBefore, grossPay })
  const deductions = withoutLeaveDeduction(draft.deductions)
  if (calculated.leaveDeductionAmount > 0) deductions.push({ id: payrollId(), label: leaveDeductionLabel, amount: calculated.leaveDeductionAmount })
  const totalDeductions = sumPayrollComponents(deductions)
  return { ...draft, deductions, grossPay, totalDeductions, netPay: grossPay - totalDeductions, attendance: calculated.attendance, workingDays: calculated.workingDays, payableDays: calculated.payableDays }
}

export function AttendancePage() {
  const { setup, companies, employees, payslips, template, addPayslips, updateEmployee } = useMvpStore()
  const { can } = useWorkspaceAccess()
  const canManage = can("payslips.manage")
  const [selectedEntityId, setSelectedEntityId] = useState(companies[0]?.id || "")
  const [month, setMonth] = useState(currentMonth())
  const [attendance, setAttendance] = useState<PayslipAttendance>(() => defaultPayslipAttendance(currentMonth()))
  const [employeeAttendance, setEmployeeAttendance] = useState<Record<string, AttendanceException>>({})
  const [excludedEmployeeIds, setExcludedEmployeeIds] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [preview, setPreview] = useState<PreparedPayslip[]>([])
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const selectedEntity = companies.find((company) => company.id === selectedEntityId)
  const entityEmployees = useMemo(() => employees.filter((employee) => employee.entityId === selectedEntityId), [employees, selectedEntityId])
  const existingEmployeeIds = useMemo(() => new Set(payslips.filter((payslip) => payslip.entityId === selectedEntityId && payslip.month === month).map((payslip) => payslip.employeeId)), [payslips, selectedEntityId, month])
  const eligibleEmployees = useMemo(() => entityEmployees.filter((employee) => !existingEmployeeIds.has(employee.id)), [entityEmployees, existingEmployeeIds])
  const selectedCount = eligibleEmployees.filter((employee) => !excludedEmployeeIds.includes(employee.id)).length
  const normalizedSearch = search.trim().toLowerCase()
  const visibleEmployees = useMemo(() => normalizedSearch
    ? entityEmployees.filter((employee) => [employee.employeeName, employee.employeeCode, employee.designation, employee.department].some((value) => value.toLowerCase().includes(normalizedSearch)))
    : entityEmployees, [entityEmployees, normalizedSearch])
  const leavePolicy = setup?.leavePolicy

  const clearMessages = () => { setNotice(""); setError("") }
  const resetPreview = () => { setPreview([]); setSaved(false) }
  const leaveUsedBefore = (employeeId: string) => {
    if (!leavePolicy) return 0
    return payslips
      .filter((payslip) => payslip.employeeId === employeeId && (leavePolicy.period === "monthly" ? payslip.month === month : payslip.month.startsWith(month.slice(0, 4)) && payslip.month < month))
      .reduce((total, payslip) => total + (payslip.attendance?.paidLeaveDays || 0), 0)
  }
  const changeEntity = (entityId: string) => {
    setSelectedEntityId(entityId)
    setEmployeeAttendance({})
    setExcludedEmployeeIds([])
    setSearch("")
    resetPreview()
    clearMessages()
  }
  const changeMonth = (nextMonth: string) => {
    setMonth(nextMonth)
    setAttendance(defaultPayslipAttendance(nextMonth))
    setEmployeeAttendance({})
    setExcludedEmployeeIds([])
    resetPreview()
    clearMessages()
  }
  const updateEmployeeAttendance = (employeeId: string, field: keyof AttendanceException, value: number) => {
    setEmployeeAttendance((current) => ({
      ...current,
      [employeeId]: { ...(current[employeeId] || blankAttendanceException()), [field]: Math.max(0, value || 0) },
    }))
    resetPreview()
  }

  const preparePayslips = () => {
    clearMessages()
    resetPreview()
    if (!/^\d{4}-\d{2}$/.test(month)) { setError("Select a valid attendance month."); return }
    const selectedEmployees = eligibleEmployees.filter((employee) => !excludedEmployeeIds.includes(employee.id))
    if (!selectedEmployees.length) { setError("Select at least one employee who does not already have a payslip for this month."); return }
    const skipped: string[] = []
    const prepared = selectedEmployees.flatMap((employee): PreparedPayslip[] => {
      const earnings = cloneComponents(employee.defaultEarnings).filter((item) => item.label.trim() && item.amount > 0)
      const deductions = cloneComponents(employee.defaultDeductions).filter((item) => item.label.trim() && item.amount > 0)
      const grossPay = sumPayrollComponents(earnings)
      if (grossPay <= 0 || sumPayrollComponents(deductions) > grossPay) { skipped.push(employee.employeeName); return [] }
      const exception = employeeAttendance[employee.id] || blankAttendanceException()
      return [applyAttendance({
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
        paymentDate: "",
        earnings,
        deductions,
        grossPay,
        totalDeductions: sumPayrollComponents(deductions),
        netPay: grossPay - sumPayrollComponents(deductions),
        status: "Generated" as const,
        generatedAt: new Date().toISOString(),
      }, { ...attendance, ...exception }, leavePolicy, leaveUsedBefore(employee.id))]
    })
    if (!prepared.length) { setError("The selected employees do not have a valid saved salary. Add earnings to their employee profiles first."); return }
    setPreview(prepared)
    setNotice(`${prepared.length} payslip${prepared.length === 1 ? " is" : "s are"} ready.${skipped.length ? ` ${skipped.length} employee${skipped.length === 1 ? " was" : "s were"} skipped because the saved salary is invalid.` : ""}`)
  }

  const savePayslips = async () => {
    if (!preview.length || saved) return
    setSaving(true)
    clearMessages()
    try {
      await addPayslips(preview)
      await Promise.all(preview.map((item) => updateEmployee(item.employeeId, {
        defaultEarnings: cloneComponents(item.earnings),
        defaultDeductions: cloneComponents(withoutLeaveDeduction(item.deductions)),
      })))
      setSaved(true)
      setNotice(`${preview.length} payslip${preview.length === 1 ? " was" : "s were"} generated and saved from this attendance register.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payslips could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  const downloadPayslips = async () => {
    if (!selectedEntity || !preview.length) return
    setDownloading(true)
    clearMessages()
    try {
      const files = []
      for (const [index, item] of preview.entries()) files.push(await createPayslipPdfFile({ payslip: { ...item, id: `attendance-payslip-${index}` }, entity: selectedEntity, template }))
      downloadZip(files, `Payslips_${cleanPayslipFileName(selectedEntity.companyName)}_${cleanPayslipFileName(month)}.zip`)
      setNotice(`${files.length} payslip PDFs downloaded in one ZIP folder.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payslip ZIP could not be created.")
    } finally {
      setDownloading(false)
    }
  }

  if (!companies.length) return <Card><CardHeader><CardTitle>Add an entity first</CardTitle><CardDescription>Attendance is recorded for employees within an entity.</CardDescription></CardHeader><CardContent><Button asChild><Link to="/entities">Go to entities</Link></Button></CardContent></Card>

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Payroll"
        title="Attendance"
        description="Maintain monthly attendance for every employee and generate leave-adjusted payslips from one register."
        actions={<Button variant="outline" asChild><Link to="/employees"><Users />Employees & payslips</Link></Button>}
      />

      {!canManage ? <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">You have view-only payroll access. Attendance changes and payslip generation require payroll management permission.</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{notice}</p> : null}

      <Card>
        <CardHeader><CardTitle>Attendance period</CardTitle><CardDescription>Select the employing entity and salary month before recording attendance.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3 md:items-end">
          <div className="space-y-2"><Label htmlFor="attendance-entity">Entity</Label><select id="attendance-entity" className={selectClass} value={selectedEntityId} onChange={(event) => changeEntity(event.target.value)}>{companies.map((company) => <option key={company.id} value={company.id}>{company.companyName}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="attendance-month">Month</Label><Input id="attendance-month" type="month" value={month} onChange={(event) => changeMonth(event.target.value)} /></div>
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm"><p className="font-medium">Leave policy: <span className="capitalize">{leavePolicy?.period || "not configured"}</span>{leavePolicy ? ` · ${leavePolicy.allowanceDays} paid leave day${leavePolicy.allowanceDays === 1 ? "" : "s"}` : ""}</p><Button className="mt-1 h-auto p-0 text-xs" variant="link" asChild><Link to="/settings/workspace"><Settings2 />Change policy</Link></Button></div>
        </CardContent>
      </Card>

      <AttendanceEditor month={month} value={attendance} onChange={(next) => { setAttendance(next); resetPreview() }} showExceptions={false} title="Monthly work calendar" description="Set weekly offs and public holidays once; they apply to every employee in this register." />

      <Card>
        <CardHeader><CardTitle>Employee attendance register</CardTitle><CardDescription>Enter only exceptions such as half-days and leave. Present and payable days are calculated automatically.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <div className="space-y-4 border-b p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-medium">{selectedCount} of {eligibleEmployees.length} eligible employees selected</p><p className="text-sm text-muted-foreground">Employees with an existing {formatSalaryMonth(month)} payslip are locked.</p></div>
              {canManage ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { const ids = new Set(visibleEmployees.map((employee) => employee.id)); setExcludedEmployeeIds((current) => current.filter((id) => !ids.has(id))); resetPreview() }}>Select shown</Button><Button size="sm" variant="outline" onClick={() => { setExcludedEmployeeIds((current) => [...new Set([...current, ...visibleEmployees.map((employee) => employee.id)])]); resetPreview() }}>Deselect shown</Button></div> : null}
            </div>
            <Input aria-label="Search attendance employees" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employee name, code, designation, or department…" />
          </div>
          <div className="max-h-[520px] overflow-auto [content-visibility:auto]">
            <Table>
              <TableHeader><TableRow><TableHead className="w-12">Use</TableHead><TableHead>Employee</TableHead><TableHead>Half days</TableHead><TableHead>Leave taken</TableHead><TableHead>Unpaid leave</TableHead><TableHead>Excess leave</TableHead><TableHead>LOP deduction</TableHead><TableHead>Estimated net</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{visibleEmployees.length ? visibleEmployees.map((employee) => {
                const alreadyExists = existingEmployeeIds.has(employee.id)
                const checked = !alreadyExists && !excludedEmployeeIds.includes(employee.id)
                const exception = employeeAttendance[employee.id] || blankAttendanceException()
                const grossPay = sumPayrollComponents(employee.defaultEarnings)
                const standardDeductions = sumPayrollComponents(withoutLeaveDeduction(employee.defaultDeductions))
                const estimate = calculateLeaveAdjustedAttendance({ month, attendance: { ...attendance, ...exception }, policy: leavePolicy, leaveUsedBefore: leaveUsedBefore(employee.id), grossPay })
                const estimatedNet = grossPay - standardDeductions - estimate.leaveDeductionAmount
                return <TableRow key={employee.id} className={alreadyExists ? "opacity-60" : undefined}>
                  <TableCell><input type="checkbox" aria-label={`Include ${employee.employeeName}`} disabled={!canManage || alreadyExists} checked={checked} onChange={(event) => { setExcludedEmployeeIds((current) => event.target.checked ? current.filter((id) => id !== employee.id) : [...new Set([...current, employee.id])]); resetPreview() }} /></TableCell>
                  <TableCell><p className="font-medium">{employee.employeeName}</p><p className="text-xs text-muted-foreground">{employee.employeeCode}{employee.department ? ` · ${employee.department}` : ""}</p></TableCell>
                  <TableCell><Input className="w-24" aria-label={`Half days for ${employee.employeeName}`} disabled={!canManage || !checked} type="number" min="0" step="1" value={exception.halfDays || ""} onChange={(event) => updateEmployeeAttendance(employee.id, "halfDays", Number(event.target.value))} placeholder="0" /></TableCell>
                  <TableCell><Input className="w-24" aria-label={`Leave taken for ${employee.employeeName}`} disabled={!canManage || !checked} type="number" min="0" step="0.5" value={exception.paidLeaveDays || ""} onChange={(event) => updateEmployeeAttendance(employee.id, "paidLeaveDays", Number(event.target.value))} placeholder="0" /></TableCell>
                  <TableCell><Input className="w-24" aria-label={`Unpaid leave for ${employee.employeeName}`} disabled={!canManage || !checked} type="number" min="0" step="0.5" value={exception.unpaidLeaveDays || ""} onChange={(event) => updateEmployeeAttendance(employee.id, "unpaidLeaveDays", Number(event.target.value))} placeholder="0" /></TableCell>
                  <TableCell>{estimate.attendance.excessLeaveDays || 0}</TableCell>
                  <TableCell className="text-red-600">₹{estimate.leaveDeductionAmount.toLocaleString("en-IN")}</TableCell>
                  <TableCell className="font-medium">₹{estimatedNet.toLocaleString("en-IN")}</TableCell>
                  <TableCell>{alreadyExists ? <Badge variant="secondary">Payslip exists</Badge> : grossPay > 0 && estimatedNet >= 0 ? <Badge variant="outline">Ready</Badge> : <Badge variant="destructive">Salary required</Badge>}</TableCell>
                </TableRow>
              }) : <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">{entityEmployees.length ? "No employees match this search." : "No employees have been added to this entity."}</TableCell></TableRow>}</TableBody>
            </Table>
          </div>
          {canManage ? <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">Review the deductions above before creating payslips.</p><Button disabled={!selectedCount} onClick={preparePayslips}><FileSpreadsheet />Preview {selectedCount || ""} payslips</Button></div> : null}
        </CardContent>
      </Card>

      {preview.length ? <Card>
        <CardHeader><CardTitle>Payslip preview</CardTitle><CardDescription>These payslips use the attendance entered above. Generate to save them to the Employees page.</CardDescription></CardHeader>
        <CardContent>
          <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Payable days</TableHead><TableHead>Gross</TableHead><TableHead>Attendance deduction</TableHead><TableHead>Total deductions</TableHead><TableHead>Net pay</TableHead></TableRow></TableHeader><TableBody>{preview.map((payslip) => <TableRow key={`${payslip.employeeId}-${payslip.month}`}><TableCell className="font-medium">{payslip.employeeName}</TableCell><TableCell>{payslip.payableDays}</TableCell><TableCell>₹{payslip.grossPay.toLocaleString("en-IN")}</TableCell><TableCell className="text-red-600">₹{(payslip.attendance?.leaveDeductionAmount || 0).toLocaleString("en-IN")}</TableCell><TableCell>₹{payslip.totalDeductions.toLocaleString("en-IN")}</TableCell><TableCell className="font-semibold">₹{payslip.netPay.toLocaleString("en-IN")}</TableCell></TableRow>)}</TableBody></Table>
          <div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => { setPreview([]); setSaved(false) }}>{saved ? "Close" : "Cancel"}</Button><Button variant="outline" disabled={downloading || saving} onClick={() => void downloadPayslips()}><Download />{downloading ? "Preparing ZIP…" : `Download ${preview.length} PDFs`}</Button><Button disabled={saved || saving} onClick={() => void savePayslips()}><CalendarCheck2 />{saving ? "Saving…" : saved ? "Payslips generated" : `Generate ${preview.length} payslips`}</Button></div>
        </CardContent>
      </Card> : null}
    </div>
  )
}
