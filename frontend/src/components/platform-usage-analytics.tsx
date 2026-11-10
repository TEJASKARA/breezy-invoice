import { useCallback, useEffect, useState } from "react"
import { Activity, BarChart3, Building2, Clock, EyeOff, FilePlus2, FlaskConical, MousePointerClick, MoonStar, Phone, Plus, ReceiptText, RefreshCw, Search, UserCog, Users, X } from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { addAnalyticsTestAccount, adminErrorMessage, loadAnalyticsTestAccounts, loadUsageReport, removeAnalyticsTestAccount, type AnalyticsTestAccount, type SetupPendingUser, type UsageExtras, type UsageReport, type WorkspaceOverview } from "@/lib/platform-admin-api"
import { cn } from "@/lib/utils"

const PAGE_LABELS: Record<string, string> = {
  "/workspace": "Dashboard",
  "/entities": "Entities (previous page)",
  "/customers": "Customers",
  "/invoices": "Invoices",
  "/proformas": "Quotations / proformas",
  "/employees": "Employees & payslips",
  "/employees/letters": "Employee letters",
  "/attendance": "Attendance",
  "/expenses": "Expenses",
  "/tally-export": "Tally export",
  "/settings/templates": "Templates",
  "/settings/workspace": "Workspace settings",
  "/pricing": "Pricing",
  "/setup": "Onboarding / signup",
  "/ca": "CA portal",
}

const FEATURE_LABELS: Record<string, string> = {
  invoice_created: "Invoice created",
  invoices_bulk_imported: "Invoices bulk-imported",
  invoice_deleted: "Invoice deleted",
  invoice_pdf_downloaded: "Invoice PDF downloaded",
  quotation_created: "Quotation created",
  quotation_pdf_downloaded: "Quotation PDF downloaded",
  entity_created: "Entity added",
  customer_created: "Customer added",
  employee_created: "Employee added",
  employees_imported: "Employees imported",
  employee_letter_created: "Employee letter created",
  employee_letter_pdf_downloaded: "Employee letter PDF downloaded",
  payslip_created: "Payslip created",
  payslips_bulk_created: "Payslips bulk-created",
  payslip_pdf_downloaded: "Payslip PDF downloaded",
  attendance_saved: "Attendance saved",
  attendance_pdf_downloaded: "Attendance PDF downloaded",
  expense_created: "Expense added",
  template_saved: "Template saved",
  tally_xml_exported: "Tally XML exported",
  complete_data_export: "Complete data export",
  zip_downloaded: "ZIP downloaded",
  whatsapp_share: "Shared on WhatsApp",
  whatsapp_sent: "PDF sent on WhatsApp",
  email_sent: "Document emailed",
  gstin_verified: "GSTIN verified",
}

function SignupMethods({ days }: { days: NonNullable<UsageExtras["signup_methods"]> }) {
  const phone = days.reduce((total, day) => total + day.phone, 0)
  const email = days.reduce((total, day) => total + day.email, 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-ups by method</CardTitle>
        <CardDescription>{number(phone)} with phone · {number(email)} with email or Google in this period (IST days).</CardDescription>
      </CardHeader>
      <CardContent>
        {days.length ? <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={days} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip formatter={(value, name) => [number(Number(value ?? 0)), name === "phone" ? "Phone" : "Email / Google"]} />
              <Legend formatter={(value) => value === "phone" ? "Phone" : "Email / Google"} />
              <Bar dataKey="phone" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="email" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div> : <p className="text-sm text-muted-foreground">No sign-ups in this period.</p>}
      </CardContent>
    </Card>
  )
}

