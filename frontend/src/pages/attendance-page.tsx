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
import { downloadAttendanceExcel, downloadAttendancePdf, type AttendanceExportInput } from "@/lib/attendance-export"
import { freeAllowanceError, getFreeDocumentAllowance } from "@/lib/free-document-allowance"
import { type AttendanceDayRecord, type AttendanceDayStatus, type LeavePolicy, type PayrollComponent, type Payslip, type PayslipAttendance, useMvpStore } from "@/lib/mvp-store"
import { calculateLeaveAdjustedAttendance, calculatePayslipAttendance, cleanPayslipFileName, defaultPayslipAttendance, formatSalaryMonth, payrollId, sumPayrollComponents } from "@/lib/payslip-calculations"
import { createPayslipPdfFile } from "@/lib/payslip-pdf"
import { downloadZip } from "@/lib/zip-download"
import { useWorkspaceAccess } from "@/lib/workspace-access"

type AttendanceException = Pick<PayslipAttendance, "halfDays" | "paidLeaveDays" | "unpaidLeaveDays"> & { dailyRecords?: AttendanceDayRecord[] }
type AttendanceMode = "daily" | "monthly"
type PreparedPayslip = Omit<Payslip, "id">

const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
const currentMonth = () => new Date().toISOString().slice(0, 7)
const firstDateForMonth = (month: string) => `${month}-${new Date().toISOString().startsWith(month) ? new Date().toISOString().slice(8, 10) : "01"}`
const lastDateForMonth = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number)
  return `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}`
}
const leaveDeductionLabel = "Loss of pay (attendance)"
const normalizedLabel = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")
const cloneComponents = (items: PayrollComponent[]) => items.map((item) => ({ ...item, id: payrollId() }))
const blankAttendanceException = (daily = false): AttendanceException => ({ halfDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, ...(daily ? { dailyRecords: [] } : {}) })
const exceptionsFromRecords = (records: Record<string, AttendanceDayRecord[]> = {}) => Object.fromEntries(Object.entries(records).map(([employeeId, dailyRecords]) => [employeeId, { ...blankAttendanceException(true), dailyRecords }]))

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
  const { setup, companies, employees, invoices, payslips, template, addPayslips, updateEmployee, saveAttendanceDraft } = useMvpStore()
  const { can, subscription, creditAccount, refresh } = useWorkspaceAccess()
  const canManage = can("payslips.manage")
  const payslipAllowance = getFreeDocumentAllowance(setup, subscription, creditAccount, "payslip", invoices.length + payslips.length)
  const initialEntityId = companies[0]?.id || ""
  const initialMonth = currentMonth()
  const initialDraft = setup?.attendanceDrafts?.[`${initialEntityId}:${initialMonth}`]
  const [selectedEntityId, setSelectedEntityId] = useState(initialEntityId)
  const [month, setMonth] = useState(initialMonth)
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode>("daily")
  const [attendanceDate, setAttendanceDate] = useState(() => firstDateForMonth(currentMonth()))
  const [attendance, setAttendance] = useState<PayslipAttendance>(() => initialDraft?.attendance || defaultPayslipAttendance(initialMonth))
  const [employeeAttendance, setEmployeeAttendance] = useState<Record<string, AttendanceException>>(() => exceptionsFromRecords(initialDraft?.employeeRecords))
  const [excludedEmployeeIds, setExcludedEmployeeIds] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [preview, setPreview] = useState<PreparedPayslip[]>([])
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [savingAttendance, setSavingAttendance] = useState(false)
  const [exportingAttendance, setExportingAttendance] = useState<"excel" | "pdf" | null>(null)
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
  const calendarSummary = useMemo(() => calculatePayslipAttendance(month, attendance), [attendance, month])
  const weeklyOffDates = useMemo(() => {
    const dates = new Set<string>()
    for (let day = 1; day <= calendarSummary.attendance.calendarDays; day += 1) {
      const date = new Date(`${month}-${String(day).padStart(2, "0")}T00:00:00`)
      if ((date.getDay() === 6 && attendance.saturdayWeeklyOff) || (date.getDay() === 0 && attendance.sundayWeeklyOff)) dates.add(`${month}-${String(day).padStart(2, "0")}`)
    }
    return dates
  }, [attendance.saturdayWeeklyOff, attendance.sundayWeeklyOff, calendarSummary.attendance.calendarDays, month])
  const holidayDates = useMemo(() => new Set(attendance.holidays.map((holiday) => holiday.date)), [attendance.holidays])
  const selectedDateHoliday = attendance.holidays.find((holiday) => holiday.date === attendanceDate)
  const selectedDateIsWeeklyOff = weeklyOffDates.has(attendanceDate)
  const selectedDateIsWorking = Boolean(attendanceDate) && !selectedDateIsWeeklyOff && !holidayDates.has(attendanceDate)

  const clearMessages = () => { setNotice(""); setError("") }
  const resetPreview = () => { setPreview([]); setSaved(false) }
  const leaveUsedBefore = (employeeId: string) => {
    if (!leavePolicy) return 0
    return payslips
      .filter((payslip) => payslip.employeeId === employeeId && (leavePolicy.period === "monthly" ? payslip.month === month : payslip.month.startsWith(month.slice(0, 4)) && payslip.month < month))
      .reduce((total, payslip) => total + (payslip.attendance?.paidLeaveDays || 0), 0)
  }
  const changeEntity = (entityId: string) => {
    const draft = setup?.attendanceDrafts?.[`${entityId}:${month}`]
    setSelectedEntityId(entityId)
    setAttendance(draft?.attendance || defaultPayslipAttendance(month))
    setEmployeeAttendance(exceptionsFromRecords(draft?.employeeRecords))
    setExcludedEmployeeIds([])
    setSearch("")
    resetPreview()
    clearMessages()
  }
  const changeMonth = (nextMonth: string) => {
    const draft = setup?.attendanceDrafts?.[`${selectedEntityId}:${nextMonth}`]
    setMonth(nextMonth)
    setAttendanceDate(firstDateForMonth(nextMonth))
    setAttendance(draft?.attendance || defaultPayslipAttendance(nextMonth))
    setEmployeeAttendance(exceptionsFromRecords(draft?.employeeRecords))
    setExcludedEmployeeIds([])
    resetPreview()
    clearMessages()
  }
  const updateEmployeeAttendance = (employeeId: string, field: "halfDays" | "paidLeaveDays" | "unpaidLeaveDays", value: number) => {
    setEmployeeAttendance((current) => ({
      ...current,
      [employeeId]: { ...(current[employeeId] || blankAttendanceException()), [field]: Math.max(0, value || 0) },
    }))
    resetPreview()
  }
  const setDailyStatus = (employeeId: string, date: string, status: AttendanceDayStatus | "") => {
    setEmployeeAttendance((current) => {
      const existing = current[employeeId] || blankAttendanceException(true)
      const records = (existing.dailyRecords || []).filter((record) => record.date !== date)
      if (status) records.push({ date, status })
      return { ...current, [employeeId]: { ...existing, dailyRecords: records.sort((left, right) => left.date.localeCompare(right.date)) } }
    })
    resetPreview()
  }
  const markShownForDate = (status: AttendanceDayStatus | "") => {
    if (!selectedDateIsWorking) return
    const employeesToMark = visibleEmployees.filter((employee) => !existingEmployeeIds.has(employee.id) && !excludedEmployeeIds.includes(employee.id))
    setEmployeeAttendance((current) => {
      const next = { ...current }
      for (const employee of employeesToMark) {
        const existing = next[employee.id] || blankAttendanceException(true)
        const records = (existing.dailyRecords || []).filter((record) => record.date !== attendanceDate)
        if (status) records.push({ date: attendanceDate, status })
        next[employee.id] = { ...existing, dailyRecords: records.sort((left, right) => left.date.localeCompare(right.date)) }
      }
      return next
    })
    resetPreview()
  }
  const validDailyRecordCount = (employeeId: string) => new Set((employeeAttendance[employeeId]?.dailyRecords || [])
    .filter((record) => record.date.startsWith(`${month}-`) && !weeklyOffDates.has(record.date) && !holidayDates.has(record.date))
    .map((record) => record.date)).size
  const dailyStatusFor = (employeeId: string, date: string) => employeeAttendance[employeeId]?.dailyRecords?.find((record) => record.date === date)?.status || ""
  const attendanceForEmployee = (employeeId: string): Partial<PayslipAttendance> => {
    const exception = employeeAttendance[employeeId] || blankAttendanceException(attendanceMode === "daily")
    return attendanceMode === "daily"
      ? { ...attendance, dailyRecords: exception.dailyRecords || [] }
      : { ...attendance, halfDays: exception.halfDays, paidLeaveDays: exception.paidLeaveDays, unpaidLeaveDays: exception.unpaidLeaveDays, dailyRecords: undefined }
  }
  const saveDailyAttendance = async () => {
    if (!selectedEntityId) return
    setSavingAttendance(true)
    clearMessages()
    try {
      await saveAttendanceDraft({
        entityId: selectedEntityId,
        month,
        attendance,
        employeeRecords: Object.fromEntries(Object.entries(employeeAttendance).map(([employeeId, exception]) => [employeeId, exception.dailyRecords || []])),
        updatedAt: new Date().toISOString(),
      })
      setNotice(`Daily attendance for ${formatSalaryMonth(month)} was saved to your workspace.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Daily attendance could not be saved.")
    } finally {
      setSavingAttendance(false)
    }
  }
  const attendanceExportInput = (): AttendanceExportInput | null => {
    if (!selectedEntity) return null
    const rows = entityEmployees.map((employee) => {
      const savedPayslip = payslips.find((payslip) => payslip.entityId === selectedEntityId && payslip.employeeId === employee.id && payslip.month === month)
      if (savedPayslip?.attendance) return {
        employeeName: employee.employeeName,
        employeeCode: employee.employeeCode,
        designation: employee.designation,
        department: employee.department,
        dailyRecords: savedPayslip.attendance.dailyRecords || employeeAttendance[employee.id]?.dailyRecords || [],
        attendance: savedPayslip.attendance,
        workingDays: savedPayslip.workingDays,
        payableDays: savedPayslip.payableDays,
        deductionAmount: savedPayslip.attendance.leaveDeductionAmount || 0,
      }
      const grossPay = sumPayrollComponents(employee.defaultEarnings)
      const estimate = calculateLeaveAdjustedAttendance({ month, attendance: attendanceForEmployee(employee.id), policy: leavePolicy, leaveUsedBefore: leaveUsedBefore(employee.id), grossPay })
      return {
        employeeName: employee.employeeName,
        employeeCode: employee.employeeCode,
        designation: employee.designation,
        department: employee.department,
        dailyRecords: estimate.attendance.dailyRecords || [],
        attendance: estimate.attendance,
        workingDays: estimate.workingDays,
        payableDays: estimate.payableDays,
        deductionAmount: estimate.leaveDeductionAmount,
      }
    })
    return { entity: selectedEntity, month, calendar: attendance, rows }
  }
  const downloadAttendanceCopy = async (format: "excel" | "pdf") => {
    const exportInput = attendanceExportInput()
    if (!exportInput) { setError("Select an entity before downloading attendance."); return }
    setExportingAttendance(format)
    clearMessages()
    try {
      if (format === "excel") await downloadAttendanceExcel(exportInput)
      else await downloadAttendancePdf(exportInput)
      setNotice(`${format === "excel" ? "Excel" : "PDF"} attendance copy downloaded for ${formatSalaryMonth(month)}.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `The attendance ${format.toUpperCase()} could not be created.`)
    } finally {
      setExportingAttendance(null)
    }
  }

  const preparePayslips = () => {
    clearMessages()
    resetPreview()
    if (!/^\d{4}-\d{2}$/.test(month)) { setError("Select a valid attendance month."); return }
    const selectedEmployees = eligibleEmployees.filter((employee) => !excludedEmployeeIds.includes(employee.id))
    if (!selectedEmployees.length) { setError("Select at least one employee who does not already have a payslip for this month."); return }
    if (attendanceMode === "daily") {
      const incomplete = selectedEmployees
        .map((employee) => ({ name: employee.employeeName, missing: calendarSummary.workingDays - validDailyRecordCount(employee.id) }))
        .filter((employee) => employee.missing > 0)
      if (incomplete.length) {
        const examples = incomplete.slice(0, 3).map((employee) => `${employee.name} (${employee.missing} unmarked)`).join(", ")
        setError(`Complete daily attendance before generating payslips. ${examples}${incomplete.length > 3 ? ` and ${incomplete.length - 3} more` : ""}.`)
        return
      }
    }
    const skipped: string[] = []
    const prepared = selectedEmployees.flatMap((employee): PreparedPayslip[] => {
      const earnings = cloneComponents(employee.defaultEarnings).filter((item) => item.label.trim() && item.amount > 0)
      const deductions = cloneComponents(employee.defaultDeductions).filter((item) => item.label.trim() && item.amount > 0)
      const grossPay = sumPayrollComponents(earnings)
      if (grossPay <= 0 || sumPayrollComponents(deductions) > grossPay) { skipped.push(employee.employeeName); return [] }
      const storedException = employeeAttendance[employee.id] || blankAttendanceException(attendanceMode === "daily")
      const exception: AttendanceException = attendanceMode === "daily"
        ? { halfDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, dailyRecords: storedException.dailyRecords || [] }
        : { halfDays: storedException.halfDays, paidLeaveDays: storedException.paidLeaveDays, unpaidLeaveDays: storedException.unpaidLeaveDays }
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
    const allowanceError = freeAllowanceError(payslipAllowance, preview.length)
    if (allowanceError) {
      setError(allowanceError)
      return
    }
    setSaving(true)
    clearMessages()
    try {
      await addPayslips(preview)
      await refresh()
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
        actions={<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={Boolean(exportingAttendance)} onClick={() => void downloadAttendanceCopy("excel")}><FileSpreadsheet />{exportingAttendance === "excel" ? "Preparing Excel…" : "Download Excel"}</Button><Button variant="outline" disabled={Boolean(exportingAttendance)} onClick={() => void downloadAttendanceCopy("pdf")}><Download />{exportingAttendance === "pdf" ? "Preparing PDF…" : "Download PDF"}</Button><Button variant="outline" asChild><Link to="/employees"><Users />Employees & payslips</Link></Button></div>}
      />

      {payslipAllowance ? <p className={`rounded-lg border p-3 text-sm ${payslipAllowance.remaining === 0 ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" : "bg-muted/40 text-muted-foreground"}`}><strong className="text-foreground">Document credits:</strong> {payslipAllowance.remaining} remaining for invoices or payslips. Quotations use a separate balance. {payslipAllowance.gstStatus === "verified" ? "GSTIN verified." : payslipAllowance.gstStatus === "provisional" ? "GSTIN verification pending; verification unlocks additional free credits." : "Non-GST workspace."}</p> : null}

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
        <CardHeader><CardTitle>How do you want to record attendance?</CardTitle><CardDescription>Use daily marking for an HR-managed register, or monthly totals for faster payroll entry.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button type="button" variant={attendanceMode === "daily" ? "default" : "outline"} className="h-auto justify-start p-4 text-left" onClick={() => { setAttendanceMode("daily"); resetPreview(); clearMessages() }}>
              <span><span className="block font-semibold">Daily marking</span><span className="mt-1 block text-xs opacity-75">HR marks every employee as present, half-day, paid leave, or absent.</span></span>
            </Button>
            <Button type="button" variant={attendanceMode === "monthly" ? "default" : "outline"} className="h-auto justify-start p-4 text-left" onClick={() => { setAttendanceMode("monthly"); resetPreview(); clearMessages() }}>
              <span><span className="block font-semibold">Monthly totals</span><span className="mt-1 block text-xs opacity-75">Enter total half-days and leave directly for each employee.</span></span>
            </Button>
          </div>

          {attendanceMode === "daily" ? <div className="space-y-4 rounded-lg border p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2"><Label htmlFor="daily-attendance-date">Attendance date</Label><Input id="daily-attendance-date" className="w-full sm:w-56" type="date" min={`${month}-01`} max={lastDateForMonth(month)} value={attendanceDate} onChange={(event) => { setAttendanceDate(event.target.value); clearMessages() }} /></div>
              {canManage ? <div className="flex flex-wrap gap-2">{selectedDateIsWorking ? <><Button type="button" variant="outline" onClick={() => markShownForDate("")}>Clear shown date</Button><Button type="button" variant="outline" onClick={() => markShownForDate("present")}><CalendarCheck2 />Mark all shown present</Button></> : null}<Button type="button" disabled={savingAttendance} onClick={() => void saveDailyAttendance()}>{savingAttendance ? "Saving attendance…" : "Save attendance"}</Button></div> : null}
            </div>
            {!selectedDateIsWorking ? <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{selectedDateHoliday ? `${selectedDateHoliday.name} is a public holiday.` : selectedDateIsWeeklyOff ? "This date is a weekly off." : "Select a date within the attendance month."} No employee marking is required.</p> : null}
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead className="w-64">Status for {attendanceDate}</TableHead><TableHead>Month marked</TableHead></TableRow></TableHeader>
                <TableBody>{visibleEmployees.length ? visibleEmployees.map((employee) => {
                  const alreadyExists = existingEmployeeIds.has(employee.id)
                  const checked = !alreadyExists && !excludedEmployeeIds.includes(employee.id)
                  const marked = validDailyRecordCount(employee.id)
                  return <TableRow key={`daily-${employee.id}`} className={alreadyExists || !checked ? "opacity-60" : undefined}>
                    <TableCell><p className="font-medium">{employee.employeeName}</p><p className="text-xs text-muted-foreground">{employee.employeeCode}</p></TableCell>
                    <TableCell>{selectedDateIsWorking ? <select aria-label={`Attendance status for ${employee.employeeName}`} className={selectClass} disabled={!canManage || !checked} value={dailyStatusFor(employee.id, attendanceDate)} onChange={(event) => setDailyStatus(employee.id, attendanceDate, event.target.value as AttendanceDayStatus | "")}><option value="">Not marked</option><option value="present">Present</option><option value="half_day">Half-day</option><option value="paid_leave">Paid leave</option><option value="unpaid_leave">Absent / unpaid leave</option></select> : <Badge variant="secondary">No marking required</Badge>}</TableCell>
                    <TableCell><span className={marked === calendarSummary.workingDays ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>{marked} / {calendarSummary.workingDays}</span>{alreadyExists ? <p className="text-xs text-muted-foreground">Payslip exists</p> : null}</TableCell>
                  </TableRow>
                }) : <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">No employees match this search.</TableCell></TableRow>}</TableBody>
              </Table>
            </div>
          </div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Employee attendance register</CardTitle><CardDescription>{attendanceMode === "daily" ? "Present days and leave are calculated automatically from HR's daily markings." : "Present days are calculated automatically from working days after half-days and leave are entered."}</CardDescription></CardHeader>
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
              <TableHeader><TableRow><TableHead className="w-12">Use</TableHead><TableHead>Employee</TableHead><TableHead>Present days</TableHead><TableHead>Half days</TableHead><TableHead>Leave taken</TableHead><TableHead>Unpaid leave</TableHead><TableHead>Excess leave</TableHead><TableHead>LOP deduction</TableHead><TableHead>Estimated net</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{visibleEmployees.length ? visibleEmployees.map((employee) => {
                const alreadyExists = existingEmployeeIds.has(employee.id)
                const checked = !alreadyExists && !excludedEmployeeIds.includes(employee.id)
                const exception = employeeAttendance[employee.id] || blankAttendanceException(attendanceMode === "daily")
                const grossPay = sumPayrollComponents(employee.defaultEarnings)
                const standardDeductions = sumPayrollComponents(withoutLeaveDeduction(employee.defaultDeductions))
                const estimate = calculateLeaveAdjustedAttendance({ month, attendance: attendanceForEmployee(employee.id), policy: leavePolicy, leaveUsedBefore: leaveUsedBefore(employee.id), grossPay })
                const estimatedNet = grossPay - standardDeductions - estimate.leaveDeductionAmount
                const unmarkedDays = Math.max(0, calendarSummary.workingDays - validDailyRecordCount(employee.id))
                return <TableRow key={employee.id} className={alreadyExists ? "opacity-60" : undefined}>
                  <TableCell><input type="checkbox" aria-label={`Include ${employee.employeeName}`} disabled={!canManage || alreadyExists} checked={checked} onChange={(event) => { setExcludedEmployeeIds((current) => event.target.checked ? current.filter((id) => id !== employee.id) : [...new Set([...current, employee.id])]); resetPreview() }} /></TableCell>
                  <TableCell><p className="font-medium">{employee.employeeName}</p><p className="text-xs text-muted-foreground">{employee.employeeCode}{employee.department ? ` · ${employee.department}` : ""}</p></TableCell>
                  <TableCell><span className="inline-flex min-w-14 justify-center rounded-md bg-muted px-2 py-1 font-medium">{estimate.attendance.fullPresentDays}</span></TableCell>
                  <TableCell>{attendanceMode === "daily" ? estimate.attendance.halfDays : <Input className="w-24" aria-label={`Half days for ${employee.employeeName}`} disabled={!canManage || !checked} type="number" min="0" step="1" value={exception.halfDays || ""} onChange={(event) => updateEmployeeAttendance(employee.id, "halfDays", Number(event.target.value))} placeholder="0" />}</TableCell>
                  <TableCell>{attendanceMode === "daily" ? estimate.attendance.paidLeaveDays : <Input className="w-24" aria-label={`Leave taken for ${employee.employeeName}`} disabled={!canManage || !checked} type="number" min="0" step="0.5" value={exception.paidLeaveDays || ""} onChange={(event) => updateEmployeeAttendance(employee.id, "paidLeaveDays", Number(event.target.value))} placeholder="0" />}</TableCell>
                  <TableCell>{attendanceMode === "daily" ? estimate.attendance.unpaidLeaveDays : <Input className="w-24" aria-label={`Unpaid leave for ${employee.employeeName}`} disabled={!canManage || !checked} type="number" min="0" step="0.5" value={exception.unpaidLeaveDays || ""} onChange={(event) => updateEmployeeAttendance(employee.id, "unpaidLeaveDays", Number(event.target.value))} placeholder="0" />}</TableCell>
                  <TableCell>{estimate.attendance.excessLeaveDays || 0}</TableCell>
                  <TableCell className="text-red-600">₹{estimate.leaveDeductionAmount.toLocaleString("en-IN")}</TableCell>
                  <TableCell className="font-medium">₹{estimatedNet.toLocaleString("en-IN")}</TableCell>
                  <TableCell>{alreadyExists ? <Badge variant="secondary">Payslip exists</Badge> : attendanceMode === "daily" && unmarkedDays > 0 ? <Badge variant="secondary">{unmarkedDays} unmarked</Badge> : grossPay > 0 && estimatedNet >= 0 ? <Badge variant="outline">Ready</Badge> : <Badge variant="destructive">Salary required</Badge>}</TableCell>
                </TableRow>
              }) : <TableRow><TableCell colSpan={10} className="h-32 text-center text-muted-foreground">{entityEmployees.length ? "No employees match this search." : "No employees have been added to this entity."}</TableCell></TableRow>}</TableBody>
            </Table>
          </div>
          {canManage ? <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">Review the deductions above before creating payslips.</p><Button disabled={!selectedCount} onClick={preparePayslips}><FileSpreadsheet />Preview {selectedCount || ""} payslips</Button></div> : null}
        </CardContent>
      </Card>

      {preview.length ? <Card>
        <CardHeader><CardTitle>Payslip preview</CardTitle><CardDescription>These payslips use the attendance entered above. Generate to save them to the Employees page.</CardDescription></CardHeader>
        <CardContent>
          <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Present days</TableHead><TableHead>Payable days</TableHead><TableHead>Gross</TableHead><TableHead>Attendance deduction</TableHead><TableHead>Total deductions</TableHead><TableHead>Net pay</TableHead></TableRow></TableHeader><TableBody>{preview.map((payslip) => <TableRow key={`${payslip.employeeId}-${payslip.month}`}><TableCell className="font-medium">{payslip.employeeName}</TableCell><TableCell>{payslip.attendance?.fullPresentDays ?? "—"}</TableCell><TableCell>{payslip.payableDays}</TableCell><TableCell>₹{payslip.grossPay.toLocaleString("en-IN")}</TableCell><TableCell className="text-red-600">₹{(payslip.attendance?.leaveDeductionAmount || 0).toLocaleString("en-IN")}</TableCell><TableCell>₹{payslip.totalDeductions.toLocaleString("en-IN")}</TableCell><TableCell className="font-semibold">₹{payslip.netPay.toLocaleString("en-IN")}</TableCell></TableRow>)}</TableBody></Table>
          <div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => { setPreview([]); setSaved(false) }}>{saved ? "Close" : "Cancel"}</Button><Button variant="outline" disabled={downloading || saving} onClick={() => void downloadPayslips()}><Download />{downloading ? "Preparing ZIP…" : `Download ${preview.length} PDFs`}</Button><Button disabled={saved || saving} onClick={() => void savePayslips()}><CalendarCheck2 />{saving ? "Saving…" : saved ? "Payslips generated" : `Generate ${preview.length} payslips`}</Button></div>
        </CardContent>
      </Card> : null}
    </div>
  )
}
