import { useCallback, useEffect, useState } from "react"
import { Activity, BarChart3, Building2, Clock, MousePointerClick, MoonStar, RefreshCw, Search, Users, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { loadUsageReport, type UsageReport } from "@/lib/platform-admin-api"
import { cn } from "@/lib/utils"

const PAGE_LABELS: Record<string, string> = {
  "/workspace": "Dashboard",
  "/entities": "Entities",
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

const PERIODS = [7, 30, 90, 365] as const
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

export function PlatformUsageAnalytics() {
  const [days, setDays] = useState<number>(30)
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
      setError(loadError instanceof Error ? loadError.message : "The usage report could not be loaded.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(days, activeQuery) }, [days, activeQuery, load])

  const lookUp = (identifier: string) => { setQueryInput(identifier); setActiveQuery(identifier.trim()) }
  const scope = report?.scope
  const totals = report?.totals

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BarChart3 className="size-4" />Usage analytics</CardTitle>
          <CardDescription>Which pages and features subscribers use. Search an email or subscription code to see one user or one workspace. Only you can see this; your own activity is excluded.</CardDescription>
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
          </div>
        </CardContent>
      </Card>

      {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}
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
                  <TableHeader><TableRow><TableHead>Email</TableHead><TableHead className="text-right">Events</TableHead><TableHead className="text-right">Actions</TableHead><TableHead>Last page</TableHead><TableHead>Last seen</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {report.users.length ? report.users.map((item) => (
                      <TableRow key={item.user_id} className={cn(item.email && "cursor-pointer")} onClick={() => item.email && lookUp(item.email)}>
                        <TableCell className="font-medium">{item.email || item.user_id}</TableCell>
                        <TableCell className="text-right tabular-nums">{number(item.events)}</TableCell>
                        <TableCell className="text-right tabular-nums">{number(item.actions)}</TableCell>
                        <TableCell className="text-muted-foreground">{item.last_page ? pageLabel(item.last_page) : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(item.last_seen_at)}</TableCell>
                      </TableRow>
                    )) : <TableRow><TableCell colSpan={5} className="h-20 text-center text-muted-foreground">No user activity in this period.</TableCell></TableRow>}
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
