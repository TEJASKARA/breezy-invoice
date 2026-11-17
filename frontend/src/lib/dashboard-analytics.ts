/**
 * Overview dashboard metrics, computed from data already loaded in the app.
 * Dates are local "YYYY-MM-DD" strings, so plain string comparison orders them.
 */
import type { AttendanceDraft, Company, Customer, Employee, Expense, Invoice, Payslip, Proforma } from "@/lib/mvp-store"

export type PeriodPreset = "last5" | "last30" | "thisMonth" | "thisFy" | "all" | "custom"
export type DateRange = { from: string; to: string }

export const periodLabels: Record<PeriodPreset, string> = {
  last5: "Last 5 days",
  last30: "Last 30 days",
  thisMonth: "This month",
  thisFy: "This financial year",
  all: "All time",
  custom: "Custom range",
}

export const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next }
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/** The inclusive date range for a preset; "today" is passed in for testability. */
export function periodRange(preset: PeriodPreset, today: Date, custom?: Partial<DateRange>): DateRange {
  const to = isoDate(today)
  if (preset === "last5") return { from: isoDate(addDays(today, -4)), to }
  if (preset === "last30") return { from: isoDate(addDays(today, -29)), to }
  if (preset === "thisMonth") return { from: `${to.slice(0, 7)}-01`, to }
  if (preset === "thisFy") {
    const fyStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
    return { from: `${fyStartYear}-04-01`, to }
  }
  if (preset === "custom") {
    const from = custom?.from || to
    const end = custom?.to || to
    return from <= end ? { from, to: end } : { from: end, to: from }
  }
  return { from: "0000-01-01", to: "9999-12-31" }
}

const inRange = (date: string | undefined, range: DateRange) => Boolean(date) && (date as string) >= range.from && (date as string) <= range.to
/** A payslip belongs to a range when its salary month overlaps it. */
const monthOverlaps = (month: string, range: DateRange) => `${month}-01` <= range.to && `${month}-31` >= range.from

export type Scope = { entityId: string | null; companies: Company[] }
const invoiceEntityId = (invoice: Invoice, companies: Company[]) => invoice.entityId || companies.find((company) => company.companyName === invoice.entityName)?.id
const inScope = (entityId: string | undefined, scope: Scope) => !scope.entityId || entityId === scope.entityId

/** Issued sales: generated or amended invoices; cancelled and draft ones are excluded from values. */
const isIssued = (invoice: Invoice) => invoice.status === "Generated" || invoice.status === "Amended"

export type DashboardInput = {
  today: Date
  range: DateRange
  scope: Scope
  invoices: Invoice[]
  proformas: Proforma[]
  payslips: Payslip[]
  expenses: Expense[]
  customers: Customer[]
  employees: Employee[]
  attendanceDrafts?: Record<string, AttendanceDraft>
  creditsRemaining: number | null
}

