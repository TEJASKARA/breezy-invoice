import assert from "node:assert/strict"
import test from "node:test"
import { dashboardMetrics, periodRange } from "../src/lib/dashboard-analytics.ts"

const today = new Date(2026, 10, 17) // Tue 17 Nov 2026
const companies = [{ id: "e1", companyName: "Alpha", gstin: "36AAAAA0000A1Z5" }, { id: "e2", companyName: "Beta", gstin: "" }]
const customers = [{ id: "c1", entityId: "e1", companyName: "Gamma Pvt Ltd", gstin: "36BBBBB0000B1Z5" }, { id: "c2", entityId: "e1", companyName: "Ravi", gstin: "" }]
const invoice = (id, date, amount, extra = {}) => ({ id, entityId: "e1", number: id, companyName: "Gamma Pvt Ltd", customerId: "c1", date, amount, taxableAmount: amount / 1.18, cgstAmount: amount * 0.09 / 1.18, sgstAmount: amount * 0.09 / 1.18, igstAmount: 0, status: "Generated", ...extra })
const base = {
  today, scope: { entityId: "e1", companies }, customers, creditsRemaining: 100,
  invoices: [
    invoice("i1", "2026-11-16", 11800),
    invoice("i2", "2026-11-15", 5900, { customerId: "c2", companyName: "Ravi" }),
    invoice("i3", "2026-11-14", 1000, { status: "Draft" }),
    invoice("i4", "2026-11-14", 2000, { status: "Cancelled" }),
    invoice("i5", "2026-10-01", 50000),
    invoice("i6", "2026-11-16", 9999, { entityId: "e2" }),
  ],
  proformas: [
    { id: "q1", entityId: "e1", date: "2026-11-15", validUntil: "2026-11-20", amount: 1000, convertedInvoiceId: "i1", status: "Generated" },
    { id: "q2", entityId: "e1", date: "2026-11-16", validUntil: "2026-11-22", amount: 2000, status: "Generated" },
    { id: "q3", entityId: "e1", date: "2026-11-13", validUntil: "2026-11-16", amount: 3000, status: "Generated" },
  ],
  payslips: [{ id: "p1", entityId: "e1", employeeId: "emp1", month: "2026-11", grossPay: 30000, netPay: 28000, status: "Generated", generatedAt: "2026-11-16T10:00:00Z" }],
  expenses: [{ id: "x1", entityId: "e1", date: "2026-11-15", amount: 2000, paymentStatus: "Pending" }],
  employees: [{ id: "emp1", entityId: "e1" }, { id: "emp2", entityId: "e1" }],
  attendanceDrafts: { "e1:2026-11": { attendance: { saturdayWeeklyOff: true, sundayWeeklyOff: true, holidays: [] }, employeeRecords: { emp1: [{ date: "2026-11-17", status: "present" }] } } },
}

test("period presets", () => {
  assert.deepEqual(periodRange("last5", today), { from: "2026-11-13", to: "2026-11-17" })
  assert.deepEqual(periodRange("thisMonth", today), { from: "2026-11-01", to: "2026-11-17" })
  assert.deepEqual(periodRange("thisFy", today), { from: "2026-04-01", to: "2026-11-17" })
  assert.deepEqual(periodRange("thisFy", new Date(2027, 1, 3)), { from: "2026-04-01", to: "2027-02-03" })
  assert.deepEqual(periodRange("custom", today, { from: "2026-11-10", to: "2026-11-01" }), { from: "2026-11-01", to: "2026-11-10" })
})

test("sales, GST, quotations, payroll, expenses and profit for the selected company", () => {
  const m = dashboardMetrics({ ...base, range: periodRange("last5", today) })
  assert.equal(m.sales.count, 2)
  assert.equal(m.sales.value, 17700)
  assert.equal(m.sales.drafts, 1)
  assert.equal(m.sales.cancelled, 1)
  assert.equal(m.gst.taxable, 15000)
  assert.equal(m.gst.total, 2700)
  assert.equal(m.gst.b2bCount, 1)
  assert.equal(m.gst.b2cValue, 5900)
  assert.equal(m.quotations.count, 3)
  assert.equal(m.quotations.converted, 1)
  assert.equal(m.quotations.conversionRate, 33)
  assert.equal(m.quotations.open, 1)
  assert.equal(m.quotations.expiringSoon, 1)
  assert.equal(m.quotations.lapsed, 1)
  assert.equal(m.payroll.gross, 30000)
  assert.equal(m.payroll.pendingThisMonth, 1)
  assert.equal(m.expenses.total, 2000)
  assert.equal(m.profit.estimated, 15000 - 2000 - 30000)
  assert.deepEqual([m.attendance.present, m.attendance.unmarked], [1, 1])
  assert.equal(m.topCustomers[0].name, "Gamma Pvt Ltd")
  assert.equal(m.trend.at(-1).value, 17700)
  assert.equal(m.trend.at(-2).value, 50000)
  assert.equal(m.actions.draftInvoices, 1)
})

test("all companies, credits forecast and low-credit alert", () => {
  const all = dashboardMetrics({ ...base, scope: { entityId: null, companies }, range: periodRange("last5", today) })
  assert.equal(all.sales.value, 17700 + 9999)
  assert.equal(all.actions.companiesWithoutGstin, 1)
  const low = dashboardMetrics({ ...base, creditsRemaining: 5, range: periodRange("all", today) })
  assert.equal(low.credits.usedLast30, 3 + 3 + 1) // 3 non-draft invoices in 30 days, 3 quotations, 1 payslip
  assert.equal(low.actions.lowCredits, true)
})
