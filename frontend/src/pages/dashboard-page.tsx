import { Building2, CircleCheck, Clock3, Plus, ReceiptText, Upload, Users } from "lucide-react"
import { Link } from "react-router-dom"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuthUser } from "@/lib/use-auth-user"
import { useMvpStore } from "@/lib/mvp-store"
import { getSetupProgress } from "@/lib/setup-progress"
import { useWorkspaceAccess } from "@/lib/workspace-access"

export function DashboardPage() {
  const { user } = useAuthUser()
  const { can } = useWorkspaceAccess()
  const { setup, companies, invoices, payslips } = useMvpStore()
  const fullName = String(user?.user_metadata.full_name || user?.user_metadata.name || user?.email?.split("@")[0] || "there")
  const firstName = fullName.split(/\s+/)[0]
  const totalInvoiceValue = invoices.reduce((sum, invoice) => sum + invoice.amount, 0)
  const generatedInvoices = invoices.filter((invoice) => invoice.status === "Generated").length
  const generatedPayslips = payslips.filter((payslip) => payslip.status === "Generated").length
  const setupProgress = getSetupProgress({ hasLogin: Boolean(user), setup, companies, invoices, payslips })
  const showSetupProgress = setupProgress.completed < setupProgress.total
  const activity = [
    ...invoices.map((invoice) => ({ id: invoice.id, document: invoice.number, entity: invoice.companyName, type: "Invoice", amount: `₹${invoice.amount.toLocaleString("en-IN")}`, status: invoice.status, date: invoice.date })),
    ...payslips.map((payslip) => ({ id: payslip.id, document: `${payslip.month} payslip`, entity: payslip.employeeName, type: "Payslip", amount: `₹${payslip.netPay.toLocaleString("en-IN")}`, status: payslip.status, date: payslip.paymentDate || `${payslip.month}-01` })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)

  const cards = [
    { label: "Client companies", value: companies.length, detail: companies.length ? "Available for invoicing" : "Add your first company", icon: Building2 },
    { label: "Invoices", value: invoices.length, detail: `₹${totalInvoiceValue.toLocaleString("en-IN")} total value`, icon: ReceiptText },
    { label: "Payslips", value: payslips.length, detail: `${generatedPayslips} generated`, icon: Users },
    { label: "Generated documents", value: generatedInvoices + generatedPayslips, detail: "Ready for the next export step", icon: CircleCheck },
  ]

  return <div className="space-y-7">
    <PageHeader eyebrow={new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date())} title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${firstName}`} description={`Here’s what is happening in ${setup?.firmName || "your BreezyInvoice workspace"}.`} actions={<>{can("entities.manage") ? <Button variant="outline" asChild><Link to="/entities"><Upload />Import companies</Link></Button> : null}{can("invoices.manage") ? <Button asChild><Link to="/invoices"><Plus />New invoice</Link></Button> : null}</>} />
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, detail, icon: Icon }) => <Card key={label}><CardContent className="p-5"><span className="mb-5 flex size-9 items-center justify-center rounded-lg bg-primary/8 text-primary"><Icon className="size-4" /></span><p className="text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-sm font-medium">{label}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>)}</section>
    <section className={showSetupProgress ? "grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.7fr)]" : "grid gap-5"}><Card><CardHeader><CardTitle>Recent activity</CardTitle><CardDescription>Documents created by this signed-in account</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Document</TableHead><TableHead className="hidden md:table-cell">Company / employee</TableHead><TableHead className="hidden sm:table-cell">Type</TableHead><TableHead>Amount</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader><TableBody>{activity.length ? activity.map((item) => <TableRow key={item.id}><TableCell className="font-medium">{item.document}</TableCell><TableCell className="hidden text-muted-foreground md:table-cell">{item.entity}</TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{item.type}</TableCell><TableCell>{item.amount}</TableCell><TableCell className="text-right"><Badge variant={item.status === "Draft" ? "secondary" : "outline"}>{item.status === "Draft" ? <Clock3 /> : <CircleCheck className="text-emerald-600" />}{item.status}</Badge></TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-48 text-center text-muted-foreground">No records yet. Add a company, then create your first invoice or payslip.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
      {showSetupProgress ? <Card><CardHeader><CardTitle>Complete your setup</CardTitle><CardDescription>Your progress is unique to this account.</CardDescription></CardHeader><CardContent className="space-y-5"><div><div className="mb-2 flex justify-between text-xs"><span className="font-medium">{setupProgress.completed} of {setupProgress.total} complete</span><span className="text-muted-foreground">{setupProgress.percentage}%</span></div><Progress value={setupProgress.percentage} /></div><div className="space-y-3">{setupProgress.steps.map((step) => <SetupItem key={step.id} done={step.done} label={step.label} />)}</div></CardContent></Card> : null}
    </section>
  </div>
}

function SetupItem({ label, done = false }: { label: string; done?: boolean }) { return <div className="flex items-center gap-3 text-sm"><span className={done ? "flex size-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" : "size-5 rounded-full border-2 border-muted-foreground/25"}>{done && <CircleCheck className="size-3.5" />}</span><span className={done ? "text-muted-foreground line-through" : "font-medium"}>{label}</span></div> }
