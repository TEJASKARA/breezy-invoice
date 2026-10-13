import type { AttendanceDayRecord, PayslipAttendance } from "@/lib/mvp-store"

export function localAttendanceDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}
export function attendanceMonthDates(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return []
  const [year, number] = month.split("-").map(Number)
  return Array.from({ length: new Date(year, number, 0).getDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)
}
export function attendanceDayKind(date: string, records: AttendanceDayRecord[], calendar: PayslipAttendance) {
  if (calendar.holidays.some((holiday) => holiday.date === date)) return "holiday" as const
  const day = new Date(`${date}T00:00:00`).getDay()
  if ((day === 6 && calendar.saturdayWeeklyOff) || (day === 0 && calendar.sundayWeeklyOff)) return "weekly_off" as const
  return records.find((record) => record.date === date)?.status || "unmarked" as const
}
export function attendanceMonthTotals(month: string, records: AttendanceDayRecord[], calendar: PayslipAttendance) {
  const totals = { present: 0, halfDays: 0, absent: 0, leave: 0, weeklyOff: 0, holidays: 0, unmarked: 0 }
  for (const date of attendanceMonthDates(month)) {
    const kind = attendanceDayKind(date, records, calendar)
    if (kind === "present") totals.present += 1
    else if (kind === "half_day") { totals.present += 0.5; totals.halfDays += 1 }
    else if (kind === "paid_leave") totals.leave += 1
    else if (kind === "unpaid_leave") totals.absent += 1
    else if (kind === "weekly_off") totals.weeklyOff += 1
    else if (kind === "holiday") totals.holidays += 1
    else totals.unmarked += 1
  }
  return totals
}