function WorkspaceOverviewCard({ overview, days }: { overview: WorkspaceOverview; days: number }) {
  const business = overview.business
  const gstLabel = overview.gst_status === "verified" ? "GST verified" : overview.gst_status === "no_gst" ? "No GST" : overview.gst_status === "rejected" ? "GST rejected" : business.has_gstin ? "GST pending verification" : "No GST"
  const field = (label: string, value: string | null | undefined, mono = false) => <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={cn("mt-1 font-medium", mono && "font-mono")}>{value || "—"}</dd></div>
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="truncate">{business.firm_name || overview.name}</CardTitle>
          <CardDescription className="font-mono">{overview.subscription_code}</CardDescription>
        </div>
        <Badge variant={overview.gst_status === "verified" ? "secondary" : "outline"}>{business.setup_completed ? gstLabel : "Setup pending"}</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {field("Legal name", business.legal_name)}
          {field("Trade name", business.trade_name)}
          {field("GSTIN", business.gstin, true)}
          {field("PAN", business.pan, true)}
          {field("GST registration status", business.gst_registration_status)}
          {field("Industry", business.industry)}
          <div className="sm:col-span-2 lg:col-span-3">{field("Address", business.mailing_address)}</div>
        </dl>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat icon={ReceiptText} label="Invoices" value={number(overview.invoices.total)} detail={`${number(overview.invoices.generated)} issued · ${number(overview.invoices.draft)} draft · ${number(overview.invoices.cancelled)} cancelled · ${number(overview.invoices.in_period)} in last ${days} days`} />
          <Stat icon={FilePlus2} label="Quotations" value={number(overview.quotations.total)} detail={`${number(overview.quotations.converted)} converted to invoices · ${number(overview.quotations.in_period)} in last ${days} days`} />
        </div>
        {overview.entities.length ? <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Entities ({overview.entities.length})</p>
          <div className="flex flex-wrap gap-2">
            {overview.entities.map((entity, index) => <span key={`${entity.name}-${index}`} className="rounded-lg border px-3 py-1.5 text-sm"><span className="font-medium">{entity.name || "Unnamed"}</span>{entity.gstin ? <span className="ml-2 font-mono text-xs text-muted-foreground">{entity.gstin}</span> : null}{entity.moved ? <span className="ml-2 text-xs text-muted-foreground">(moved)</span> : null}</span>)}
          </div>
        </div> : null}
      </CardContent>
    </Card>
  )
}

function SetupPendingUsers({ users, onSetUp }: { users: SetupPendingUser[]; onSetUp?: (identifier: string) => void }) {
  const signedUp = (value: string) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Setup pending</CardTitle>
        <CardDescription>{users.length ? `${number(users.length)} user${users.length === 1 ? " has" : "s have"} signed up but not finished workspace setup. Call them and, if they agree, complete it from User Management.` : "Everyone who signed up has finished setup."}</CardDescription>
      </CardHeader>
      {users.length ? <CardContent>
        <div className="max-h-96 overflow-auto rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Phone</TableHead><TableHead>Signed up</TableHead><TableHead>Subscription code</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {users.map((user) => <TableRow key={user.user_id}>
                <TableCell><p className="font-medium">{user.full_name || "—"}</p><p className="text-xs text-muted-foreground">{user.email || "No email"}</p></TableCell>
                <TableCell>{user.phone ? <a className="inline-flex items-center gap-1.5 hover:underline" href={`tel:${user.phone}`}><Phone className="size-3.5" />{user.phone}</a> : <span className="text-muted-foreground">Not provided</span>}</TableCell>
                <TableCell><p>{signedUp(user.signed_up_at)}</p><p className="text-xs text-muted-foreground">{user.last_sign_in_at ? `Last seen ${signedUp(user.last_sign_in_at)}` : "Never signed in again"}</p></TableCell>
                <TableCell className="font-mono text-xs">{user.subscription_code}</TableCell>
                <TableCell className="text-right">{onSetUp ? <Button size="sm" variant="outline" onClick={() => onSetUp(user.email || user.subscription_code)}><UserCog />Set up</Button> : null}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </div>
      </CardContent> : null}
    </Card>
  )
}

