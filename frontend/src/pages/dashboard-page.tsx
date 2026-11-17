import { useEntitySelection } from "@/lib/entity-selection"
import { AlertTriangle, BadgeIndianRupee, CalendarCheck2, CircleCheck, Clock3, Coins, FileText, Plus, ReceiptText, TrendingUp, Upload, Users, WalletCards } from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { dashboardMetrics, periodLabels, periodRange, type DashboardMetrics, type PeriodPreset } from "@/lib/dashboard-analytics"
import { getFreeDocumentAllowance } from "@/lib/free-document-allowance"
import { useAuthUser } from "@/lib/use-auth-user"
import { useMvpStore } from "@/lib/mvp-store"
import { getSetupProgress } from "@/lib/setup-progress"
import { useWorkspaceAccess } from "@/lib/workspace-access"

const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`
const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm"

function Stat({ icon: Icon, label, value, detail, tone }: { icon: typeof ReceiptText; label: string; value: string; detail: string; tone?: "good" | "bad" }) {
  return <Card><CardContent className="p-5">
    <span className="mb-4 flex size-9 items-center justify-center rounded-lg bg-primary/8 text-primary"><Icon className="size-4" /></span>
    <p className={`text-2xl font-semibold tracking-tight tabular-nums ${tone === "bad" ? "text-red-600 dark:text-red-400" : ""}`}>{value}</p>
    <p className="mt-1 text-sm font-medium">{label}</p>
    <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
  </CardContent></Card>
}

function Row({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-4 py-1.5 text-sm ${strong ? "border-t pt-2.5 font-semibold" : ""}`}><span className={strong ? "" : "text-muted-foreground"}>{label}</span><span className="tabular-nums">{value}</span></div>
}

function SalesTrend({ trend }: { trend: DashboardMetrics["trend"] }) {
  const max = Math.max(...trend.map((point) => point.value), 1)
  return <div>
    <div className="flex h-44 items-end gap-1.5" role="img" aria-label="Invoice value for the last 12 months">
      {trend.map((point) => <div key={point.month} className="group flex h-full flex-1 flex-col justify-end" title={`${point.label} ${point.month.slice(0, 4)}: ${inr(point.value)}`}>
        <div className="rounded-t bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(point.value ? 3 : 0, (point.value / max) * 100)}%` }} />
      </div>)}
    </div>
    <div className="mt-2 flex gap-1.5 text-[10px] text-muted-foreground">{trend.map((point) => <span key={point.month} className="flex-1 text-center">{point.label}</span>)}</div>
    <ul className="sr-only">{trend.map((point) => <li key={point.month}>{point.month}: {inr(point.value)}</li>)}</ul>
  </div>
}

