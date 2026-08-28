import { Banknote, Download, FileText, IndianRupee, Paperclip, Plus, ReceiptText, Trash2, Upload, Users } from "lucide-react"
import { lazy, Suspense, type FormEvent, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { downloadExpenseBill, removeExpenseBill, uploadExpenseBill } from "@/lib/expense-bills"
import { useAuthUser } from "@/lib/use-auth-user"
import { useMvpStore } from "@/lib/mvp-store"
import { useWorkspaceAccess } from "@/lib/workspace-access"

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
const commonCategories = ["Office expenses", "Rent", "Utilities", "Travel", "Professional fees", "Software", "Repairs and maintenance", "Marketing", "Insurance", "Bank charges", "Taxes", "Miscellaneous"]
const supportedBillTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"])
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
const ExpenseAnalytics = lazy(() => import("@/components/expense-analytics").then((module) => ({ default: module.ExpenseAnalytics })))

function today() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(value: string) {
  if (!value) return "—"
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date)
}

function formatMonth(value: string) {
  if (!value) return "—"
  const date = new Date(`${value}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(date)
}

export function ExpensesPage() {
  const { user } = useAuthUser()
  const { companies, invoices, proformas, payslips, expenses, addExpense, deleteExpense } = useMvpStore()
  const { can } = useWorkspaceAccess()
  const canManage = can("expenses.manage")
  const [selectedEntityId, setSelectedEntityId] = useState("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [billFile, setBillFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [billBusyId, setBillBusyId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [draft, setDraft] = useState({
    entityId: companies[0]?.id || "",
    name: "",
    category: "",
    customCategory: "",
    vendorName: "",
    date: today(),
    amount: "",
    paymentStatus: "Paid" as "Paid" | "Pending",
    notes: "",
  })

  const selectedEntity = companies.find((company) => company.id === selectedEntityId)
  const companyNameById = useMemo(() => new Map(companies.map((company) => [company.id, company.companyName])), [companies])
  const categories = useMemo(() => [...new Set([...commonCategories, ...expenses.map((expense) => expense.category).filter(Boolean)])].sort(), [expenses])
  const visibleInvoices = useMemo(() => invoices.filter((invoice) => {
    const entityMatches = selectedEntityId === "all" || invoice.entityName === selectedEntity?.companyName
    return entityMatches && (!dateFrom || invoice.date >= dateFrom) && (!dateTo || invoice.date <= dateTo)
  }), [dateFrom, dateTo, invoices, selectedEntity?.companyName, selectedEntityId])
  const visibleProformas = useMemo(() => proformas.filter((proforma) => {
    const entityMatches = selectedEntityId === "all" || proforma.entityId === selectedEntityId
    return entityMatches && (!dateFrom || proforma.date >= dateFrom) && (!dateTo || proforma.date <= dateTo)
  }), [dateFrom, dateTo, proformas, selectedEntityId])
  const visiblePayslips = useMemo(() => payslips.filter((payslip) => {
    const entityMatches = selectedEntityId === "all" || payslip.entityId === selectedEntityId
    const month = payslip.month || payslip.paymentDate.slice(0, 7)
    return entityMatches && (!dateFrom || month >= dateFrom.slice(0, 7)) && (!dateTo || month <= dateTo.slice(0, 7))
  }), [dateFrom, dateTo, payslips, selectedEntityId])
  const visibleExpenses = useMemo(() => expenses.filter((expense) => {
    const entityMatches = selectedEntityId === "all" || expense.entityId === selectedEntityId
    const categoryMatches = categoryFilter === "all" || expense.category === categoryFilter
    return entityMatches && categoryMatches && (!dateFrom || expense.date >= dateFrom) && (!dateTo || expense.date <= dateTo)
  }), [categoryFilter, dateFrom, dateTo, expenses, selectedEntityId])

  const invoiceTotal = visibleInvoices.reduce((total, invoice) => total + invoice.amount, 0)
  const payrollTotal = visiblePayslips.reduce((total, payslip) => total + payslip.grossPay, 0)
  const otherExpenseTotal = visibleExpenses.reduce((total, expense) => total + expense.amount, 0)
  const combinedTotal = invoiceTotal + payrollTotal + otherExpenseTotal
  const summaries = [
    { label: "Invoice expenses", value: invoiceTotal, detail: `${visibleInvoices.length} invoice${visibleInvoices.length === 1 ? "" : "s"}`, icon: ReceiptText },
    { label: "Payroll expenses", value: payrollTotal, detail: `${visiblePayslips.length} payslip${visiblePayslips.length === 1 ? "" : "s"}`, icon: Users },
    { label: "Other expenses", value: otherExpenseTotal, detail: `${visibleExpenses.length} custom expense${visibleExpenses.length === 1 ? "" : "s"}`, icon: Banknote },
    { label: "Total expenses", value: combinedTotal, detail: selectedEntity?.companyName || "Across all entities", icon: IndianRupee },
  ]

  function openExpenseForm() {
    setDraft((current) => ({ ...current, entityId: current.entityId || companies[0]?.id || "" }))
    setError("")
    setNotice("")
    setShowForm(true)
  }

  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setNotice("")
    const amount = Number(draft.amount)
    const selectedCategory = draft.category === "__custom__" ? draft.customCategory.trim() : draft.category.trim()
    if (!draft.entityId || !draft.name.trim() || !selectedCategory || !draft.date || !Number.isFinite(amount) || amount <= 0) {
      setError("Select an entity and enter a valid expense name, category, date and amount.")
      return
    }
    if (billFile && (!supportedBillTypes.has(billFile.type) || billFile.size > 5 * 1024 * 1024)) {
      setError("The bill must be a PDF, JPG, PNG or WebP file smaller than 5 MB.")
      return
    }
    setSaving(true)
    let billPath: string | undefined
    try {
      if (billFile) {
        if (!user) throw new Error("Your login session could not be verified. Please sign in again.")
        billPath = await uploadExpenseBill(user.id, billFile)
      }
      await addExpense({
        entityId: draft.entityId,
        name: draft.name.trim(),
        category: selectedCategory,
        vendorName: draft.vendorName.trim(),
        date: draft.date,
        amount,
        paymentStatus: draft.paymentStatus,
        notes: draft.notes.trim(),
        billPath,
        billName: billFile?.name,
      })
      setDraft({ entityId: draft.entityId, name: "", category: "", customCategory: "", vendorName: "", date: today(), amount: "", paymentStatus: "Paid", notes: "" })
      setBillFile(null)
      setShowForm(false)
      setNotice("Expense saved successfully.")
    } catch (caught) {
      if (billPath) {
        try {
          await removeExpenseBill(billPath)
        } catch {
          // Keep the original save error visible; abandoned files can be cleaned up separately.
        }
      }
      setError(caught instanceof Error ? caught.message : "The expense could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  async function downloadBill(expenseId: string, path: string, name: string) {
    setBillBusyId(expenseId)
    setError("")
    try {
      await downloadExpenseBill(path, name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The bill could not be downloaded.")
    } finally {
      setBillBusyId(null)
    }
  }

  async function confirmDelete(expenseId: string) {
    const expense = expenses.find((item) => item.id === expenseId)
    setError("")
    try {
      if (expense?.billPath) await removeExpenseBill(expense.billPath)
      await deleteExpense(expenseId)
      setPendingDeleteId(null)
      setNotice("Expense deleted.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The expense could not be deleted.")
    }
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Expense management"
        title="Expenses"
        description="Track invoices, proformas, payroll and your own categorized business expenses in one place."
        actions={canManage ? <Button onClick={openExpenseForm} disabled={!companies.length}><Plus />Add expense</Button> : null}
      />

      {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div> : null}

      {!companies.length ? (
        <Card className="border-dashed"><CardContent className="flex flex-col items-center gap-3 py-10 text-center"><Banknote className="size-6 text-muted-foreground" /><div><p className="font-medium">No entity is available</p><p className="mt-1 text-sm text-muted-foreground">Every expense belongs to one of your companies.</p></div>{can("entities.manage") ? <Button asChild><Link to="/entities">Add entity</Link></Button> : null}</CardContent></Card>
      ) : null}

      {showForm && canManage ? (
        <Card>
          <CardHeader><CardTitle>Add another expense</CardTitle><CardDescription>Create your own category and optionally attach the supporting bill.</CardDescription></CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={saveExpense}>
              <div className="space-y-2"><Label htmlFor="custom-expense-entity">Company / entity *</Label><select id="custom-expense-entity" className={selectClass} required value={draft.entityId} onChange={(event) => setDraft((current) => ({ ...current, entityId: event.target.value }))}><option value="">Select an entity</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.companyName}</option>)}</select></div>
              <div className="space-y-2"><Label htmlFor="custom-expense-name">Expense name *</Label><Input id="custom-expense-name" required placeholder="Example: Office internet" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="custom-expense-category">Category *</Label><select id="custom-expense-category" className={selectClass} required value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value, customCategory: event.target.value === "__custom__" ? current.customCategory : "" }))}><option value="">Select a category</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}<option value="__custom__">Custom</option></select></div>
              {draft.category === "__custom__" ? <div className="space-y-2"><Label htmlFor="custom-expense-category-name">Custom category name *</Label><Input id="custom-expense-category-name" required autoFocus placeholder="Example: Client entertainment" value={draft.customCategory} onChange={(event) => setDraft((current) => ({ ...current, customCategory: event.target.value }))} /></div> : null}
              <div className="space-y-2"><Label htmlFor="custom-expense-vendor">Vendor / paid to</Label><Input id="custom-expense-vendor" placeholder="Vendor name" value={draft.vendorName} onChange={(event) => setDraft((current) => ({ ...current, vendorName: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="custom-expense-date">Expense date *</Label><Input id="custom-expense-date" type="date" required value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="custom-expense-amount">Amount (₹) *</Label><Input id="custom-expense-amount" type="number" inputMode="decimal" min="0.01" step="0.01" required placeholder="0.00" value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="custom-expense-status">Payment status</Label><select id="custom-expense-status" className={selectClass} value={draft.paymentStatus} onChange={(event) => setDraft((current) => ({ ...current, paymentStatus: event.target.value as "Paid" | "Pending" }))}><option value="Paid">Paid</option><option value="Pending">Pending</option></select></div>
              <div className="space-y-2 md:col-span-2"><Label htmlFor="custom-expense-bill">Attach bill</Label><Input id="custom-expense-bill" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setBillFile(event.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground">PDF, JPG, PNG or WebP, maximum 5 MB.</p></div>
              <div className="space-y-2 md:col-span-2 xl:col-span-3"><Label htmlFor="custom-expense-notes">Notes</Label><textarea id="custom-expense-notes" rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" placeholder="Optional description or payment reference" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></div>
              <div className="flex justify-end gap-2 md:col-span-2 xl:col-span-3"><Button type="button" variant="outline" onClick={() => { setShowForm(false); setBillFile(null); setError("") }}>Cancel</Button><Button type="submit" disabled={saving}><Upload />{saving ? "Saving…" : "Save expense"}</Button></div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2"><Label htmlFor="expense-entity">Company / entity</Label><select id="expense-entity" value={selectedEntityId} onChange={(event) => setSelectedEntityId(event.target.value)} className={selectClass}><option value="all">All entities</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.companyName}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="expense-category-filter">Other-expense category</Label><select id="expense-category-filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={selectClass}><option value="all">All categories</option>{categories.filter((category) => expenses.some((expense) => expense.category === category)).map((category) => <option key={category} value={category}>{category}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="expense-date-from">From date</Label><Input id="expense-date-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="expense-date-to">To date</Label><Input id="expense-date-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Expense summary">
        {summaries.map(({ label, value, detail, icon: Icon }) => <Card key={label}><CardContent className="p-5"><span className="mb-5 flex size-9 items-center justify-center rounded-lg bg-primary/8 text-primary"><Icon className="size-4" /></span><p className="text-2xl font-semibold tracking-tight">{currency.format(value)}</p><p className="mt-1 text-sm font-medium">{label}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>)}
      </section>

      <Suspense fallback={<div className="grid h-72 place-items-center rounded-xl border text-sm text-muted-foreground">Loading expense analytics…</div>}>
        <ExpenseAnalytics companies={companies} invoices={visibleInvoices} proformas={visibleProformas} payslips={visiblePayslips} expenses={visibleExpenses} />
      </Suspense>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Other expenses</CardTitle><CardDescription>Custom expenses and supporting bills for the selected entity.</CardDescription></div>{canManage ? <Button variant="outline" size="sm" onClick={openExpenseForm} disabled={!companies.length}><Plus />Add</Button> : null}</CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Expense</TableHead><TableHead>Category</TableHead><TableHead className="hidden md:table-cell">Entity / vendor</TableHead><TableHead className="hidden sm:table-cell">Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {visibleExpenses.length ? visibleExpenses.map((expense) => {
                const entityName = companyNameById.get(expense.entityId) || "Unknown entity"
                return <TableRow key={expense.id}><TableCell><p className="font-medium">{expense.name}</p>{expense.notes ? <p className="max-w-56 truncate text-xs text-muted-foreground" title={expense.notes}>{expense.notes}</p> : null}</TableCell><TableCell>{expense.category}</TableCell><TableCell className="hidden md:table-cell"><p>{entityName}</p><p className="text-xs text-muted-foreground">{expense.vendorName || "No vendor"}</p></TableCell><TableCell className="hidden sm:table-cell">{formatDate(expense.date)}</TableCell><TableCell><Badge variant={expense.paymentStatus === "Pending" ? "secondary" : "outline"}>{expense.paymentStatus}</Badge></TableCell><TableCell className="text-right font-medium">{currency.format(expense.amount)}</TableCell><TableCell className="text-right">{pendingDeleteId === expense.id && canManage ? <span className="inline-flex gap-1"><Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(null)}>Cancel</Button><Button size="sm" variant="destructive" onClick={() => void confirmDelete(expense.id)}>Confirm</Button></span> : <span className="inline-flex">{expense.billPath ? <Button size="icon" variant="ghost" aria-label={`Download bill for ${expense.name}`} disabled={billBusyId === expense.id} onClick={() => void downloadBill(expense.id, expense.billPath || "", expense.billName || "expense-bill")}><Download /></Button> : <span className="inline-flex size-8 items-center justify-center text-muted-foreground" title="No bill attached"><Paperclip className="size-4" /></span>}{canManage ? <Button size="icon" variant="ghost" aria-label={`Delete ${expense.name}`} onClick={() => setPendingDeleteId(expense.id)}><Trash2 /></Button> : null}</span>}</TableCell></TableRow>
              }) : <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No custom expenses found for this selection.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Invoice expenses</CardTitle><CardDescription>Invoice records for the selected entity.</CardDescription></div><Button variant="outline" size="sm" asChild><Link to="/invoices">Manage</Link></Button></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead className="hidden sm:table-cell">Date</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody>{visibleInvoices.length ? visibleInvoices.map((invoice) => <TableRow key={invoice.id}><TableCell><p className="font-medium">{invoice.number}</p><Badge className="mt-1" variant={invoice.status === "Draft" ? "secondary" : "outline"}>{invoice.status}</Badge></TableCell><TableCell>{invoice.companyName}</TableCell><TableCell className="hidden sm:table-cell">{formatDate(invoice.date)}</TableCell><TableCell className="text-right font-medium">{currency.format(invoice.amount)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground">No invoices found for this selection.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
        <Card><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Payroll expenses</CardTitle><CardDescription>Gross salary cost from generated and draft payslips.</CardDescription></div><Button variant="outline" size="sm" asChild><Link to="/employees">Manage</Link></Button></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Pay period</TableHead><TableHead className="hidden sm:table-cell">Status</TableHead><TableHead className="text-right">Gross pay</TableHead></TableRow></TableHeader><TableBody>{visiblePayslips.length ? visiblePayslips.map((payslip) => <TableRow key={payslip.id}><TableCell><p className="font-medium">{payslip.employeeName}</p><p className="text-xs text-muted-foreground">{payslip.employeeCode}</p></TableCell><TableCell>{formatMonth(payslip.month)}</TableCell><TableCell className="hidden sm:table-cell"><Badge variant={payslip.status === "Draft" ? "secondary" : "outline"}>{payslip.status}</Badge></TableCell><TableCell className="text-right font-medium">{currency.format(payslip.grossPay)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground">No payslips found for this selection.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
      </section>

      {!visibleInvoices.length && !visibleProformas.length && !visiblePayslips.length && !visibleExpenses.length ? <Card className="border-dashed"><CardContent className="flex flex-col items-center gap-3 py-10 text-center"><span className="flex size-11 items-center justify-center rounded-xl bg-muted"><FileText className="size-5 text-muted-foreground" /></span><div><p className="font-medium">No expense records yet</p><p className="mt-1 text-sm text-muted-foreground">Add an expense, invoice, proforma or payslip and it will appear here automatically.</p></div></CardContent></Card> : null}
    </div>
  )
}
