import type { AttendanceDayRecord, AttendanceDayStatus, AttendanceHoliday, LeavePolicy, PayrollComponent, PayslipAttendance } from "@/lib/mvp-store"

export const payrollId = () => crypto.randomUUID()

export const defaultEarnings = (): PayrollComponent[] => [
  { id: payrollId(), label: "Basic Salary", amount: 0 },
  { id: payrollId(), label: "House Rent Allowance (HRA)", amount: 0 },
  { id: payrollId(), label: "Special Allowance", amount: 0 },
]

export const defaultDeductions = (): PayrollComponent[] => [
  { id: payrollId(), label: "Provident Fund (PF)", amount: 0 },
  { id: payrollId(), label: "Professional Tax", amount: 0 },
  { id: payrollId(), label: "TDS / Income Tax", amount: 0 },
]

export function sumPayrollComponents(items: PayrollComponent[]) {
  return items.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0)
}

export function attendancePresentDays(attendance: Pick<PayslipAttendance, "fullPresentDays" | "halfDays">) {
  return Math.round((attendance.fullPresentDays + attendance.halfDays * 0.5) * 100) / 100
}

export function dailyPresentDays(records: AttendanceDayRecord[]) {
  return records.reduce((total, record) => total + (record.status === "present" ? 1 : record.status === "half_day" ? 0.5 : 0), 0)
}

const nationalHolidayDefinitions = [
  { monthDay: "01-26", name: "Republic Day" },
  { monthDay: "08-15", name: "Independence Day" },
  { monthDay: "10-02", name: "Gandhi Jayanti" },
] as const

export function indianNationalHolidays(month: string): AttendanceHoliday[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return []
  const year = month.slice(0, 4)
  return nationalHolidayDefinitions
    .filter((holiday) => `${year}-${holiday.monthDay}`.startsWith(month))
    .map((holiday) => ({ id: payrollId(), date: `${year}-${holiday.monthDay}`, name: holiday.name }))
}

export function defaultPayslipAttendance(month: string): PayslipAttendance {
  return calculatePayslipAttendance(month, {
    saturdayWeeklyOff: true,
    sundayWeeklyOff: true,
    holidays: indianNationalHolidays(month),
    halfDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
  }).attendance
}

export function calculatePayslipAttendance(month: string, input: Partial<PayslipAttendance>) {
  const validMonth = /^\d{4}-\d{2}$/.test(month)
  const [year, monthNumber] = validMonth ? month.split("-").map(Number) : [0, 0]
  const calendarDays = validMonth ? new Date(year, monthNumber, 0).getDate() : 0
  const saturdayWeeklyOff = input.saturdayWeeklyOff ?? true
  const sundayWeeklyOff = input.sundayWeeklyOff ?? true
  const holidays = (input.holidays || [])
    .filter((holiday, index, items) => holiday.date.startsWith(`${month}-`) && items.findIndex((item) => item.date === holiday.date) === index)
    .map((holiday) => ({ ...holiday, name: holiday.name.trim() || "Public holiday" }))

  let weeklyOffDays = 0
  const weeklyOffDates = new Set<string>()
  for (let day = 1; day <= calendarDays; day += 1) {
    const date = new Date(year, monthNumber - 1, day)
    const isWeeklyOff = (date.getDay() === 6 && saturdayWeeklyOff) || (date.getDay() === 0 && sundayWeeklyOff)
    if (isWeeklyOff) {
      weeklyOffDays += 1
      weeklyOffDates.add(`${month}-${String(day).padStart(2, "0")}`)
    }
  }
  const holidayDays = holidays.filter((holiday) => !weeklyOffDates.has(holiday.date)).length
  const holidayDates = new Set(holidays.map((holiday) => holiday.date))
  const workingDays = Math.max(0, calendarDays - weeklyOffDays - holidayDays)
  const clamp = (value: number | undefined, maximum: number) => Math.min(maximum, Math.max(0, Number.isFinite(value) ? Number(value) : 0))
  const dailyMode = Array.isArray(input.dailyRecords)
  const validStatuses = new Set<AttendanceDayStatus>(["present", "half_day", "paid_leave", "unpaid_leave"])
  const dailyRecords = dailyMode ? [...new Map((input.dailyRecords || [])
    .filter((record): record is AttendanceDayRecord => record.date.startsWith(`${month}-`) && !weeklyOffDates.has(record.date) && !holidayDates.has(record.date) && validStatuses.has(record.status))
    .map((record) => [record.date, record])).values()].sort((left, right) => left.date.localeCompare(right.date)) : undefined
  const countStatus = (status: AttendanceDayStatus) => dailyRecords?.filter((record) => record.status === status).length || 0
  const halfDays = dailyMode ? countStatus("half_day") : clamp(input.halfDays, workingDays)
  const paidLeaveDays = dailyMode ? countStatus("paid_leave") : clamp(input.paidLeaveDays, Math.max(0, workingDays - halfDays))
  const unpaidLeaveDays = dailyMode ? countStatus("unpaid_leave") : clamp(input.unpaidLeaveDays, Math.max(0, workingDays - halfDays - paidLeaveDays))
  const fullPresentDays = dailyMode ? countStatus("present") : Math.max(0, workingDays - halfDays - paidLeaveDays - unpaidLeaveDays)
  const payableDays = Math.round((weeklyOffDays + holidayDays + fullPresentDays + paidLeaveDays + halfDays * 0.5) * 100) / 100

  return {
    attendance: {
      saturdayWeeklyOff,
      sundayWeeklyOff,
      holidays,
      halfDays,
      paidLeaveDays,
      unpaidLeaveDays,
      ...(dailyMode ? { dailyRecords } : {}),
      calendarDays,
      weeklyOffDays,
      holidayDays,
      fullPresentDays,
    } satisfies PayslipAttendance,
    workingDays,
    payableDays,
  }
}

