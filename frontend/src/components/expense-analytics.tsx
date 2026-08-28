import { useMemo } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { Company, Expense, Invoice, Payslip, Proforma } from "@/lib/mvp-store"

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})
const compactNumber = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 })
const chartColours = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]

function monthLabel(month: string) {
  const parsed = new Date(`${month}-01T00:00:00`)
  return Number.isNaN(parsed.getTime())
    ? month
    : new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(parsed)
}

function valueFromTooltip(value: number | string | readonly (number | string)[] | undefined) {
  const numericValue = typeof value === "object" ? value[0] : value
  return currency.format(Number(numericValue || 0))
}

function countFromTooltip(value: number | string | readonly (number | string)[] | undefined) {
  const numericValue = typeof value === "object" ? value[0] : value
  return `${Number(numericValue || 0)} document${Number(numericValue || 0) === 1 ? "" : "s"}`
}

function EmptyChart({ message }: { message: string }) {
  return <div className="grid h-72 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">{message}</div>
}

type ExpenseAnalyticsProps = {
  companies: Company[]
  invoices: Invoice[]
  proformas: Proforma[]
  payslips: Payslip[]
  expenses: Expense[]
}

export function ExpenseAnalytics({ companies, invoices, proformas, payslips, expenses }: ExpenseAnalyticsProps) {
  const analytics = useMemo(() => {
    const months = new Map<string, { month: string; payroll: number; other: number; revenue: number }>()
    const ensureMonth = (month: string) => {
      const existing = months.get(month)
      if (existing) return existing
      const added = { month, payroll: 0, other: 0, revenue: 0 }
      months.set(month, added)
      return added
    }

    for (const invoice of invoices) ensureMonth(invoice.date.slice(0, 7)).revenue += invoice.amount
    for (const payslip of payslips) ensureMonth(payslip.month).payroll += payslip.grossPay
    for (const expense of expenses) ensureMonth(expense.date.slice(0, 7)).other += expense.amount

    const monthly = [...months.values()]
      .sort((left, right) => left.month.localeCompare(right.month))
      .map((item) => ({
        ...item,
        label: monthLabel(item.month),
        expenses: item.payroll + item.other,
      }))

    const categoryMap = new Map<string, number>()
    for (const expense of expenses) categoryMap.set(expense.category, (categoryMap.get(expense.category) || 0) + expense.amount)
    const categories = [...categoryMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((left, right) => right.value - left.value)

    const companyMap = new Map(companies.map((company) => [company.id, { entity: company.companyName, payroll: 0, other: 0 }]))
    for (const payslip of payslips) {
      const item = companyMap.get(payslip.entityId)
      if (item) item.payroll += payslip.grossPay
    }
    for (const expense of expenses) {
      const item = companyMap.get(expense.entityId)
      if (item) item.other += expense.amount
    }
    const entities = [...companyMap.values()]
      .filter((item) => item.payroll + item.other > 0)
      .sort((left, right) => (right.payroll + right.other) - (left.payroll + left.other))

    const documentMonths = new Map<string, { month: string; proformas: number; converted: number; proformaValue: number; invoiceValue: number }>()
    const ensureDocumentMonth = (month: string) => {
      const existing = documentMonths.get(month)
      if (existing) return existing
      const added = { month, proformas: 0, converted: 0, proformaValue: 0, invoiceValue: 0 }
      documentMonths.set(month, added)
      return added
    }
    for (const proforma of proformas) {
      const item = ensureDocumentMonth(proforma.date.slice(0, 7))
      item.proformas += 1
      item.proformaValue += proforma.amount
      if (proforma.convertedInvoiceId) item.converted += 1
    }
    for (const invoice of invoices) {
      ensureDocumentMonth(invoice.date.slice(0, 7)).invoiceValue += invoice.amount
    }
    const documents = [...documentMonths.values()]
      .sort((left, right) => left.month.localeCompare(right.month))
      .map((item) => ({ ...item, label: monthLabel(item.month) }))

    return { monthly, categories, entities, documents }
  }, [companies, expenses, invoices, payslips, proformas])

  return (
    <section className="grid gap-5 xl:grid-cols-2" aria-label="Expense analytics">
      <Card>
        <CardHeader>
          <CardTitle>Monthly expense trend</CardTitle>
          <CardDescription>Payroll and other business expenses over time.</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.monthly.some((item) => item.expenses > 0) ? (
            <div className="h-72" role="img" aria-label="Area chart showing monthly payroll and other expenses">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
                  <defs>
                    <linearGradient id="payroll-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.38} /><stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.03} /></linearGradient>
                    <linearGradient id="other-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-4)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--chart-4)" stopOpacity={0.03} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} width={54} tickFormatter={(value) => compactNumber.format(value)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <Tooltip formatter={valueFromTooltip} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--popover-foreground)" }} />
                  <Legend />
                  <Area type="monotone" dataKey="payroll" name="Payroll" stackId="expenses" stroke="var(--chart-2)" fill="url(#payroll-gradient)" />
                  <Area type="monotone" dataKey="other" name="Other expenses" stackId="expenses" stroke="var(--chart-4)" fill="url(#other-gradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart message="Add a payslip or expense to see the monthly trend." />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proforma conversion</CardTitle>
          <CardDescription>Proformas generated and how many were converted into tax invoices, grouped by proforma issue month.</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.documents.some((item) => item.proformas > 0) ? (
            <div className="h-72" role="img" aria-label="Bar chart comparing generated proformas with converted proformas">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.documents} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={34} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <Tooltip formatter={countFromTooltip} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--popover-foreground)" }} />
                  <Legend />
                  <Bar dataKey="proformas" name="Proformas generated" fill="var(--chart-1)" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="converted" name="Converted to invoice" fill="var(--chart-2)" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart message="Generate a proforma to see its conversion performance." />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proforma versus tax-invoice value</CardTitle>
          <CardDescription>Total proforma value compared with generated tax-invoice value for each month.</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.documents.some((item) => item.proformaValue > 0 || item.invoiceValue > 0) ? (
            <div className="h-72" role="img" aria-label="Bar chart comparing proforma value with tax invoice value">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.documents} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} width={54} tickFormatter={(value) => compactNumber.format(value)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <Tooltip formatter={valueFromTooltip} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--popover-foreground)" }} />
                  <Legend />
                  <Bar dataKey="proformaValue" name="Proforma value" fill="var(--chart-1)" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="invoiceValue" name="Tax-invoice value" fill="var(--chart-3)" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart message="Generate a proforma or tax invoice to compare document values." />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Category breakdown</CardTitle>
          <CardDescription>How your recorded business expenses are distributed.</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.categories.length ? (
            <div className="h-72" role="img" aria-label="Donut chart showing expenses by category">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart accessibilityLayer>
                  <Pie data={analytics.categories} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {analytics.categories.map((item, index) => <Cell key={item.name} fill={chartColours[index % chartColours.length]} />)}
                  </Pie>
                  <Tooltip formatter={valueFromTooltip} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--popover-foreground)" }} />
                  <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart message="Add categorized expenses to see their breakdown." />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expenses versus invoice revenue</CardTitle>
          <CardDescription>Monthly sales invoices compared with payroll and other costs.</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.monthly.length ? (
            <div className="h-72" role="img" aria-label="Line chart comparing monthly invoice revenue and expenses">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} width={54} tickFormatter={(value) => compactNumber.format(value)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <Tooltip formatter={valueFromTooltip} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--popover-foreground)" }} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" name="Invoice revenue" stroke="var(--chart-2)" strokeWidth={3} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="expenses" name="Expenses" stroke="var(--chart-4)" strokeWidth={3} dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart message="Generate invoices and record expenses to compare them." />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entity-wise expenses</CardTitle>
          <CardDescription>Payroll and other expenses across your companies.</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.entities.length ? (
            <div className="h-72" role="img" aria-label="Bar chart showing expenses by entity">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.entities} layout="vertical" margin={{ top: 5, right: 8, left: 8, bottom: 0 }} accessibilityLayer>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" axisLine={false} tickLine={false} tickFormatter={(value) => compactNumber.format(value)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <YAxis type="category" dataKey="entity" axisLine={false} tickLine={false} width={110} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value) => value.length > 16 ? `${value.slice(0, 16)}…` : value} />
                  <Tooltip formatter={valueFromTooltip} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--popover-foreground)" }} />
                  <Legend />
                  <Bar dataKey="payroll" name="Payroll" stackId="entity" fill="var(--chart-2)" radius={[4, 0, 0, 4]} />
                  <Bar dataKey="other" name="Other expenses" stackId="entity" fill="var(--chart-4)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart message="Add expenses for your entities to compare them." />}
        </CardContent>
      </Card>
    </section>
  )
}
