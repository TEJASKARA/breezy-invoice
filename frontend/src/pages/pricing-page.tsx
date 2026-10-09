import { customerErrorMessage } from "@/lib/customer-errors"
import { useCallback, useEffect, useState } from "react"
import { Calculator, Check, Coins, CreditCard, Download, Users } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  createBillingOrder,
  loadBillingHistory,
  loadRazorpayCheckout,
  openRazorpayCheckout,
  verifyBillingPayment,
  type BillingPayment,
  type BillingPlanKey,
  type CustomPlanUsage,
} from "@/lib/billing-api"
import { downloadBillingInvoice } from "@/lib/billing-invoice-pdf"
import { useWorkspaceAccess } from "@/lib/workspace-access"

const fixedPlans = [
  { key: "monthly" as const, name: "Monthly", price: "₹100", term: "1 month", credits: 200, bonus: 20, seats: "Owner + 2", description: "₹18 GST is added at checkout. Total payable: ₹118." },
  { key: "quarterly" as const, name: "Quarterly", price: "₹300", term: "3 months", credits: 625, bonus: 25, seats: "Owner + 2", description: "₹54 GST is added at checkout. Total payable: ₹354." },
  { key: "annual" as const, name: "Annual", price: "₹1,200", term: "12 months", credits: 2600, bonus: 30, seats: "Owner + 2", description: "₹216 GST is added at checkout. Total payable: ₹1,416." },
]

const customDurations = [
  { key: "custom_monthly" as const, label: "Monthly · 20% extra", months: 1, bonus: 20 },
  { key: "custom_quarterly" as const, label: "Quarterly · 25% extra", months: 3, bonus: 25 },
  { key: "custom_annual" as const, label: "Annual · 30% extra", months: 12, bonus: 30 },
]

function currency(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value)
}

function readableDate(value: string | null) {
  if (!value) return "Not set"
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value))
}

