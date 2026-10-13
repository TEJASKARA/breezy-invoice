import { useRef, useState } from "react"
import { CalendarCheck2, Check, Minus, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { AttendanceDayRecord, AttendanceDayStatus, Employee, PayslipAttendance } from "@/lib/mvp-store"
import { attendanceDayKind, attendanceMonthDates, attendanceMonthTotals, localAttendanceDate } from "@/lib/attendance-view"
import { formatSalaryMonth } from "@/lib/payslip-calculations"

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const labels = { present: "Present", half_day: "Half-day", unpaid_leave: "Absent / unpaid leave", paid_leave: "Paid leave", weekly_off: "Weekly off", holiday: "Holiday", unmarked: "Not marked" }
const tones = {
  present: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  half_day: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  unpaid_leave: "bg-destructive/10 text-destructive",
  paid_leave: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  weekly_off: "bg-muted text-muted-foreground", holiday: "bg-primary/10 text-primary", unmarked: "text-muted-foreground",
}
type Kind = keyof typeof labels
function StatusMark({ kind }: { kind: Kind }) {
  return <span className={`inline-flex min-h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${tones[kind]}`} title={labels[kind]}>
    {kind === "present" ? <Check className="size-3.5" /> : kind === "unpaid_leave" ? <X className="size-3.5" /> : kind === "half_day" ? "½" : kind === "paid_leave" ? "L" : kind === "weekly_off" ? "WO" : kind === "holiday" ? "H" : <Minus className="size-3" />}
  </span>
}
type MonthData = { calendar: PayslipAttendance; records: Record<string, AttendanceDayRecord[]> }
type Props = {
  employees: Employee[]; month: string; date: string; search: string; canManage: boolean; saving: boolean;
  dataForMonth: (month: string) => MonthData;
  onMonth: (month: string) => void; onDate: (date: string) => void; onSearch: (search: string) => void;
  isLocked: (employeeId: string) => boolean;
  onSave: (employeeId: string, record: AttendanceDayRecord) => Promise<void>;
  onClear: (employeeId: string, date: string) => void;
  onSaveAll: () => void; onMarkAll: () => void;
}

export function AttendanceOverview(props: Props) {
  const { employees, month, date, canManage, saving, dataForMonth } = props
  const [entryEmployeeId, setEntryEmployeeId] = useState("")
  const [entryStatus, setEntryStatus] = useState<AttendanceDayStatus>("present")
  const [entryTime, setEntryTime] = useState(() => new Date().toTimeString().slice(0, 5))
  const [entryRemark, setEntryRemark] = useState("")
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("")
  const [employeeMonth, setEmployeeMonth] = useState(() => localAttendanceDate().slice(0, 7))
  const [dayFilter, setDayFilter] = useState("present")
  const [entryError, setEntryError] = useState("")
  const quickEntry = useRef<HTMLDivElement>(null)
  const employeeDetail = useRef<HTMLDivElement>(null)
  const data = dataForMonth(month)
  const dates = attendanceMonthDates(month)
  const visible = employees.filter((employee) => [employee.employeeName, employee.employeeCode, employee.department, employee.designation].some((value) => value?.toLowerCase().includes(props.search.trim().toLowerCase())))
  const kindFor = (id: string, onDate: string) => attendanceDayKind(onDate, data.records[id] || [], data.calendar)
  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId)
  const employeeData = dataForMonth(employeeMonth)
  const employeeRecords = employeeData.records[selectedEmployeeId] || []
  const dayEmployees = visible.filter((employee) => {
    const kind = kindFor(employee.id, date)
    return dayFilter === "all" || (dayFilter === "present" ? kind === "present" || kind === "half_day" : kind === dayFilter)
  })
  const logs = visible.flatMap((employee) => (data.records[employee.id] || [])
    .filter((record) => dates.includes(record.date))
    .map((record) => ({ employee, record }))).sort((a, b) => b.record.date.localeCompare(a.record.date) || (b.record.time || "").localeCompare(a.record.time || "") || a.employee.employeeName.localeCompare(b.employee.employeeName))
  const openEmployee = (id: string) => {
    setSelectedEmployeeId(id)
    setEmployeeMonth(localAttendanceDate().slice(0, 7))
    requestAnimationFrame(() => employeeDetail.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  const openDay = (id: string, onDate: string) => {
    props.onDate(onDate)
    setEntryEmployeeId(id)
    const record = data.records[id]?.find((item) => item.date === onDate)
    setEntryStatus(record?.status || "present")
    setEntryTime(record?.time || "")
    setEntryRemark(record?.remark || "")
    setEntryError("")
    quickEntry.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  const entryKind = kindFor(entryEmployeeId, date)
  const entryLocked = props.isLocked(entryEmployeeId)
  const nonWorking = entryKind === "weekly_off" || entryKind === "holiday"
  return <div className="space-y-7">
    {canManage ? <div ref={quickEntry} className="scroll-mt-24"><Card className="overflow-hidden">
      <CardHeader className="border-b bg-linear-to-r from-primary/10 via-muted/50 to-background"><CardTitle className="flex items-center gap-2"><CalendarCheck2 className="size-5" />Quick entry</CardTitle><CardDescription>Add or update one employee’s attendance. Time and remark are optional.</CardDescription></CardHeader>
      <CardContent><form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault(); setEntryError("")
        try { await props.onSave(entryEmployeeId, { date, status: entryStatus, ...(entryTime ? { time: entryTime } : {}), ...(entryRemark.trim() ? { remark: entryRemark.trim() } : {}) }) }
        catch { setEntryError("Attendance was not saved. Please try again.") }
      }}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2"><Label htmlFor="quick-attendance-employee">Employee</Label><select id="quick-attendance-employee" required className={selectClass} value={entryEmployeeId} onChange={(event) => { setEntryEmployeeId(event.target.value); setEntryError("") }}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeName} · {employee.employeeCode}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="quick-attendance-date">Date</Label><Input id="quick-attendance-date" required type="date" value={date} onChange={(event) => { if (event.target.value) props.onDate(event.target.value) }} /></div>
          <div className="space-y-2"><Label htmlFor="quick-attendance-time">Time</Label><Input id="quick-attendance-time" type="time" value={entryTime} onChange={(event) => setEntryTime(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="quick-attendance-status">Status</Label><select id="quick-attendance-status" className={selectClass} value={entryStatus} onChange={(event) => setEntryStatus(event.target.value as AttendanceDayStatus)}>{(["present", "half_day", "paid_leave", "unpaid_leave"] as const).map((kind) => <option key={kind} value={kind}>{labels[kind]}</option>)}</select></div>
        </div>
        <div className="max-w-lg space-y-2"><Label htmlFor="quick-attendance-remark">Remark</Label><Input id="quick-attendance-remark" maxLength={500} placeholder="Optional note" value={entryRemark} onChange={(event) => setEntryRemark(event.target.value)} /></div>
        {entryLocked ? <p className="text-sm text-muted-foreground">A payslip already exists for this employee and month. Its attendance is read-only.</p> : nonWorking ? <p className="text-sm text-muted-foreground">This is a {labels[entryKind].toLowerCase()}. No attendance marking is required.</p> : null}
        {entryError ? <p role="alert" className="text-sm text-destructive">{entryError}</p> : null}
        <Button disabled={!entryEmployeeId || saving || entryLocked || nonWorking} type="submit">{saving ? "Saving attendance…" : "Save attendance"}</Button>
      </form></CardContent>
    </Card></div> : null}

    <Card className="overflow-hidden"><CardHeader className="border-b bg-linear-to-r from-primary/10 via-muted/50 to-background">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><Users className="size-5" />Employees · monthly attendance</CardTitle><CardDescription className="mt-2">Click an employee for their month view. Click a day to review or mark it. Half-day counts as 0.5 present days.</CardDescription></div><div className="space-y-2"><Label htmlFor="grid-attendance-month">Month</Label><Input id="grid-attendance-month" type="month" value={month} onChange={(event) => { if (event.target.value) props.onMonth(event.target.value) }} /></div></div>
      <Input aria-label="Search attendance employees" placeholder="Search employee name, code, department…" value={props.search} onChange={(event) => props.onSearch(event.target.value)} />
      <div className="flex flex-wrap gap-3 text-xs">{(Object.keys(labels) as Kind[]).map((kind) => <span key={kind} className="inline-flex items-center gap-1"><StatusMark kind={kind} />{labels[kind]}</span>)}</div>
    </CardHeader><CardContent className="p-0"><Table className="min-w-max"><TableHeader><TableRow><TableHead className="sticky left-0 z-10 min-w-48 bg-card">Employee</TableHead>{dates.map((onDate) => <TableHead key={onDate} className="px-1 text-center">{Number(onDate.slice(-2))}</TableHead>)}{["Present", "Half-days", "Weekly offs", "Absent", "Leave", "Unmarked"].map((label) => <TableHead key={label} className="bg-primary/5 text-center">{label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{visible.map((employee) => { const totals = attendanceMonthTotals(month, data.records[employee.id] || [], data.calendar); return <TableRow key={employee.id}><TableCell className="sticky left-0 z-10 bg-card"><button type="button" className="rounded-md text-left font-medium underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openEmployee(employee.id)}>{employee.employeeName}<span className="block text-xs font-normal text-muted-foreground">{employee.employeeCode}</span></button></TableCell>{dates.map((onDate) => <TableCell key={onDate} className="px-1 text-center"><button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${employee.employeeName}, ${onDate}, ${labels[kindFor(employee.id, onDate)]}`} onClick={() => openDay(employee.id, onDate)}><StatusMark kind={kindFor(employee.id, onDate)} /></button></TableCell>)}{[totals.present, totals.halfDays, totals.weeklyOff, totals.absent, totals.leave, totals.unmarked].map((total, index) => <TableCell key={index} className="bg-primary/5 text-center font-semibold">{total}</TableCell>)}</TableRow> })}{!visible.length ? <TableRow><TableCell colSpan={dates.length + 7} className="h-24 text-center text-muted-foreground">No employees match this search.</TableCell></TableRow> : null}</TableBody>
    </Table><div className="flex flex-wrap items-center justify-between gap-3 border-t p-4"><p className="text-xs text-muted-foreground">Scroll horizontally to see every day and the monthly totals. Existing payslip attendance is read-only.</p>{canManage ? <Button variant="outline" disabled={saving} onClick={props.onSaveAll}>Save grid changes</Button> : null}</div></CardContent></Card>

    {selectedEmployee ? <div ref={employeeDetail} className="scroll-mt-24"><Card><CardHeader className="border-b bg-linear-to-r from-primary/10 to-background"><div className="flex flex-wrap items-center justify-between gap-4"><div><CardTitle>{selectedEmployee.employeeName} · attendance</CardTitle><CardDescription className="mt-2">{selectedEmployee.employeeCode} · {formatSalaryMonth(employeeMonth)}</CardDescription></div><div className="space-y-2"><Label htmlFor="employee-attendance-month">Employee month</Label><Input id="employee-attendance-month" type="month" value={employeeMonth} onChange={(event) => { if (event.target.value) setEmployeeMonth(event.target.value) }} /></div><Button variant="ghost" aria-label="Close employee attendance" onClick={() => setSelectedEmployeeId("")}><X /></Button></div></CardHeader><CardContent>
      <div className="mb-4 flex flex-wrap gap-4 text-sm">{Object.entries(attendanceMonthTotals(employeeMonth, employeeRecords, employeeData.calendar)).map(([key, value]) => <span key={key} className="rounded-lg bg-muted px-3 py-2"><span className="capitalize">{key.replace(/([A-Z])/g, " $1")}</span>: <strong>{value}</strong></span>)}</div>
      <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Time</TableHead><TableHead>Remark</TableHead></TableRow></TableHeader><TableBody>{attendanceMonthDates(employeeMonth).map((onDate) => { const record = employeeRecords.find((item) => item.date === onDate); const kind = attendanceDayKind(onDate, employeeRecords, employeeData.calendar); return <TableRow key={onDate}><TableCell>{onDate}</TableCell><TableCell><span className="inline-flex items-center gap-2"><StatusMark kind={kind} />{labels[kind]}</span></TableCell><TableCell>{record?.time || "—"}</TableCell><TableCell className="max-w-sm whitespace-normal">{record?.remark || "—"}</TableCell></TableRow> })}</TableBody></Table>
    </CardContent></Card></div> : null}

    <Card><CardHeader className="border-b bg-linear-to-r from-primary/10 to-background"><CardTitle>Attendance by date</CardTitle><CardDescription>Select any date to see who attended. Present includes half-days, labelled separately.</CardDescription><div className="grid max-w-xl gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="attendance-lookup-date">View date</Label><Input id="attendance-lookup-date" type="date" value={date} onChange={(event) => { if (event.target.value) props.onDate(event.target.value) }} /></div><div className="space-y-2"><Label htmlFor="attendance-day-filter">Show employees</Label><select id="attendance-day-filter" className={selectClass} value={dayFilter} onChange={(event) => setDayFilter(event.target.value)}><option value="present">Present (including half-day)</option><option value="all">All statuses</option><option value="unpaid_leave">Absent / unpaid leave</option><option value="paid_leave">Paid leave</option><option value="unmarked">Not marked</option></select></div></div></CardHeader><CardContent>
      <p className="mb-3 text-sm text-muted-foreground">{dayEmployees.length} employee{dayEmployees.length === 1 ? "" : "s"} shown for {date}.{props.search ? " Employee search is applied." : ""}</p>
      {canManage ? <div className="mb-4 flex flex-wrap gap-2"><Button variant="outline" disabled={saving || nonWorking} onClick={props.onMarkAll}>Mark searched employees present</Button></div> : null}
      <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Status</TableHead><TableHead>Time</TableHead><TableHead>Remark</TableHead>{canManage ? <TableHead>Action</TableHead> : null}</TableRow></TableHeader><TableBody>{dayEmployees.map((employee) => { const record = data.records[employee.id]?.find((item) => item.date === date); const kind = kindFor(employee.id, date); return <TableRow key={employee.id}><TableCell><button className="text-left hover:underline" onClick={() => openEmployee(employee.id)}>{employee.employeeName}</button><p className="text-xs text-muted-foreground">{employee.employeeCode}</p></TableCell><TableCell><span className="inline-flex items-center gap-2"><StatusMark kind={kind} />{labels[kind]}</span></TableCell><TableCell>{record?.time || "—"}</TableCell><TableCell className="max-w-sm whitespace-normal">{record?.remark || "—"}</TableCell>{canManage ? <TableCell><Button size="sm" variant="outline" disabled={props.isLocked(employee.id) || saving || kind === "weekly_off" || kind === "holiday"} onClick={() => openDay(employee.id, date)}>Edit</Button></TableCell> : null}</TableRow> })}{!dayEmployees.length ? <TableRow><TableCell colSpan={canManage ? 5 : 4} className="h-24 text-center text-muted-foreground">No employees match this date and status. Unmarked attendance is not counted as present.</TableCell></TableRow> : null}</TableBody></Table>
    </CardContent></Card>

    <Card><CardHeader className="border-b bg-linear-to-r from-primary/10 to-background"><CardTitle>Detailed log</CardTitle><CardDescription>Saved and current entries for {formatSalaryMonth(month)}. Grid changes are saved with “Save grid changes”.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Time</TableHead><TableHead>Employee</TableHead><TableHead>Status</TableHead><TableHead>Remark</TableHead>{canManage ? <TableHead>Action</TableHead> : null}</TableRow></TableHeader><TableBody>{logs.map(({ employee, record }) => <TableRow key={`${employee.id}:${record.date}`}><TableCell>{record.date}</TableCell><TableCell>{record.time || "—"}</TableCell><TableCell>{employee.employeeName}</TableCell><TableCell><span className="inline-flex items-center gap-2"><StatusMark kind={record.status} />{labels[record.status]}</span></TableCell><TableCell className="max-w-sm whitespace-normal">{record.remark || "—"}</TableCell>{canManage ? <TableCell><Button size="sm" variant="ghost" disabled={props.isLocked(employee.id) || saving} onClick={() => props.onClear(employee.id, record.date)}>Clear entry</Button></TableCell> : null}</TableRow>)}{!logs.length ? <TableRow><TableCell colSpan={canManage ? 6 : 5} className="h-24 text-center text-muted-foreground">No attendance entries for this month.</TableCell></TableRow> : null}</TableBody></Table></CardContent></Card>
  </div>
}