export function dashboardMetrics(input: DashboardInput) {
  const { range, scope, today } = input
  const todayIso = isoDate(today)
  const scopedInvoices = input.invoices.filter((invoice) => inScope(invoiceEntityId(invoice, scope.companies), scope))
  const scopedProformas = input.proformas.filter((proforma) => inScope(proforma.entityId, scope))
  const scopedPayslips = input.payslips.filter((payslip) => inScope(payslip.entityId, scope))
  const scopedExpenses = input.expenses.filter((expense) => inScope(expense.entityId, scope))
  const scopedEmployees = input.employees.filter((employee) => inScope(employee.entityId, scope))
  const customerById = new Map(input.customers.map((customer) => [customer.id, customer]))

  // Sales and GST
  const periodInvoices = scopedInvoices.filter((invoice) => inRange(invoice.date, range))
  const issued = periodInvoices.filter(isIssued)
  const sum = <T,>(items: T[], pick: (item: T) => number | undefined) => round2(items.reduce((total, item) => total + (pick(item) || 0), 0))
  const salesValue = sum(issued, (invoice) => invoice.amount)
  const taxableValue = sum(issued, (invoice) => invoice.taxableAmount ?? invoice.amount)
  const cgst = sum(issued, (invoice) => invoice.cgstAmount)
  const sgst = sum(issued, (invoice) => invoice.sgstAmount)
  const igst = sum(issued, (invoice) => invoice.igstAmount)
  const isB2b = (invoice: Invoice) => Boolean(invoice.customerId && customerById.get(invoice.customerId)?.gstin)
  const b2b = issued.filter(isB2b)
  const b2c = issued.filter((invoice) => !isB2b(invoice))

  // Quotations
  const periodQuotations = scopedProformas.filter((proforma) => inRange(proforma.date, range))
  const converted = periodQuotations.filter((proforma) => proforma.convertedInvoiceId)
  const openQuotations = scopedProformas.filter((proforma) => !proforma.convertedInvoiceId && (!proforma.validUntil || proforma.validUntil >= todayIso))
  const weekAhead = isoDate(addDays(today, 7))
  const expiringSoon = openQuotations.filter((proforma) => proforma.validUntil && proforma.validUntil <= weekAhead)
  const lapsed = periodQuotations.filter((proforma) => !proforma.convertedInvoiceId && proforma.validUntil && proforma.validUntil < todayIso)

  // Payroll
  const periodPayslips = scopedPayslips.filter((payslip) => payslip.status === "Generated" && monthOverlaps(payslip.month, range))
  const payrollGross = sum(periodPayslips, (payslip) => payslip.grossPay)
  const payrollNet = sum(periodPayslips, (payslip) => payslip.netPay)
  const currentMonth = todayIso.slice(0, 7)
  const paidThisMonth = new Set(scopedPayslips.filter((payslip) => payslip.month === currentMonth).map((payslip) => payslip.employeeId))
  const payslipsPending = scopedEmployees.filter((employee) => !paidThisMonth.has(employee.id)).length

  // Attendance today (from saved daily attendance)
  const attendance = { present: 0, halfDay: 0, leave: 0, absent: 0, unmarked: 0, nonWorkingDay: false }
  for (const employee of scopedEmployees) {
    const draft = input.attendanceDrafts?.[`${employee.entityId}:${currentMonth}`]
    // Without a saved calendar, Saturday and Sunday are the default weekly offs.
    const calendar = draft?.attendance
    const day = today.getDay()
    const weeklyOff = calendar ? (day === 6 && calendar.saturdayWeeklyOff) || (day === 0 && calendar.sundayWeeklyOff) : day === 0 || day === 6
    if (weeklyOff || calendar?.holidays.some((holiday) => holiday.date === todayIso)) { attendance.nonWorkingDay = true; continue }
    const status = draft?.employeeRecords?.[employee.id]?.find((record) => record.date === todayIso)?.status
    if (status === "present") attendance.present += 1
    else if (status === "half_day") attendance.halfDay += 1
    else if (status === "paid_leave") attendance.leave += 1
    else if (status === "unpaid_leave") attendance.absent += 1
    else attendance.unmarked += 1
  }

  // Expenses and estimated profit (taxable sales, since GST is not income)
  const periodExpenses = scopedExpenses.filter((expense) => inRange(expense.date, range))
  const expensesTotal = sum(periodExpenses, (expense) => expense.amount)
  const estimatedProfit = round2(taxableValue - expensesTotal - payrollGross)

  // Sales trend: the 12 months ending this month
  const trend = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - 11 + index, 1)
    const month = isoDate(date).slice(0, 7)
    const monthInvoices = scopedInvoices.filter((invoice) => isIssued(invoice) && invoice.date.startsWith(month))
    return { month, label: date.toLocaleDateString("en-IN", { month: "short" }), value: sum(monthInvoices, (invoice) => invoice.amount) }
  })

  // Top customers in the period
  const byCustomer = new Map<string, { name: string; value: number; count: number }>()
  for (const invoice of issued) {
    const key = invoice.customerId || invoice.companyName
    const current = byCustomer.get(key) || { name: invoice.companyName, value: 0, count: 0 }
    byCustomer.set(key, { ...current, value: round2(current.value + invoice.amount), count: current.count + 1 })
  }
  const topCustomers = [...byCustomer.values()].sort((left, right) => right.value - left.value).slice(0, 5)

  // Credits: documents generated in the last 30 days, each using one credit
  const since = isoDate(addDays(today, -29))
  const used30 = scopedInvoices.filter((invoice) => invoice.status !== "Draft" && inRange(invoice.date, { from: since, to: todayIso })).length
    + scopedProformas.filter((proforma) => inRange(proforma.date, { from: since, to: todayIso })).length
    + scopedPayslips.filter((payslip) => payslip.status === "Generated" && inRange((payslip.generatedAt || "").slice(0, 10), { from: since, to: todayIso })).length
  const perDay = used30 / 30
  const daysLeft = input.creditsRemaining === null || perDay === 0 ? null : Math.floor(input.creditsRemaining / perDay)

  const draftInvoices = scopedInvoices.filter((invoice) => invoice.status === "Draft").length
  const companiesWithoutGstin = scope.companies.filter((company) => !company.transferredAt && !company.gstin && inScope(company.id, scope)).length
  const lowCredits = input.creditsRemaining !== null && (input.creditsRemaining < 10 || (daysLeft !== null && daysLeft < 14))

  return {
    sales: { count: issued.length, drafts: periodInvoices.filter((invoice) => invoice.status === "Draft").length, cancelled: periodInvoices.filter((invoice) => invoice.status === "Cancelled").length, value: salesValue, taxable: taxableValue },
    gst: { taxable: taxableValue, cgst, sgst, igst, total: round2(cgst + sgst + igst), b2bCount: b2b.length, b2bValue: sum(b2b, (invoice) => invoice.amount), b2cCount: b2c.length, b2cValue: sum(b2c, (invoice) => invoice.amount) },
    quotations: {
      count: periodQuotations.length,
      value: sum(periodQuotations, (proforma) => proforma.amount),
      converted: converted.length,
      conversionRate: periodQuotations.length ? Math.round((converted.length / periodQuotations.length) * 100) : null,
      open: openQuotations.length,
      openValue: sum(openQuotations, (proforma) => proforma.amount),
      expiringSoon: expiringSoon.length,
      lapsed: lapsed.length,
    },
    payroll: { payslips: periodPayslips.length, gross: payrollGross, net: payrollNet, headcount: scopedEmployees.length, pendingThisMonth: payslipsPending },
    attendance,
    expenses: { count: periodExpenses.length, total: expensesTotal, pending: periodExpenses.filter((expense) => expense.paymentStatus === "Pending").length },
    profit: { estimated: estimatedProfit },
    trend,
    topCustomers,
    credits: { remaining: input.creditsRemaining, usedLast30: used30, daysLeft },
    actions: {
      draftInvoices,
      expiringQuotations: expiringSoon.length,
      unmarkedToday: attendance.nonWorkingDay ? 0 : attendance.unmarked,
      companiesWithoutGstin,
      lowCredits,
    },
  }
}

export type DashboardMetrics = ReturnType<typeof dashboardMetrics>