export function PricingPage() {
  const { user, workspace, membership, subscription, creditAccount, refresh } = useWorkspaceAccess()
  const [billingPayments, setBillingPayments] = useState<BillingPayment[]>([])
  const [purchasingPlan, setPurchasingPlan] = useState<BillingPlanKey | null>(null)
  const [customMonthlyInvoices, setCustomMonthlyInvoices] = useState("")
  const [customEmployees, setCustomEmployees] = useState("")
  const [customPlanKey, setCustomPlanKey] = useState<"custom_monthly" | "custom_quarterly" | "custom_annual">("custom_monthly")
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const isOwner = membership?.role === "owner"
  const documentCreditsRemaining = creditAccount
    ? Math.max(0, creditAccount.free_credits_granted - creditAccount.free_credits_used) + creditAccount.monthly_credits_remaining + creditAccount.topup_credits_remaining
    : 10
  const quotationCreditsRemaining = creditAccount
    ? Math.max(0, (creditAccount.free_quotation_credits_granted ?? creditAccount.free_credits_granted) - (creditAccount.free_quotation_credits_used ?? 0))
      + (creditAccount.monthly_quotation_credits_remaining ?? creditAccount.monthly_credits_remaining)
      + (creditAccount.topup_quotation_credits_remaining ?? creditAccount.topup_credits_remaining)
    : 10
  const customInvoiceCount = Math.max(0, Math.floor(Number(customMonthlyInvoices) || 0))
  const customEmployeeCount = Math.max(0, Math.floor(Number(customEmployees) || 0))
  const customExpectedDocuments = customInvoiceCount + customEmployeeCount
  const customDuration = customDurations.find((duration) => duration.key === customPlanKey) || customDurations[0]
  const customRawMonthlyPrice = customExpectedDocuments * 0.6
  const customMonthlyPrice = customExpectedDocuments > 0 ? Math.max(100, customRawMonthlyPrice) : 0
  const customTotalCredits = Math.ceil(customExpectedDocuments * customDuration.months * (1 + customDuration.bonus / 100))
  const customSubtotal = customMonthlyPrice * customDuration.months
  const customGst = Math.round(customSubtotal * 18) / 100
  const customTotalPrice = customSubtotal + customGst

  const refreshBillingHistory = useCallback(async () => {
    if (!workspace || !isOwner) return
    try {
      setBillingPayments(await loadBillingHistory(workspace.id))
    } catch {
      setBillingPayments([])
    }
  }, [workspace, isOwner])

  useEffect(() => { void refreshBillingHistory() }, [refreshBillingHistory])

  function showSuccess(message: string) { setNotice(message); setError("") }
  function showError(value: unknown) { setError(customerErrorMessage(value, "The payment could not be completed.")); setNotice("") }

  async function purchasePlan(planKey: BillingPlanKey, usage?: CustomPlanUsage) {
    if (!workspace || !isOwner) return
    setPurchasingPlan(planKey)
    setNotice("")
    setError("")
    try {
      const [order] = await Promise.all([
        createBillingOrder(workspace.id, planKey, usage),
        loadRazorpayCheckout(),
      ])
      await new Promise<void>((resolve, reject) => {
        openRazorpayCheckout({
          key: order.key_id,
          amount: order.amount,
          currency: order.currency,
          name: "ChanaX",
          description: `${order.plan_name} · includes ${currency(order.gst_amount_paise / 100)} GST`,
          order_id: order.order_id,
          prefill: { name: String(user?.user_metadata?.full_name || ""), email: user?.email || "" },
          theme: { color: "#0f172a" },
          handler: async (payment) => {
            try {
              const result = await verifyBillingPayment(workspace.id, payment)
              await Promise.all([refresh(), refreshBillingHistory()])
              showSuccess(result.already_processed
                ? "Payment was already confirmed. Your subscription is active."
                : `Payment confirmed. ${result.credits_added} document credits and ${result.quotation_credits_added} quotation credits were added.`)
              resolve()
            } catch (verificationError) {
              reject(verificationError)
            }
          },
          modal: { ondismiss: () => reject(new Error("Payment checkout was closed. No credits were added.")) },
        })
      })
    } catch (purchaseError) {
      showError(purchaseError)
    } finally {
      setPurchasingPlan(null)
    }
  }

  async function downloadPaymentInvoice(payment: BillingPayment) {
    if (!workspace) return
    try {
      await downloadBillingInvoice({ payment, workspaceName: workspace.name, customerEmail: user?.email })
    } catch (downloadError) {
      showError(downloadError)
    }
  }

  if (!workspace || !membership) return <p className="text-sm text-muted-foreground">Loading pricing…</p>

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Plans and billing" title="Pricing" description="Choose a fixed plan or build one around your expected monthly usage." />

      {notice ? <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</div> : null}
      {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}
      {!isOwner ? <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">You can review pricing and balances. Only the workspace owner can purchase a plan.</div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardTitle>Current plan</CardTitle><CardDescription>Subscription status for {workspace.name}.</CardDescription></CardHeader><CardContent className="space-y-2"><div className="flex items-center justify-between"><span className="text-muted-foreground">Plan</span><span className="font-semibold capitalize">{subscription?.plan_key?.replaceAll("_", " ") || "Free"}</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><Badge variant="outline" className="capitalize">{subscription?.status || "Active"}</Badge></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Expires</span><span>{readableDate(subscription?.current_period_ends_at || subscription?.trial_ends_at || null)}</span></div></CardContent></Card>
        <Card><CardHeader><CardTitle>Document credits</CardTitle><CardDescription>Shared by invoices and payslips.</CardDescription></CardHeader><CardContent><p className="text-4xl font-bold tabular-nums">{documentCreditsRemaining}</p><p className="mt-2 text-sm text-muted-foreground">credits remaining</p></CardContent></Card>
        <Card><CardHeader><CardTitle>Quotation credits</CardTitle><CardDescription>Reserved for quotations and proformas.</CardDescription></CardHeader><CardContent><p className="text-4xl font-bold tabular-nums">{quotationCreditsRemaining}</p><p className="mt-2 text-sm text-muted-foreground">credits remaining</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="size-4" />Fixed plans</CardTitle><CardDescription>Choose the prepaid plan that fits your usage and billing period.</CardDescription></CardHeader>
        <CardContent><div className="grid gap-4 lg:grid-cols-3">{fixedPlans.map((plan) => <div key={plan.name} className="flex h-full flex-col rounded-xl border p-5"><h3 className="text-lg font-semibold">{plan.name}</h3><p className="mt-3 text-3xl font-bold">{plan.price}<span className="text-sm font-normal text-muted-foreground"> / {plan.term}</span></p><p className="mt-2 text-sm text-muted-foreground">{plan.description}</p><div className="mt-5 flex-1 space-y-2 text-sm"><p className="flex items-center gap-2"><Coins className="size-4" /><strong>{plan.credits}</strong> document credits for invoices or payslips</p><p className="flex items-center gap-2"><Coins className="size-4" /><strong>{plan.credits}</strong> separate quotation credits</p><p className="flex items-center gap-2"><Check className="size-4" /><strong>{plan.bonus}%</strong> additional credits included</p><p className="flex items-center gap-2"><Users className="size-4" /><strong>{plan.seats}</strong> included accounts</p><p className="flex items-center gap-2"><Check className="size-4" />Quotation credits are only for proformas</p><p className="flex items-center gap-2"><Check className="size-4" />Attendance, expenses and exports</p></div><Button className="mt-5 w-full" variant="outline" disabled={!isOwner || purchasingPlan !== null} onClick={() => void purchasePlan(plan.key)}>{purchasingPlan === plan.key ? "Opening Razorpay…" : isOwner ? `Choose ${plan.name}` : "Owner payment only"}</Button></div>)}</div><div className="mt-4 space-y-1 text-xs text-muted-foreground"><p>Both paid credit balances expire at the end of the selected plan period. Quotation credits cannot be used for sales invoices or payslips.</p><p>Payments are processed by Razorpay. Credits are added only after secure server verification.</p><p>Additional team accounts will be available as a recurring monthly add-on after its price is finalised.</p></div></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="size-4" />Build a custom plan</CardTitle><CardDescription>Tell us your expected monthly invoices and employees. Monthly plans include 20% extra credits, quarterly plans 25%, and annual plans 30%.</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="custom-monthly-invoices">Invoices generated each month</Label><Input id="custom-monthly-invoices" inputMode="numeric" min="0" step="1" type="number" value={customMonthlyInvoices} onChange={(event) => setCustomMonthlyInvoices(event.target.value)} placeholder="For example, 100" /></div>
            <div className="space-y-2"><Label htmlFor="custom-employees">Number of employees</Label><Input id="custom-employees" inputMode="numeric" min="0" step="1" type="number" value={customEmployees} onChange={(event) => setCustomEmployees(event.target.value)} placeholder="For example, 100" /><p className="text-xs text-muted-foreground">One monthly payslip credit per employee.</p></div>
            <div className="space-y-2"><Label htmlFor="custom-duration">Billing period</Label><select id="custom-duration" value={customPlanKey} onChange={(event) => setCustomPlanKey(event.target.value as typeof customPlanKey)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{customDurations.map((duration) => <option key={duration.key} value={duration.key}>{duration.label}</option>)}</select></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-muted/30 p-4"><p className="text-xs font-medium text-muted-foreground">Monthly requirement</p><p className="mt-2 text-2xl font-semibold tabular-nums">{customExpectedDocuments}</p><p className="mt-1 text-xs text-muted-foreground">Invoices + employees</p></div>
            <div className="rounded-xl border bg-muted/30 p-4"><p className="text-xs font-medium text-muted-foreground">Document credits</p><p className="mt-2 text-2xl font-semibold tabular-nums">{customTotalCredits}</p><p className="mt-1 text-xs text-muted-foreground">Includes {customDuration.bonus}% additional credits</p></div>
            <div className="rounded-xl border bg-muted/30 p-4"><p className="text-xs font-medium text-muted-foreground">Quotation credits</p><p className="mt-2 text-2xl font-semibold tabular-nums">{customTotalCredits}</p><p className="mt-1 text-xs text-muted-foreground">Separate quotation-only balance</p></div>
            <div className="rounded-xl border border-primary/40 bg-primary/5 p-4"><p className="text-xs font-medium text-muted-foreground">Total for {customDuration.months} {customDuration.months === 1 ? "month" : "months"}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{currency(customTotalPrice)}</p><p className="mt-1 text-xs text-muted-foreground">₹0.60 per expected document; minimum ₹100/month</p></div>
          </div>
          {customExpectedDocuments > 0 && customRawMonthlyPrice < 100 ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">Your calculated monthly usage price is {currency(customRawMonthlyPrice)}. The ₹100 monthly minimum applies.</p> : null}
          {customExpectedDocuments > 0 ? <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">Base price: <strong className="text-foreground">{currency(customSubtotal)}</strong> · GST (18%): <strong className="text-foreground">{currency(customGst)}</strong> · Total payable: <strong className="text-foreground">{currency(customTotalPrice)}</strong></p> : null}
          <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">Credits remain available until the end of the selected prepaid period.</p><Button disabled={!isOwner || purchasingPlan !== null || customExpectedDocuments < 1} onClick={() => void purchasePlan(customPlanKey, { monthlyInvoices: customInvoiceCount, employees: customEmployeeCount })}>{purchasingPlan === customPlanKey ? "Opening Razorpay…" : isOwner ? `Purchase custom plan · ${currency(customTotalPrice)}` : "Owner payment only"}</Button></div>
        </CardContent>
      </Card>

      {billingPayments.length ? <Card><CardHeader><CardTitle>Payment history</CardTitle><CardDescription>Your latest Razorpay plan purchases.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Plan</TableHead><TableHead>Document credits</TableHead><TableHead>Quotation credits</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Invoice</TableHead></TableRow></TableHeader><TableBody>{billingPayments.map((payment) => <TableRow key={payment.id}><TableCell>{readableDate(payment.paid_at || payment.created_at)}</TableCell><TableCell className="capitalize">{payment.plan_key.replaceAll("_", " ")}</TableCell><TableCell>{payment.credits}</TableCell><TableCell>{payment.credits}</TableCell><TableCell>{currency(payment.amount_paise / 100)}</TableCell><TableCell><Badge variant={payment.status === "paid" ? "secondary" : payment.status === "failed" ? "destructive" : "outline"} className="capitalize">{payment.status}</Badge></TableCell><TableCell className="text-right">{payment.status === "paid" ? <Button size="sm" variant="outline" onClick={() => void downloadPaymentInvoice(payment)}><Download />Download</Button> : <span className="text-xs text-muted-foreground">Available after payment</span>}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card> : null}
    </div>
  )
}