export function DashboardPage() {
  const { selectedEntityId, selectedEntity, openEntityManager } = useEntitySelection()
  const { user } = useAuthUser()
  const { can, subscription, creditAccount } = useWorkspaceAccess()
  const { setup, companies, customers, employees, invoices, proformas, payslips, expenses } = useMvpStore()
  const [preset, setPreset] = useState<PeriodPreset>("last5")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [allCompanies, setAllCompanies] = useState(false)
  const fullName = String(user?.user_metadata.full_name || user?.user_metadata.name || user?.email?.split("@")[0] || "there")
  const firstName = fullName.split(/\s+/)[0]
  const setupProgress = getSetupProgress({ hasLogin: Boolean(user), setup, companies, invoices, payslips })
  const showSetupProgress = setupProgress.completed < setupProgress.total
  const showSales = can("invoices.read")
  const showPayroll = can("payslips.read")
  const showExpenses = can("expenses.read")
  const creditsRemaining = getFreeDocumentAllowance(setup, subscription, creditAccount, "invoice", invoices.length + payslips.length + proformas.length)?.remaining ?? null

  const range = periodRange(preset, new Date(), { from: customFrom, to: customTo })
  const metrics = useMemo(() => dashboardMetrics({
    today: new Date(),
    range,
    scope: { entityId: allCompanies ? null : selectedEntityId || null, companies },
    invoices, proformas, payslips, expenses, customers, employees,
    attendanceDrafts: setup?.attendanceDrafts,
    creditsRemaining,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [range.from, range.to, allCompanies, selectedEntityId, companies, invoices, proformas, payslips, expenses, customers, employees, setup?.attendanceDrafts, creditsRemaining])

  const activity = [
    ...invoices.map((invoice) => ({ id: invoice.id, document: invoice.number, entity: invoice.companyName, type: "Invoice", amount: inr(invoice.amount), status: invoice.status, date: invoice.date })),
    ...proformas.map((proforma) => ({ id: proforma.id, document: proforma.number, entity: proforma.companyName, type: "Quotation", amount: inr(proforma.amount), status: proforma.convertedInvoiceId ? "Converted" : proforma.status, date: proforma.date })),
    ...payslips.map((payslip) => ({ id: payslip.id, document: `${payslip.month} payslip`, entity: payslip.employeeName, type: "Payslip", amount: inr(payslip.netPay), status: payslip.status, date: payslip.paymentDate || `${payslip.month}-01` })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)

  const { sales, gst, quotations, payroll, attendance, expenses: spend, profit, credits, actions } = metrics
  const actionItems = [
    showSales && actions.draftInvoices ? { text: `${actions.draftInvoices} draft invoice${actions.draftInvoices === 1 ? "" : "s"} not yet generated`, to: "/invoices" } : null,
    showSales && actions.expiringQuotations ? { text: `${actions.expiringQuotations} quotation${actions.expiringQuotations === 1 ? "" : "s"} expiring within 7 days`, to: "/proformas" } : null,
    showPayroll && actions.unmarkedToday ? { text: `${actions.unmarkedToday} employee${actions.unmarkedToday === 1 ? "" : "s"} not marked for today`, to: "/attendance" } : null,
    showPayroll && payroll.pendingThisMonth && payroll.headcount ? { text: `${payroll.pendingThisMonth} payslip${payroll.pendingThisMonth === 1 ? "" : "s"} pending this month`, to: "/employees" } : null,
    actions.companiesWithoutGstin ? { text: `${actions.companiesWithoutGstin} compan${actions.companiesWithoutGstin === 1 ? "y has" : "ies have"} no GSTIN`, to: "/settings/workspace" } : null,
    actions.lowCredits ? { text: `Credits running low (${credits.remaining} left)`, to: "/pricing" } : null,
  ].filter((item): item is { text: string; to: string } => Boolean(item))

  const scopeName = allCompanies ? "All companies" : selectedEntity?.companyName || "Selected company"
  const rangeLabel = preset === "all" ? "all time" : `${range.from} to ${range.to}`

  return <div className="space-y-7">
    <PageHeader eyebrow={new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date())} title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${firstName}`} description={`Here’s what is happening in ${setup?.firmName || "your ChanaX workspace"}.`} actions={<>{can("entities.manage") ? <Button variant="outline" onClick={() => openEntityManager("add")}><Upload />Add entity</Button> : null}{can("invoices.manage") ? <Button asChild><Link to="/invoices"><Plus />New invoice</Link></Button> : null}</>} />

    <section className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/30 p-3">
      <div className="space-y-1"><label htmlFor="dashboard-scope" className="text-xs font-medium text-muted-foreground">Company</label><select id="dashboard-scope" className={`${selectClass} block max-w-64`} value={allCompanies ? "all" : "selected"} onChange={(event) => setAllCompanies(event.target.value === "all")}><option value="selected">{selectedEntity?.companyName || "Selected company"}</option><option value="all">All companies</option></select></div>
      <div className="space-y-1"><label htmlFor="dashboard-period" className="text-xs font-medium text-muted-foreground">Period</label><select id="dashboard-period" className={`${selectClass} block`} value={preset} onChange={(event) => setPreset(event.target.value as PeriodPreset)}>{(Object.keys(periodLabels) as PeriodPreset[]).map((key) => <option key={key} value={key}>{periodLabels[key]}</option>)}</select></div>
      {preset === "custom" ? <>
        <div className="space-y-1"><label htmlFor="dashboard-from" className="text-xs font-medium text-muted-foreground">From</label><Input id="dashboard-from" type="date" className="w-40" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} /></div>
        <div className="space-y-1"><label htmlFor="dashboard-to" className="text-xs font-medium text-muted-foreground">To</label><Input id="dashboard-to" type="date" className="w-40" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} /></div>
      </> : null}
      <p className="ml-auto text-xs text-muted-foreground">{scopeName} · {rangeLabel}</p>
    </section>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {showSales ? <Stat icon={ReceiptText} label="Invoices" value={inr(sales.value)} detail={`${sales.count} issued${sales.drafts ? ` · ${sales.drafts} draft` : ""}${sales.cancelled ? ` · ${sales.cancelled} cancelled` : ""}`} /> : null}
      {showSales ? <Stat icon={FileText} label="Quotations" value={String(quotations.count)} detail={`${inr(quotations.value)} quoted · ${quotations.conversionRate === null ? "no conversions yet" : `${quotations.conversionRate}% converted`}`} /> : null}
      {showPayroll ? <Stat icon={Users} label="Payroll" value={inr(payroll.gross)} detail={`${payroll.payslips} payslip${payroll.payslips === 1 ? "" : "s"} · ${inr(payroll.net)} net paid`} /> : null}
      {showExpenses ? <Stat icon={WalletCards} label="Expenses" value={inr(spend.total)} detail={`${spend.count} expense${spend.count === 1 ? "" : "s"}${spend.pending ? ` · ${spend.pending} unpaid` : ""}`} /> : null}
      {showSales && showPayroll && showExpenses ? <Stat icon={TrendingUp} label="Estimated profit" value={inr(profit.estimated)} detail="Taxable sales − expenses − payroll" tone={profit.estimated < 0 ? "bad" : undefined} /> : null}
      <Stat icon={Coins} label="Credits left" value={credits.remaining === null ? "—" : credits.remaining.toLocaleString("en-IN")} detail={credits.daysLeft === null ? `${credits.usedLast30} used in the last 30 days` : `About ${credits.daysLeft} days at the current pace (${credits.usedLast30} used in 30 days)`} />
    </section>

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
      {showSales ? <Card><CardHeader><CardTitle>Sales trend</CardTitle><CardDescription>Issued invoice value for the last 12 months · {scopeName}</CardDescription></CardHeader><CardContent><SalesTrend trend={metrics.trend} /></CardContent></Card> : null}
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4" />Action items</CardTitle><CardDescription>Things that need attention now.</CardDescription></CardHeader><CardContent>
        {actionItems.length ? <ul className="space-y-2">{actionItems.map((item) => <li key={item.text}><Link to={item.to} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50"><span>{item.text}</span><span className="text-xs text-primary">Open</span></Link></li>)}</ul>
          : <p className="flex items-center gap-2 text-sm text-muted-foreground"><CircleCheck className="size-4 text-emerald-600" />Nothing needs attention.</p>}
      </CardContent></Card>
    </section>

    {showSales ? <section className="grid gap-5 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><BadgeIndianRupee className="size-4" />GST summary</CardTitle><CardDescription>Issued invoices · {rangeLabel}. A reference for GSTR-1 and GSTR-3B; confirm with your CA.</CardDescription></CardHeader><CardContent>
        <Row label="Taxable value" value={inr(gst.taxable)} />
        <Row label="CGST" value={inr(gst.cgst)} />
        <Row label="SGST" value={inr(gst.sgst)} />
        <Row label="IGST" value={inr(gst.igst)} />
        <Row label="Total GST" value={inr(gst.total)} strong />
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">B2B (customer has GSTIN)</p><p className="font-semibold tabular-nums">{inr(gst.b2bValue)}</p><p className="text-xs text-muted-foreground">{gst.b2bCount} invoice{gst.b2bCount === 1 ? "" : "s"}</p></div>
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">B2C (no GSTIN)</p><p className="font-semibold tabular-nums">{inr(gst.b2cValue)}</p><p className="text-xs text-muted-foreground">{gst.b2cCount} invoice{gst.b2cCount === 1 ? "" : "s"}</p></div>
        </div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="size-4" />Quotation pipeline</CardTitle><CardDescription>Open quotations are not converted and still valid.</CardDescription></CardHeader><CardContent>
        <Row label="Open quotations" value={`${quotations.open} · ${inr(quotations.openValue)}`} />
        <Row label="Expiring within 7 days" value={quotations.expiringSoon} />
        <Row label={`Created in period`} value={quotations.count} />
        <Row label="Converted to invoices" value={quotations.converted} />
        <Row label="Lapsed without conversion" value={quotations.lapsed} />
        <Row label="Conversion rate" value={quotations.conversionRate === null ? "—" : `${quotations.conversionRate}%`} strong />
      </CardContent></Card>
    </section> : null}

    <section className="grid gap-5 lg:grid-cols-2">
      {showPayroll ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarCheck2 className="size-4" />Payroll and attendance</CardTitle><CardDescription>Headcount and today's attendance · {scopeName}</CardDescription></CardHeader><CardContent>
        <Row label="Employees" value={payroll.headcount} />
        <Row label="Payslips pending this month" value={payroll.pendingThisMonth} />
        <Row label="Payroll cost in period (gross)" value={inr(payroll.gross)} />
        <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Today</p>
          {attendance.nonWorkingDay ? <p className="text-muted-foreground">Weekly off or holiday.</p> : <div className="grid grid-cols-5 gap-2 text-center">
            {[["Present", attendance.present], ["Half-day", attendance.halfDay], ["Leave", attendance.leave], ["Absent", attendance.absent], ["Not marked", attendance.unmarked]].map(([label, value]) => <div key={label as string}><p className="text-lg font-semibold tabular-nums">{value}</p><p className="text-[11px] text-muted-foreground">{label}</p></div>)}
          </div>}
        </div>
      </CardContent></Card> : null}
      {showSales ? <Card><CardHeader><CardTitle>Top customers</CardTitle><CardDescription>By issued invoice value · {rangeLabel}</CardDescription></CardHeader><CardContent>
        {metrics.topCustomers.length ? <Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader><TableBody>{metrics.topCustomers.map((customer) => <TableRow key={customer.name}><TableCell className="font-medium">{customer.name}</TableCell><TableCell className="text-right tabular-nums">{customer.count}</TableCell><TableCell className="text-right tabular-nums">{inr(customer.value)}</TableCell></TableRow>)}</TableBody></Table>
          : <p className="text-sm text-muted-foreground">No issued invoices in this period.</p>}
      </CardContent></Card> : null}
    </section>

    <section className={showSetupProgress ? "grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.7fr)]" : "grid gap-5"}><Card><CardHeader><CardTitle>Recent activity</CardTitle><CardDescription>Latest documents in this workspace</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Document</TableHead><TableHead className="hidden md:table-cell">Company / employee</TableHead><TableHead className="hidden sm:table-cell">Type</TableHead><TableHead>Amount</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader><TableBody>{activity.length ? activity.map((item) => <TableRow key={item.id}><TableCell className="font-medium">{item.document}</TableCell><TableCell className="hidden text-muted-foreground md:table-cell">{item.entity}</TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{item.type}</TableCell><TableCell>{item.amount}</TableCell><TableCell className="text-right"><Badge variant={item.status === "Draft" ? "secondary" : "outline"}>{item.status === "Draft" ? <Clock3 /> : <CircleCheck className="text-emerald-600" />}{item.status}</Badge></TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-48 text-center text-muted-foreground">No records yet. Add a company, then create your first invoice or payslip.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
      {showSetupProgress ? <Card><CardHeader><CardTitle>Complete your setup</CardTitle><CardDescription>Your progress is unique to this account.</CardDescription></CardHeader><CardContent className="space-y-5"><div><div className="mb-2 flex justify-between text-xs"><span className="font-medium">{setupProgress.completed} of {setupProgress.total} complete</span><span className="text-muted-foreground">{setupProgress.percentage}%</span></div><Progress value={setupProgress.percentage} /></div><div className="space-y-3">{setupProgress.steps.map((step) => <SetupItem key={step.id} done={step.done} label={step.label} />)}</div></CardContent></Card> : null}
    </section>
  </div>
}

function SetupItem({ label, done = false }: { label: string; done?: boolean }) { return <div className="flex items-center gap-3 text-sm"><span className={done ? "flex size-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" : "size-5 rounded-full border-2 border-muted-foreground/25"}>{done && <CircleCheck className="size-3.5" />}</span><span className={done ? "text-muted-foreground line-through" : "font-medium"}>{label}</span></div> }
