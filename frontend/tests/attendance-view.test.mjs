import assert from "node:assert/strict"
import test from "node:test"
import { attendanceDayKind, attendanceMonthDates, attendanceMonthTotals, localAttendanceDate } from "../src/lib/attendance-view.ts"

const calendar = { holidays: [{ date: "2026-10-02", name: "Gandhi Jayanti" }], saturdayWeeklyOff: false, sundayWeeklyOff: true }
test("current attendance date uses local calendar values, not UTC rollover", () => {
  const fake = { getFullYear: () => 2026, getMonth: () => 9, getDate: () => 1, toISOString: () => "2026-09-30T18:35:00Z" }
  assert.equal(localAttendanceDate(fake), "2026-10-01")
})
test("month grid handles leap years and invalid selections", () => {
  assert.equal(attendanceMonthDates("2028-02").length, 29)
  assert.equal(attendanceMonthDates("2026-02").length, 28)
  assert.equal(attendanceMonthDates("2026-10").at(-1), "2026-10-31")
  assert.deepEqual(attendanceMonthDates("2026-13"), [])
})
test("half-days count as 0.5 present days; unmarked is not absent or present", () => {
  const records = [{ date: "2026-10-14", status: "present" }, { date: "2026-10-15", status: "half_day" }, { date: "2026-10-16", status: "paid_leave" }, { date: "2026-10-17", status: "unpaid_leave" }, { date: "2026-09-14", status: "present" }]
  const totals = attendanceMonthTotals("2026-10", records, calendar)
  assert.equal(totals.present, 1.5)
  assert.equal(totals.halfDays, 1)
  assert.equal(totals.absent, 1)
  assert.equal(totals.leave, 1)
  assert.equal(totals.weeklyOff, 4)
  assert.equal(totals.holidays, 1)
  assert.equal(totals.unmarked, 22)
})
test("holidays and weekly offs are derived from the calendar, not counted as marked workdays", () => {
  const records = [{ date: "2026-10-02", status: "present" }, { date: "2026-10-04", status: "half_day" }]
  assert.equal(attendanceDayKind("2026-10-02", records, calendar), "holiday")
  assert.equal(attendanceDayKind("2026-10-04", records, calendar), "weekly_off")
  assert.equal(attendanceMonthTotals("2026-10", records, calendar).present, 0)
})