function NewUserSignups({ extras }: { extras: UsageExtras }) {
  // Select by position: phone-only sign-ups have no email, so email is not a key.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const usersByDay = new Map<string, { user: UsageExtras["new_users"][number]; index: number }[]>()
  extras.new_users.forEach((user, index) => {
    usersByDay.set(user.day, [...(usersByDay.get(user.day) || []), { user, index }])
  })
  const selectedUser = selectedIndex === null ? null : extras.new_users[selectedIndex] ?? null
  const label = (user: UsageExtras["new_users"][number]) => user.email || user.phone || "Phone sign-up"

  return (
    <Card>
      <CardHeader>
        <CardTitle>New users</CardTitle>
        <CardDescription>Sign-ups by day. Select a user below to view their registered phone number.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={extras.daily_signups} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip formatter={(value) => [number(Number(value ?? 0)), "New users"]} />
              <Bar dataKey="users" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {extras.new_users.length ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border p-3 text-sm">
              {extras.daily_signups.map((signup) => (
                <div key={signup.day} className="flex flex-col gap-2 border-b pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:gap-3">
                  <span className="font-medium sm:w-28">{signup.day}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(usersByDay.get(signup.day) || []).map(({ user, index }) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setSelectedIndex(index)}
                        className={cn(
                          "rounded-md border px-2 py-1 text-left text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selectedIndex === index && "border-primary bg-primary/5 text-foreground",
                        )}
                      >
                        {label(user)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <aside className="rounded-lg border bg-muted/30 p-4" aria-live="polite">
              {selectedUser ? <>
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{label(selectedUser).replace(/^\+/, "").slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0"><p className="truncate font-medium">{label(selectedUser)}</p><p className="text-xs text-muted-foreground">Signed up {selectedUser.day}</p></div>
                </div>
                <div className="mt-4 border-t pt-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone number</p><p className="mt-1 font-medium">{selectedUser.phone || "Not provided"}</p></div>
              </> : <p className="text-sm text-muted-foreground">Select a new user to view their contact number.</p>}
            </aside>
          </div>
        ) : <p className="text-sm text-muted-foreground">No new users in this period.</p>}
      </CardContent>
    </Card>
  )
}

const PERIODS = [5, 7, 30, 90, 365] as const
const pageLabel = (path: string) => PAGE_LABELS[path] ?? path
const featureLabel = (name: string) => FEATURE_LABELS[name] ?? name.replaceAll("_", " ")
const number = (value: number | null | undefined) => Number(value || 0).toLocaleString("en-IN")
const dateTime = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  : "—"

function Stat({ icon: Icon, label, value, small = false, detail }: { icon: typeof Activity; label: string; value: string; small?: boolean; detail?: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" />{label}</div>
      <p className={cn("mt-2 font-semibold tabular-nums", small ? "text-lg" : "text-2xl")}>{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

/** Ranked horizontal bars: one hue, value labels in text ink, table-like rows. */
function RankedBars({ rows, empty }: { rows: { key: string; label: string; value: number; detail: string }[]; empty: string }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
  const max = Math.max(...rows.map((row) => row.value), 1)
  return (
    <ol className="space-y-2.5">
      {rows.map((row, index) => (
        <li key={row.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm" title={`${row.label}: ${number(row.value)} · ${row.detail}`}>
          <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-2"><span className="truncate font-medium">{row.label}</span><span className="text-xs text-muted-foreground sm:shrink-0">{row.detail}</span></div>
            <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} /></div>
          </div>
          <span className="w-14 text-right font-semibold tabular-nums">{number(row.value)}</span>
        </li>
      ))}
    </ol>
  )
}

/** Daily activity (page views + actions), single series column chart with hover labels. */
function DailyActivity({ daily, days }: { daily: UsageReport["daily"]; days: number }) {
  const byDay = new Map(daily.map((row) => [row.day, row]))
  const series = Array.from({ length: Math.min(days, 90) }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (Math.min(days, 90) - 1 - index))
    const key = date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
    const row = byDay.get(key)
    return { key, events: (row?.page_views || 0) + (row?.actions || 0), users: row?.active_users || 0 }
  })
  const max = Math.max(...series.map((point) => point.events), 1)
  const [hovered, setHovered] = useState<(typeof series)[number] | null>(null)
  const shown = hovered ?? series[series.length - 1]
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        <span className="font-medium text-foreground">{new Date(`${shown.key}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
        {" · "}{number(shown.events)} events · {number(shown.users)} active users
      </p>
      <div className="flex h-36 items-end gap-[2px] border-b" onMouseLeave={() => setHovered(null)} role="img" aria-label={`Daily activity over the last ${Math.min(days, 90)} days`}>
        {series.map((point) => (
          <button
            key={point.key}
            type="button"
            className="group flex h-full min-w-0 flex-1 items-end focus-visible:outline-none"
            onMouseEnter={() => setHovered(point)}
            onFocus={() => setHovered(point)}
            aria-label={`${point.key}: ${point.events} events, ${point.users} active users`}
          >
            <span
              className={cn("block w-full rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary group-focus-visible:bg-primary", point.events === 0 && "bg-transparent")}
              style={{ height: `${point.events ? Math.max(3, (point.events / max) * 100) : 0}%` }}
            />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{new Date(`${series[0].key}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
        <span>{new Date(`${series[series.length - 1].key}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
      </div>
      {days > 90 ? <p className="text-xs text-muted-foreground">Chart shows the last 90 days; totals and tables cover the full period.</p> : null}
    </div>
  )
}

/** Internal/testing accounts hidden from the platform-wide numbers. */
function TestAccountsPanel({ accounts, busy, onAdd, onRemove }: {
  accounts: AnalyticsTestAccount[]
  busy: boolean
  onAdd: (email: string) => Promise<void>
  onRemove: (account: AnalyticsTestAccount) => Promise<void>
}) {
  const [email, setEmail] = useState("")
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FlaskConical className="size-4" />Test accounts ({accounts.length})</CardTitle>
        <CardDescription>Activity, sign-ups and workspaces of these emails are left out of the platform-wide numbers. Searching one of them directly still shows its usage. Nothing is deleted.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); if (email.trim()) void onAdd(email).then(() => setEmail("")) }}>
          <Label htmlFor="test-account-email" className="sr-only">Test account email</Label>
          <Input id="test-account-email" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tester@example.com" className="sm:max-w-sm" />
          <Button type="submit" variant="outline" disabled={busy || !email.trim()}><Plus />Exclude from analytics</Button>
        </form>
        {accounts.length ? (
          <div className="flex flex-wrap gap-2">
            {accounts.map((account) => (
              <span key={account.user_id} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-1 pl-3 pr-1 text-sm">
                {account.email}
                <Button type="button" size="icon" variant="ghost" className="size-6" disabled={busy} aria-label={`Include ${account.email} in analytics again`} title="Include in analytics again" onClick={() => void onRemove(account)}><X className="size-3.5" /></Button>
              </span>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No test accounts yet. Add an email above, or use &ldquo;Hide&rdquo; on a row in Most active users.</p>}
      </CardContent>
    </Card>
  )
}

export function PlatformUsageAnalytics({ onSetUpUser }: { onSetUpUser?: (identifier: string) => void } = {}) {
  const [days, setDays] = useState<number>(5)
  const [customDays, setCustomDays] = useState("")
  const [queryInput, setQueryInput] = useState("")
  const [activeQuery, setActiveQuery] = useState("")
  const [report, setReport] = useState<UsageReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async (periodDays: number, identifier: string) => {
    setLoading(true)
    setError("")
    try {
      setReport(await loadUsageReport(periodDays, identifier))
    } catch (loadError) {
      setError(adminErrorMessage(loadError, "The usage report could not be loaded."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(days, activeQuery) }, [days, activeQuery, load])

  const [testAccounts, setTestAccounts] = useState<AnalyticsTestAccount[]>([])
  const [testAccountsBusy, setTestAccountsBusy] = useState(false)
  useEffect(() => {
    let active = true
    void loadAnalyticsTestAccounts()
      .then((accounts) => { if (active) setTestAccounts(accounts) })
      .catch((loadError) => { if (active) setError(adminErrorMessage(loadError, "The test accounts could not be loaded.")) })
    return () => { active = false }
  }, [])
  const testAccountIds = new Set(testAccounts.map((account) => account.user_id))
  const changeTestAccounts = async (change: () => Promise<unknown>, fallback: string) => {
    setTestAccountsBusy(true)
    setError("")
    try {
      await change()
      setTestAccounts(await loadAnalyticsTestAccounts())
      await load(days, activeQuery)
    } catch (changeError) {
      setError(adminErrorMessage(changeError, fallback))
    } finally {
      setTestAccountsBusy(false)
    }
  }
  const excludeTestAccount = (email: string) => changeTestAccounts(() => addAnalyticsTestAccount(email), "The account could not be excluded.")
  const includeTestAccount = (account: AnalyticsTestAccount) => changeTestAccounts(() => removeAnalyticsTestAccount(account.user_id), "The account could not be included again.")

  const lookUp = (identifier: string) => { setQueryInput(identifier); setActiveQuery(identifier.trim()) }
  const scope = report?.scope
  const totals = report?.totals

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BarChart3 className="size-4" />Usage analytics</CardTitle>
          <CardDescription>Which pages and features subscribers use. Search an email or subscription code to see one user or one workspace. Only you can see this; your own activity and test accounts are excluded.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-3 md:flex-row md:items-end" onSubmit={(event) => { event.preventDefault(); lookUp(queryInput) }}>
            <div className="flex-1 space-y-2">
              <Label htmlFor="usage-query">Email or subscription code</Label>
              <Input id="usage-query" autoComplete="off" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Leave empty for all subscribers" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}><Search />Show usage</Button>
              {activeQuery ? <Button type="button" variant="outline" onClick={() => lookUp("")}><X />All subscribers</Button> : null}
              <Button type="button" variant="ghost" size="icon" aria-label="Refresh" disabled={loading} onClick={() => void load(days, activeQuery)}><RefreshCw className={cn(loading && "animate-spin")} /></Button>
            </div>
          </form>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Reporting period">
            {PERIODS.map((period) => (
              <Button key={period} size="sm" variant={days === period ? "default" : "outline"} onClick={() => setDays(period)}>
                {period === 365 ? "12 months" : `${period} days`}
              </Button>
            ))}
            <div className="flex items-center gap-2">
              <Label htmlFor="usage-custom-days" className="sr-only">Custom reporting days</Label>
              <Input id="usage-custom-days" type="number" min="1" max="365" value={customDays} onChange={(event) => setCustomDays(event.target.value)} placeholder="Custom days" className="h-8 w-28" />
              <Button size="sm" variant="outline" disabled={!Number.isInteger(Number(customDays)) || Number(customDays) < 1 || Number(customDays) > 365} onClick={() => setDays(Number(customDays))}>Apply</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}

      <TestAccountsPanel accounts={testAccounts} busy={testAccountsBusy} onAdd={excludeTestAccount} onRemove={includeTestAccount} />
      {!report && loading ? <p className="py-10 text-center text-sm text-muted-foreground">Loading usage…</p> : null}

      {report && scope && totals ? (
        <div className={cn("space-y-6", loading && "opacity-60")}>
          {scope.type === "workspace" ? (
            <Card><CardContent className="flex flex-wrap items-start justify-between gap-3 p-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Workspace</p>
                <p className="mt-1 text-lg font-semibold">{scope.name}</p>
                <p className="font-mono text-sm text-muted-foreground">{scope.subscription_code}</p>
                {scope.owner_email ? <p className="text-sm text-muted-foreground">Owner: {scope.owner_email}</p> : null}
              </div>
              <Badge variant={scope.status === "active" ? "secondary" : "destructive"} className="capitalize">{scope.status}</Badge>
            </CardContent></Card>
          ) : null}
          {scope.type === "user" ? (
            <Card><CardContent className="space-y-3 p-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">User</p>
                <p className="mt-1 text-lg font-semibold">{scope.email}</p>
                <p className="text-sm text-muted-foreground">Signed up {dateTime(scope.signed_up_at)} · last sign-in {dateTime(scope.last_sign_in_at)}</p>
              </div>
              {scope.workspaces.length ? (
                <div className="flex flex-wrap gap-2">
                  {scope.workspaces.map((item) => (
                    <button key={item.workspace_id} type="button" onClick={() => lookUp(item.subscription_code)} className="rounded-lg border px-3 py-1.5 text-left text-sm hover:bg-muted">
                      <span className="font-medium">{item.name}</span> <span className="font-mono text-xs text-muted-foreground">{item.subscription_code}</span> <span className="text-xs text-muted-foreground">· {item.role}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </CardContent></Card>
          ) : null}

          {report.workspace_overviews?.length ? report.workspace_overviews.map((overview) => <WorkspaceOverviewCard key={overview.workspace_id} overview={overview} days={report.since_days} />) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat icon={Activity} label="Page views" value={number(totals.page_views)} />
            <Stat icon={MousePointerClick} label="Feature actions" value={number(totals.actions)} />
            <Stat icon={Users} label="Active users" value={number(totals.active_users)} />
            <Stat
              icon={Building2}
              label="Active workspaces"
              value={totals.total_workspaces !== undefined ? `${number(totals.active_workspaces)} of ${number(totals.total_workspaces)}` : number(totals.active_workspaces)}
              detail={totals.total_workspaces !== undefined ? `${number(totals.new_workspaces)} new sign-ups in this period` : undefined}
            />
            <Stat icon={Clock} label="Last activity" value={dateTime(totals.last_activity_at)} small />
          </div>

          <Card>
            <CardHeader><CardTitle>Daily activity</CardTitle><CardDescription>Page views plus feature actions per day (IST). Hover a bar for the day.</CardDescription></CardHeader>
            <CardContent><DailyActivity daily={report.daily} days={report.since_days} /></CardContent>
          </Card>

          {scope.type === "platform" && report.extras ? <><div className="grid gap-3 sm:grid-cols-2"><Stat icon={Users} label="Anonymous site views" value={number(report.extras.anonymous_site_views)} detail="One browser per day across the whole site" /><Stat icon={Users} label="New users" value={number(report.extras.new_users.length)} detail="Includes signup email list below" /></div><NewUserSignups extras={report.extras} />{report.extras.signup_methods ? <SignupMethods days={report.extras.signup_methods} /> : null}{report.extras.setup_pending ? <SetupPendingUsers users={report.extras.setup_pending} onSetUp={onSetUpUser} /> : null}</> : null}

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Most used pages</CardTitle><CardDescription>Ranked by page views.</CardDescription></CardHeader>
              <CardContent>
                <RankedBars
                  empty="No page views in this period."
                  rows={report.pages.map((page) => ({ key: page.name, label: pageLabel(page.name), value: page.views, detail: `${number(page.users)} users · ${number(page.workspaces)} workspaces` }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Most used features</CardTitle><CardDescription>Ranked by times used. Bulk actions also show the number of items.</CardDescription></CardHeader>
              <CardContent>
                <RankedBars
                  empty="No feature actions in this period."
                  rows={report.features.map((feature) => ({
                    key: feature.name,
                    label: featureLabel(feature.name),
                    value: feature.uses,
                    detail: `${Number(feature.items) !== feature.uses ? `${number(feature.items)} items · ` : ""}${number(feature.users)} users`,
                  }))}
                />
              </CardContent>
            </Card>
          </div>

          {scope.type !== "workspace" ? (
            <Card>
              <CardHeader><CardTitle>Most active subscribers</CardTitle><CardDescription>Click a row to see that workspace's usage.</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Workspace</TableHead><TableHead>Subscription code</TableHead><TableHead>Owner</TableHead><TableHead className="text-right">Events</TableHead><TableHead className="text-right">Actions</TableHead><TableHead className="text-right">Users</TableHead><TableHead>Last seen</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {report.workspaces.length ? report.workspaces.map((item) => (
                      <TableRow key={item.workspace_id} className="cursor-pointer" onClick={() => lookUp(item.subscription_code)}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="font-mono text-xs">{item.subscription_code}</TableCell>
                        <TableCell className="text-muted-foreground">{item.owner_email || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{number(item.events)}</TableCell>
                        <TableCell className="text-right tabular-nums">{number(item.actions)}</TableCell>
                        <TableCell className="text-right tabular-nums">{number(item.users)}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(item.last_seen_at)}</TableCell>
                      </TableRow>
                    )) : <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground">No workspace activity in this period.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {scope.type === "platform" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MoonStar className="size-4" />Inactive workspaces ({number(report.inactive_workspaces.length)})</CardTitle>
                <CardDescription>Subscribers with no activity in this period — useful for follow-ups. &ldquo;Never&rdquo; means nothing has been recorded for them yet. Click a row to see that workspace.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Workspace</TableHead><TableHead>Subscription code</TableHead><TableHead>Owner</TableHead><TableHead>Signed up</TableHead><TableHead>Last activity</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {report.inactive_workspaces.length ? report.inactive_workspaces.map((item) => (
                      <TableRow key={item.workspace_id} className="cursor-pointer" onClick={() => lookUp(item.subscription_code)}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="font-mono text-xs">{item.subscription_code}</TableCell>
                        <TableCell className="text-muted-foreground">{item.owner_email || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(item.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</TableCell>
                        <TableCell className="whitespace-nowrap">{item.last_activity_at ? dateTime(item.last_activity_at) : <Badge variant="outline">Never</Badge>}</TableCell>
                        <TableCell><Badge variant={item.status === "active" ? "secondary" : "destructive"} className="capitalize">{item.status}</Badge></TableCell>
                      </TableRow>
                    )) : <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground">Every workspace was active in this period.</TableCell></TableRow>}
                  </TableBody>
                </Table>
                {report.inactive_workspaces.length >= 500 ? <p className="mt-3 text-xs text-muted-foreground">Showing the first 500.</p> : null}
              </CardContent>
            </Card>
          ) : null}

          {scope.type !== "user" ? (
            <Card>
              <CardHeader><CardTitle>{scope.type === "workspace" ? "Users in this workspace" : "Most active users"}</CardTitle><CardDescription>Click a row to see that user's usage.</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Email</TableHead><TableHead className="text-right">Events</TableHead><TableHead className="text-right">Actions</TableHead><TableHead>Last page</TableHead><TableHead>Last seen</TableHead><TableHead><span className="sr-only">Test account</span></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {report.users.length ? report.users.map((item) => (
                      <TableRow key={item.user_id} className={cn(item.email && "cursor-pointer")} onClick={() => item.email && lookUp(item.email)}>
                        <TableCell className="font-medium">{item.email || item.user_id}</TableCell>
                        <TableCell className="text-right tabular-nums">{number(item.events)}</TableCell>
                        <TableCell className="text-right tabular-nums">{number(item.actions)}</TableCell>
                        <TableCell className="text-muted-foreground">{item.last_page ? pageLabel(item.last_page) : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(item.last_seen_at)}</TableCell>
                        <TableCell className="text-right">
                          {item.email && !testAccountIds.has(item.user_id) ? (
                            <Button type="button" size="sm" variant="ghost" disabled={testAccountsBusy} title="Mark as a test account and hide from analytics" onClick={(event) => { event.stopPropagation(); void excludeTestAccount(item.email!) }}><EyeOff />Hide</Button>
                          ) : testAccountIds.has(item.user_id) ? <Badge variant="outline">Test account</Badge> : null}
                        </TableCell>
                      </TableRow>
                    )) : <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground">No user activity in this period.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {scope.type !== "platform" ? (
            <Card>
              <CardHeader><CardTitle>Recent activity</CardTitle><CardDescription>Latest 100 events, newest first.</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Type</TableHead><TableHead>Page / feature</TableHead><TableHead>User</TableHead><TableHead>Workspace</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {report.recent.length ? report.recent.map((item, index) => (
                      <TableRow key={`${item.occurred_at}-${index}`}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(item.occurred_at)}</TableCell>
                        <TableCell><Badge variant={item.event_type === "action" ? "default" : "outline"}>{item.event_type === "action" ? "Feature" : "Page"}</Badge></TableCell>
                        <TableCell>{item.event_type === "action" ? featureLabel(item.event_name) : pageLabel(item.event_name)}</TableCell>
                        <TableCell className="text-muted-foreground">{item.email || "—"}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{item.subscription_code || "—"}</TableCell>
                      </TableRow>
                    )) : <TableRow><TableCell colSpan={5} className="h-20 text-center text-muted-foreground">No activity in this period.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
