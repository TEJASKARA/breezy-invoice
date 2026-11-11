import { useCallback, useEffect, useMemo, useState } from "react"
import { Ban, Check, Copy, ExternalLink, Link2, LoaderCircle, MessageCircle, RefreshCw, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { customerErrorMessage } from "@/lib/customer-errors"
import { cancelPaymentLink, createPaymentLink, findSetupTarget, listPaymentLinks, refreshPaymentLink, type PaymentLink, type SetupTarget } from "@/lib/platform-admin-api"

const GST_RATE_PERCENT = 18
const MONTH_OPTIONS = [1, 3, 6, 12, 24, 36]
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Same rounding as the API so the screen matches what Razorpay charges. */
const gstFor = (basePaise: number) => Math.floor((basePaise * GST_RATE_PERCENT + 50) / 100)
const statusStyle: Record<PaymentLink["status"], string> = {
  creating: "border-muted-foreground/30 text-muted-foreground",
  created: "border-blue-300 text-blue-700 dark:text-blue-300",
  paid: "border-emerald-300 text-emerald-700 dark:text-emerald-300",
  cancelled: "border-muted-foreground/30 text-muted-foreground",
  expired: "border-muted-foreground/30 text-muted-foreground",
  failed: "border-red-300 text-red-700 dark:text-red-300",
}
const statusLabel: Record<PaymentLink["status"], string> = { creating: "Creating", created: "Awaiting payment", paid: "Paid", cancelled: "Cancelled", expired: "Expired", failed: "Failed" }

function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }).catch(() => undefined)}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : label}</Button>
}

function whatsAppShare(link: PaymentLink) {
  const text = `Hi ${link.customer_name || ""}, here is your ChanaX payment link for ${link.credits} credits (${link.duration_months} month${link.duration_months === 1 ? "" : "s"}): ${rupees(link.amount_paise)} incl. GST. ${link.short_url}`
  const phone = (link.customer_phone || "").replace(/\D/g, "")
  return `https://wa.me/${phone}?text=${encodeURIComponent(text.replace(/\s+/g, " ").trim())}`
}