export function calculateLeaveAdjustedAttendance({
  month,
  attendance,
  policy,
  leaveUsedBefore,
  grossPay,
}: {
  month: string
  attendance: Partial<PayslipAttendance>
  policy?: LeavePolicy
  leaveUsedBefore: number
  grossPay: number
}): { attendance: PayslipAttendance; workingDays: number; payableDays: number; leaveDeductionAmount: number } {
  const base = calculatePayslipAttendance(month, attendance)
  const leaveTakenDays = base.attendance.paidLeaveDays
  const allowanceDays = policy ? Math.max(0, Number(policy.allowanceDays) || 0) : leaveTakenDays
  const remainingAllowance = policy ? Math.max(0, allowanceDays - Math.max(0, leaveUsedBefore)) : leaveTakenDays
  const eligiblePaidLeaveDays = Math.min(leaveTakenDays, remainingAllowance)
  const excessLeaveDays = Math.max(0, leaveTakenDays - eligiblePaidLeaveDays)
  const lossOfPayDays = Math.round((base.attendance.unpaidLeaveDays + excessLeaveDays + base.attendance.halfDays * 0.5) * 100) / 100
  const leaveDeductionAmount = base.attendance.calendarDays
    ? Math.round((Math.max(0, grossPay) / base.attendance.calendarDays) * lossOfPayDays * 100) / 100
    : 0

  return {
    attendance: {
      ...base.attendance,
      eligiblePaidLeaveDays,
      excessLeaveDays,
      ...(policy ? { leaveAllowanceDays: allowanceDays, leaveUsedBefore: Math.max(0, leaveUsedBefore), leaveAllowancePeriod: policy.period } : {}),
      lossOfPayDays,
      leaveDeductionAmount,
    } satisfies PayslipAttendance,
    workingDays: base.workingDays,
    payableDays: Math.max(0, Math.round((base.payableDays - excessLeaveDays) * 100) / 100),
    leaveDeductionAmount,
  }
}

export function formatSalaryMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
}

export function nextSalaryMonth(month: string) {
  const date = new Date(`${month}-01T00:00:00`)
  date.setMonth(date.getMonth() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

export function maskBankAccount(account: string) {
  const cleaned = account.replace(/\s/g, "")
  if (!cleaned) return "Not provided"
  return `XXXX-XXXX-${cleaned.slice(-4)}`
}

const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

function belowThousand(value: number) {
  const words: string[] = []
  if (value >= 100) {
    words.push(`${ones[Math.floor(value / 100)]} Hundred`)
    value %= 100
  }
  if (value >= 20) {
    words.push(tens[Math.floor(value / 10)])
    value %= 10
  }
  if (value > 0) words.push(ones[value])
  return words.join(" ")
}

export function amountInWords(amount: number) {
  let value = Math.max(0, Math.round(amount))
  if (value === 0) return "Zero Rupees Only"
  const parts: string[] = []
  const crore = Math.floor(value / 10_000_000)
  if (crore) {
    parts.push(`${belowThousand(crore)} Crore`)
    value %= 10_000_000
  }
  const lakh = Math.floor(value / 100_000)
  if (lakh) {
    parts.push(`${belowThousand(lakh)} Lakh`)
    value %= 100_000
  }
  const thousand = Math.floor(value / 1_000)
  if (thousand) {
    parts.push(`${belowThousand(thousand)} Thousand`)
    value %= 1_000
  }
  if (value) parts.push(belowThousand(value))
  return `${parts.join(" ")} Rupees Only`
}

export function cleanPayslipFileName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "payslip"
}
