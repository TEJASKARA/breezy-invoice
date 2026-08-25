import { useState } from "react"
import { CalendarDays, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PayslipAttendance } from "@/lib/mvp-store"
import { calculatePayslipAttendance, indianNationalHolidays, payrollId } from "@/lib/payslip-calculations"

export function AttendanceEditor({
  month,
  value,
  onChange,
  showExceptions = true,
  title,
  description,
}: {
  month: string
  value: PayslipAttendance
  onChange: (attendance: PayslipAttendance) => void
  showExceptions?: boolean
  title: string
  description: string
}) {
  const [holidayDate, setHolidayDate] = useState(`${month}-01`)
  const [holidayName, setHolidayName] = useState("")
  const summary = calculatePayslipAttendance(month, value)
  const effectiveHolidayDate = holidayDate.startsWith(`${month}-`) ? holidayDate : `${month}-01`
  const update = (changes: Partial<PayslipAttendance>) => onChange(calculatePayslipAttendance(month, { ...value, ...changes }).attendance)
  const addHoliday = () => {
    if (!effectiveHolidayDate || !holidayName.trim()) return
    update({ holidays: [...value.holidays.filter((holiday) => holiday.date !== effectiveHolidayDate), { id: payrollId(), date: effectiveHolidayDate, name: holidayName.trim() }] })
    setHolidayName("")
  }
  const restoreNationalHolidays = () => {
    const national = indianNationalHolidays(month)
    update({ holidays: [...value.holidays.filter((holiday) => !national.some((item) => item.date === holiday.date)), ...national] })
  }

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex items-start gap-3"><CalendarDays className="mt-0.5 size-5 text-muted-foreground" /><div><h3 className="font-semibold">{title}</h3><p className="text-sm text-muted-foreground">{description}</p></div></div>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.saturdayWeeklyOff} onChange={(event) => update({ saturdayWeeklyOff: event.target.checked })} />Saturday is a paid weekly off</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.sundayWeeklyOff} onChange={(event) => update({ sundayWeeklyOff: event.target.checked })} />Sunday is a paid weekly off</label>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">Paid public holidays</p><p className="text-xs text-muted-foreground">India’s three nationwide national holidays are added automatically when they fall in this month. Add state or company holidays as needed.</p></div><Button type="button" size="sm" variant="outline" onClick={restoreNationalHolidays}>Restore national holidays</Button></div>
        {value.holidays.length ? <div className="flex flex-wrap gap-2">{value.holidays.map((holiday) => <span key={holiday.id} className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs"><span>{holiday.date} · {holiday.name}</span><button type="button" className="text-muted-foreground hover:text-red-600" aria-label={`Remove ${holiday.name}`} onClick={() => update({ holidays: value.holidays.filter((item) => item.id !== holiday.id) })}>×</button></span>)}</div> : <p className="text-sm text-muted-foreground">No public holidays are included for this month.</p>}
        <div className="grid gap-2 md:grid-cols-[170px_minmax(180px,1fr)_auto]">
          <Input aria-label="Holiday date" type="date" min={`${month}-01`} max={`${month}-${String(summary.attendance.calendarDays).padStart(2, "0")}`} value={effectiveHolidayDate} onChange={(event) => setHolidayDate(event.target.value)} />
          <Input aria-label="Holiday name" value={holidayName} onChange={(event) => setHolidayName(event.target.value)} placeholder="State or company holiday" />
          <Button type="button" variant="outline" disabled={!holidayName.trim()} onClick={addHoliday}><Plus />Add holiday</Button>
        </div>
      </div>
      {showExceptions ? <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2"><Label htmlFor={`${title}-half-days`}>Half days</Label><Input id={`${title}-half-days`} type="number" min="0" max={summary.workingDays} step="1" value={value.halfDays || ""} onChange={(event) => update({ halfDays: Number(event.target.value) || 0 })} placeholder="0" /></div>
        <div className="space-y-2"><Label htmlFor={`${title}-paid-leave`}>Leave taken</Label><Input id={`${title}-paid-leave`} type="number" min="0" max={summary.workingDays} step="0.5" value={value.paidLeaveDays || ""} onChange={(event) => update({ paidLeaveDays: Number(event.target.value) || 0 })} placeholder="0" /></div>
        <div className="space-y-2"><Label htmlFor={`${title}-unpaid-leave`}>Unpaid leave / absent days</Label><Input id={`${title}-unpaid-leave`} type="number" min="0" max={summary.workingDays} step="0.5" value={value.unpaidLeaveDays || ""} onChange={(event) => update({ unpaidLeaveDays: Number(event.target.value) || 0 })} placeholder="0" /></div>
      </div> : null}
      <div className="grid gap-3 rounded-lg bg-muted p-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
        <AttendanceStat label="Calendar" value={summary.attendance.calendarDays} />
        <AttendanceStat label="Working" value={summary.workingDays} />
        <AttendanceStat label="Full present" value={summary.attendance.fullPresentDays} />
        <AttendanceStat label="Weekly offs" value={summary.attendance.weeklyOffDays} />
        <AttendanceStat label="Holidays" value={summary.attendance.holidayDays} />
        <AttendanceStat label="Half days" value={summary.attendance.halfDays} />
        <AttendanceStat label="Payable" value={summary.payableDays} highlight />
      </div>
      {value.leaveAllowancePeriod ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><strong className="font-semibold capitalize">{value.leaveAllowancePeriod} allowance:</strong> {value.leaveAllowanceDays || 0} days · Used before: {value.leaveUsedBefore || 0} · Eligible this period: {value.eligiblePaidLeaveDays || 0} · Excess: {value.excessLeaveDays || 0} · Loss of pay: {value.lossOfPayDays || 0} days · Deduction: ₹{(value.leaveDeductionAmount || 0).toLocaleString("en-IN")}</div> : <p className="text-xs text-muted-foreground">Configure a leave allowance in Workspace settings to calculate excess-leave salary deductions.</p>}
    </div>
  )
}

function AttendanceStat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className={highlight ? "font-semibold text-blue-600" : "font-semibold"}>{value}</p></div>
}