/** Platform admin: price a custom quote and send a Razorpay payment link. */
export function AdminPaymentLinks() {
  const [query, setQuery] = useState("")
  const [target, setTarget] = useState<SetupTarget | null>(null)
  const [finding, setFinding] = useState(false)
  const [amount, setAmount] = useState("")
  const [credits, setCredits] = useState("")
  const [months, setMonths] = useState(12)
  const [description, setDescription] = useState("")
  const [descriptionEdited, setDescriptionEdited] = useState(false)
  const [notify, setNotify] = useState(true)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<PaymentLink | null>(null)
  const [error, setError] = useState("")
  const [links, setLinks] = useState<PaymentLink[]>([])
  const [listError, setListError] = useState("")
  const [rowBusy, setRowBusy] = useState("")

  const basePaise = Math.round((Number.parseFloat(amount) || 0) * 100)
  const gstPaise = gstFor(basePaise)
  const totalPaise = basePaise + gstPaise
  const creditCount = Number.parseInt(credits, 10) || 0
  const autoDescription = useMemo(() => `ChanaX custom plan: ${creditCount || "—"} credits for invoices, quotations and payslips for ${months} month${months === 1 ? "" : "s"}${target?.workspace_name ? ` for ${target.workspace_name}` : ""}`, [creditCount, months, target])
  const finalDescription = descriptionEdited ? description : autoDescription

  const loadLinks = useCallback(async () => {
    try {
      setLinks(await listPaymentLinks())
      setListError("")
    } catch (caught) {
      setListError(customerErrorMessage(caught, "Payment links could not be loaded."))
    }
  }, [])

  useEffect(() => { void loadLinks() }, [loadLinks])

  async function find(event: React.FormEvent) {
    event.preventDefault()
    if (query.trim().length < 3) return setError("Enter the subscriber's email or subscription code.")
    setFinding(true)
    setError("")
    setTarget(null)
    setCreated(null)
    try {
      const found = await findSetupTarget(query.trim())
      if (!found.workspace_id || !found.subscription_code) throw new Error("This user does not own a ChanaX workspace.")
      setTarget(found)
    } catch (caught) {
      setError(customerErrorMessage(caught, "The subscriber could not be found."))
    } finally {
      setFinding(false)
    }
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault()
    if (!target?.subscription_code) return setError("Find the subscriber first.")
    if (basePaise < 100) return setError("Enter an amount of at least ₹1.")
    if (creditCount < 1) return setError("Enter how many credits this quote includes.")
    if (finalDescription.trim().length < 3) return setError("Enter a description for the payment link.")
    setCreating(true)
    setError("")
    try {
      const link = await createPaymentLink({ subscriptionCode: target.subscription_code, baseAmountPaise: basePaise, credits: creditCount, durationMonths: months, description: finalDescription, notifyCustomer: notify })
      setCreated(link)
      void loadLinks()
    } catch (caught) {
      setError(customerErrorMessage(caught, "The payment link could not be created."))
    } finally {
      setCreating(false)
    }
  }

  async function rowAction(link: PaymentLink, action: "refresh" | "cancel") {
    setRowBusy(`${action}:${link.id}`)
    setListError("")
    try {
      const updated = action === "refresh" ? await refreshPaymentLink(link.id) : await cancelPaymentLink(link.id)
      setLinks((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item))
    } catch (caught) {
      setListError(customerErrorMessage(caught, action === "refresh" ? "The status could not be checked." : "The link could not be cancelled."))
    } finally {
      setRowBusy("")
    }
  }

  return <div className="space-y-5">
    <Card>
      <CardHeader>
        <CardTitle>Custom quote payment link</CardTitle>
        <CardDescription>Price a custom quote, add 18% GST, and send a Razorpay payment link. When the user pays, the credits and months are added to their workspace automatically.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={find}>
          <Label htmlFor="link-subscriber" className="sr-only">Subscriber email or subscription code</Label>
          <Input id="link-subscriber" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Subscriber email or subscription code" autoComplete="off" />
          <Button type="submit" variant="outline" disabled={finding}>{finding ? <LoaderCircle className="animate-spin" /> : <Search />}Find subscriber</Button>
        </form>

        {target ? <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Workspace</p><p className="font-medium">{target.workspace_name || "—"}</p><p className="font-mono text-xs text-muted-foreground">{target.subscription_code}</p></div>
          <div><p className="text-xs text-muted-foreground">Contact</p><p className="font-medium">{target.full_name || "—"}</p></div>
          <div><p className="text-xs text-muted-foreground">Email</p><p className="break-all font-medium">{target.email || "Not added"}</p></div>
          <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{target.phone || "Not added"}</p></div>
        </div> : null}

        {target ? <form onSubmit={generate} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="link-amount">Price (₹, before GST)</Label><Input id="link-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} placeholder="5000" /></div>
            <div className="space-y-2"><Label htmlFor="link-credits">Credits</Label><Input id="link-credits" inputMode="numeric" value={credits} onChange={(event) => setCredits(event.target.value.replace(/\D/g, ""))} placeholder="1000" /><p className="text-xs text-muted-foreground">One balance for invoices, quotations and payslips. Fixed plans give 2 credits per expected document.</p></div>
            <div className="space-y-2"><Label htmlFor="link-months">Validity</Label><select id="link-months" value={months} onChange={(event) => setMonths(Number(event.target.value))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{MONTH_OPTIONS.map((value) => <option key={value} value={value}>{value} month{value === 1 ? "" : "s"}</option>)}</select></div>
          </div>

          <dl className="grid gap-2 rounded-xl border p-4 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Price</dt><dd className="mt-1 font-medium tabular-nums">{rupees(basePaise)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">GST ({GST_RATE_PERCENT}%)</dt><dd className="mt-1 font-medium tabular-nums">{rupees(gstPaise)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Total payable</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{rupees(totalPaise)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Price per credit</dt><dd className="mt-1 font-medium tabular-nums">{creditCount ? rupees(Math.round(basePaise / creditCount)) : "—"}</dd></div>
          </dl>

          <div className="space-y-2">
            <Label htmlFor="link-description">Description shown to the customer</Label>
            <Input id="link-description" value={finalDescription} onChange={(event) => { setDescription(event.target.value); setDescriptionEdited(true) }} maxLength={500} />
          </div>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span><span className="block text-sm font-medium">Razorpay sends the link by email and SMS</span><span className="block text-xs text-muted-foreground">To {[target.email, target.phone].filter(Boolean).join(" and ") || "no saved contact; copy the link instead"}. You can also copy it below.</span></span>
          </label>
          <Button disabled={creating || basePaise < 100 || creditCount < 1}>{creating ? <LoaderCircle className="animate-spin" /> : <Link2 />}{creating ? "Creating link…" : `Generate link for ${rupees(totalPaise)}`}</Button>
        </form> : null}

        {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}

        {created?.short_url ? <div role="status" className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">Payment link ready: {rupees(created.amount_paise)} for {created.credits} credits · {created.duration_months} months</p>
          <p className="break-all font-mono text-sm">{created.short_url}</p>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={created.short_url} />
            <Button type="button" size="sm" variant="outline" asChild><a href={whatsAppShare(created)} target="_blank" rel="noreferrer"><MessageCircle />Share on WhatsApp</a></Button>
            <Button type="button" size="sm" variant="outline" asChild><a href={created.short_url} target="_blank" rel="noreferrer"><ExternalLink />Open</a></Button>
          </div>
        </div> : null}
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div><CardTitle>Recent payment links</CardTitle><CardDescription>Status updates automatically when Razorpay reports a payment. Use Check status if a payment is not showing.</CardDescription></div>
        <Button size="sm" variant="ghost" onClick={() => void loadLinks()}><RefreshCw />Reload</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {listError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{listError}</p> : null}
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Subscriber</TableHead><TableHead>Amount</TableHead><TableHead>Credits</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {links.length ? links.map((link) => <TableRow key={link.id}>
                <TableCell><p className="font-medium">{link.workspace_name || link.customer_name || "—"}</p><p className="font-mono text-xs text-muted-foreground">{link.subscription_code}</p></TableCell>
                <TableCell className="tabular-nums"><p className="font-medium">{rupees(link.amount_paise)}</p><p className="text-xs text-muted-foreground">{rupees(link.base_amount_paise)} + GST</p></TableCell>
                <TableCell className="tabular-nums">{link.credits.toLocaleString("en-IN")}<p className="text-xs text-muted-foreground">{link.duration_months} mo</p></TableCell>
                <TableCell><Badge variant="outline" className={statusStyle[link.status]}>{statusLabel[link.status]}</Badge>{link.paid_at ? <p className="mt-1 text-xs text-muted-foreground">{new Date(link.paid_at).toLocaleDateString("en-IN")}</p> : null}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(link.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</TableCell>
                <TableCell className="text-right"><span className="inline-flex flex-wrap justify-end gap-1">
                  {link.short_url && link.status === "created" ? <CopyButton value={link.short_url} label="Copy" /> : null}
                  {link.status === "created" ? <Button size="sm" variant="ghost" disabled={rowBusy !== ""} onClick={() => void rowAction(link, "refresh")}>{rowBusy === `refresh:${link.id}` ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Check status</Button> : null}
                  {link.status === "created" ? <Button size="sm" variant="ghost" disabled={rowBusy !== ""} onClick={() => void rowAction(link, "cancel")}>{rowBusy === `cancel:${link.id}` ? <LoaderCircle className="animate-spin" /> : <Ban />}Cancel</Button> : null}
                </span></TableCell>
              </TableRow>) : <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No payment links yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  </div>
}
