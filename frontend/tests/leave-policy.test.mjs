import assert from "node:assert/strict"
import test from "node:test"
import { calculateLeaveAdjustedAttendance, defaultPayslipAttendance, effectiveLeavePolicy, leaveUsedBeforeMonth, leaveYearStart } from "../src/lib/payslip-calculations.ts"

test("leave year start follows the chosen month", () => {
  assert.equal(leaveYearStart("2026-11", 1), "2026-01")
  assert.equal(leaveYearStart("2026-11", 4), "2026-04")
  assert.equal(leaveYearStart("2027-02", 4), "2026-04")
  assert.equal(leaveYearStart("2027-04", 4), "2027-04")
})

test("an employee's own policy overrides the workspace default", () => {
  const workspace = { period: "monthly", allowanceDays: 1 }
  const own = { period: "yearly", allowanceDays: 18, yearStartMonth: 4 }
  assert.equal(effectiveLeavePolicy({ leavePolicy: own }, workspace), own)
  assert.equal(effectiveLeavePolicy({}, workspace), workspace)
  assert.deepEqual(effectiveLeavePolicy(undefined, undefined), { period: "monthly", allowanceDays: 1 })
})

const slip = (id, month, paidLeaveDays) => ({ id, employeeId: "e1", month, attendance: { paidLeaveDays } })
const history = [slip("a", "2026-02", 2), slip("b", "2026-03", 3), slip("c", "2026-04", 1), slip("d", "2026-05", 2)]

test("yearly leave used counts only the current leave year", () => {
  const april = { period: "yearly", allowanceDays: 12, yearStartMonth: 4 }
  assert.equal(leaveUsedBeforeMonth(history, "e1", "2026-06", april), 3)
  const january = { period: "yearly", allowanceDays: 12, yearStartMonth: 1 }
  assert.equal(leaveUsedBeforeMonth(history, "e1", "2026-06", january), 8)
  assert.equal(leaveUsedBeforeMonth(history, "e1", "2027-03", april), 3)
  assert.equal(leaveUsedBeforeMonth(history, "e1", "2026-06", undefined), 0)
})

test("leave beyond an employee's remaining allowance becomes loss of pay", () => {
  const month = "2026-06"
  const attendance = { ...defaultPayslipAttendance(month), paidLeaveDays: 3, dailyRecords: undefined }
  const policy = { period: "yearly", allowanceDays: 4, yearStartMonth: 4 }
  const used = leaveUsedBeforeMonth(history, "e1", month, policy)
  const result = calculateLeaveAdjustedAttendance({ month, attendance, policy, leaveUsedBefore: used, grossPay: 30000 })
  assert.equal(result.attendance.eligiblePaidLeaveDays, 1)
  assert.equal(result.attendance.excessLeaveDays, 2)
  assert.equal(result.leaveDeductionAmount, 2000)
})
