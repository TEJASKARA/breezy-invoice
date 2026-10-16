import { customerErrorMessage } from "@/lib/customer-errors"
import { useCallback, useEffect, useState } from "react"
import { Check, Coins, CreditCard, Download, Mail, Users } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  createBillingOrder,
  loadBillingHistory,
  loadRazorpayCheckout,
  openRazorpayCheckout,
  verifyBillingPayment,
  type BillingPayment,
  type BillingPlanKey,
} from "@/lib/billing-api"
import { downloadBillingInvoice } from "@/lib/billing-invoice-pdf"
import { useWorkspaceAccess } from "@/lib/workspace-access"

const fixedPlans = [
  { key: "monthly" as const, name: "Monthly", price: 100, term: "1 month", credits: 200, bonus: 20, seats: "Owner + 2", description: "₹18 GST is added at checkout. Total payable: ₹118." },
  { key: "quarterly" as const, name: "Quarterly", price: 300, term: "3 months", credits: 625, bonus: 25, seats: "Owner + 2", description: "₹54 GST is added at checkout. Total payable: ₹354." },
  { key: "annual" as const, name: "Annual", price: 1200, term: "12 months", credits: 2600, bonus: 30, seats: "Owner + 2", description: "₹216 GST is added at checkout. Total payable: ₹1,416." },
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

  async function purchasePlan(planKey: BillingPlanKey) {
    if (!workspace || !isOwner) return
    setPurchasingPlan(planKey)
    setNotice("")
    setError("")
    try {
      const [order] = await Promise.all([
        createBillingOrder(workspace.id, planKey),
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
      <PageHeader eyebrow="Plans and billing" title="Pricing" description="Choose a plan for your workspace, or contact us to discuss your business needs." />

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
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-3">
            {fixedPlans.map((plan) => (
              <div key={plan.name} className="flex h-full flex-col rounded-xl border p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <Badge className="border-primary/20 bg-primary/10 text-primary">50% off</Badge>
                </div>
                <div className="mt-3">
                  <p className="text-sm text-muted-foreground"><span className="sr-only">Regular price: </span><del>{currency(plan.price * 2)}</del></p>
                  <p className="mt-1 text-3xl font-bold"><span className="sr-only">Offer price: </span>{currency(plan.price)}<span className="text-sm font-normal text-muted-foreground"> / {plan.term}</span></p>
                  <p className="mt-1 text-xs font-medium text-primary">Offer price, excluding GST</p>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
                <div className="mt-5 flex-1 space-y-2 text-sm">
                  <p className="flex items-center gap-2"><Coins className="size-4" /><strong>{plan.credits}</strong> document credits for invoices or payslips</p>
                  <p className="flex items-center gap-2"><Coins className="size-4" /><strong>{plan.credits}</strong> separate quotation credits</p>
                  <p className="flex items-center gap-2"><Check className="size-4" /><strong>{plan.bonus}%</strong> additional credits included</p>
                  <p className="flex items-center gap-2"><Users className="size-4" /><strong>{plan.seats}</strong> included accounts</p>
                  <p className="flex items-center gap-2"><Check className="size-4" />Quotation credits are only for proformas</p>
                  <p className="flex items-center gap-2"><Check className="size-4" />Attendance, expenses and exports</p>
                </div>
                <Button className="mt-5 w-full" variant="outline" disabled={!isOwner || purchasingPlan !== null} onClick={() => void purchasePlan(plan.key)}>{purchasingPlan === plan.key ? "Opening Razorpay…" : isOwner ? `Choose ${plan.name}` : "Owner payment only"}</Button>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-1 text-xs text-muted-foreground"><p>Both paid credit balances expire at the end of the selected plan period. Quotation credits cannot be used for sales invoices or payslips.</p><p>Payments are processed by Razorpay. Credits are added only after secure server verification.</p><p>Additional team accounts will be available as a recurring monthly add-on after its price is finalised.</p></div>
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="size-4" />Contact Us</CardTitle>
          <CardDescription>Need more credits, a larger team or help choosing a plan? Tell us what your business needs.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <a href="mailto:contact@azorix.com" className="break-all text-sm font-medium text-primary underline underline-offset-4">contact@azorix.com</a>
          <Button asChild className="w-full sm:w-auto"><a href="mailto:contact@azorix.com?subject=ChanaX%20plan%20enquiry"><Mail />Contact Us</a></Button>
        </CardContent>
      </Card>

      {billingPayments.length ? <Card><CardHeader><CardTitle>Payment history</CardTitle><CardDescription>Your latest Razorpay plan purchases.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Plan</TableHead><TableHead>Document credits</TableHead><TableHead>Quotation credits</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Invoice</TableHead></TableRow></TableHeader><TableBody>{billingPayments.map((payment) => <TableRow key={payment.id}><TableCell>{readableDate(payment.paid_at || payment.created_at)}</TableCell><TableCell className="capitalize">{payment.plan_key.replaceAll("_", " ")}</TableCell><TableCell>{payment.credits}</TableCell><TableCell>{payment.credits}</TableCell><TableCell>{currency(payment.amount_paise / 100)}</TableCell><TableCell><Badge variant={payment.status === "paid" ? "secondary" : payment.status === "failed" ? "destructive" : "outline"} className="capitalize">{payment.status}</Badge></TableCell><TableCell className="text-right">{payment.status === "paid" ? <Button size="sm" variant="outline" onClick={() => void downloadPaymentInvoice(payment)}><Download />Download</Button> : <span className="text-xs text-muted-foreground">Available after payment</span>}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card> : null}
    </div>
  )
}
