import { useState } from "react"
import { Building2, CalendarDays, CheckCircle2, Hash } from "lucide-react"
import { Navigate, useNavigate } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parseExistingInvoiceNumber, useMvpStore } from "@/lib/mvp-store"

const industries = [
  "Accounting / CA firm",
  "Information technology / Software",
  "Professional services",
  "Manufacturing",
  "Retail / E-commerce",
  "Real estate / Construction",
  "Healthcare",
  "Education",
  "Hospitality",
  "Logistics / Transportation",
  "Other",
]
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export function OnboardingPage() {
  const { setup, loading, completeSetup } = useMvpStore()
  const navigate = useNavigate()
  const [firmName, setFirmName] = useState("")
  const [industry, setIndustry] = useState("")
  const [otherIndustry, setOtherIndustry] = useState("")
  const [gstin, setGstin] = useState("")
  const [mailingAddress, setMailingAddress] = useState("")
  const [continueExistingNumbers, setContinueExistingNumbers] = useState(false)
  const [latestInvoiceNumber, setLatestInvoiceNumber] = useState("")
  const [leavePeriod, setLeavePeriod] = useState<"monthly" | "yearly">("monthly")
  const [leaveAllowanceDays, setLeaveAllowanceDays] = useState(1)
  const [numberingError, setNumberingError] = useState("")
  const [saveError, setSaveError] = useState("")
  const [saving, setSaving] = useState(false)

  if (loading) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading your workspace…</div>
  if (setup) return <Navigate to="/workspace" replace />

  const existingNumbering = continueExistingNumbers ? parseExistingInvoiceNumber(latestInvoiceNumber) : null
  const nextNumberPreview = existingNumbering
    ? `${existingNumbering.prefix}${String(existingNumbering.nextNumber).padStart(existingNumbering.padding, "0")}`
    : ""

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const normalizedGstin = gstin.trim().toUpperCase()
    if (!gstinPattern.test(normalizedGstin)) {
      setSaveError("Enter a valid 15-character GSTIN, for example 27AAAAA0000A1Z5.")
      return
    }
    if (continueExistingNumbers && !existingNumbering) {
      setNumberingError("Enter the complete latest invoice number ending in its sequence digits, for example ABC/2025-26/0047.")
      return
    }
    setSaving(true)
    setSaveError("")
    try {
      await completeSetup({
        firmName: firmName.trim(),
        industry: industry === "Other" ? otherIndustry.trim() : industry,
        gstin: normalizedGstin,
        mailingAddress: mailingAddress.trim(),
        invoiceNumbering: existingNumbering ?? { mode: "default", prefix: "", nextNumber: 1, padding: 4 },
        leavePolicy: { period: leavePeriod, allowanceDays: Math.max(0, leaveAllowanceDays) },
      })
      navigate("/entities")
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "We could not save your setup. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-svh bg-muted/30 p-5 sm:p-10">
      <div className="mx-auto max-w-2xl">
        <BrandMark className="mb-10" />
        <div className="mb-7 flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Building2 className="size-5" /></span>
          <div>
            <p className="text-sm font-medium text-primary">Workspace setup</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Set up your firm</h1>
            <p className="mt-2 text-muted-foreground">Add your sender information and choose how new invoice numbers should continue.</p>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Your business details</CardTitle><CardDescription>GST lookup is optional for now; enter the information you want to show.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-6">
              <div className="space-y-2"><Label htmlFor="firmName">Firm or business name</Label><Input id="firmName" required value={firmName} onChange={(event) => setFirmName(event.target.value)} placeholder="Rushi & Co." /></div>
              <div className="space-y-2">
                <Label htmlFor="industry">Industry</Label>
                <select id="industry" required value={industry} onChange={(event) => { setIndustry(event.target.value); if (event.target.value !== "Other") setOtherIndustry("") }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Select your industry</option>
                  {industries.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                {industry === "Other" && <Input required value={otherIndustry} onChange={(event) => setOtherIndustry(event.target.value)} placeholder="Enter your industry" aria-label="Other industry" />}
                <p className="text-xs text-muted-foreground">This will help BreezyInvoice tailor templates and future reports to your business.</p>
              </div>
              <div className="space-y-2"><Label htmlFor="gstin">GSTIN</Label><Input id="gstin" required minLength={15} maxLength={15} value={gstin} onChange={(event) => { setGstin(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15)); setSaveError("") }} placeholder="27AAAAA0000A1Z5" className="font-mono uppercase" /><p className="text-xs text-muted-foreground">{gstin.length}/15 characters</p></div>
              <div className="space-y-2"><Label htmlFor="address">Mailing address</Label><textarea id="address" required value={mailingAddress} onChange={(event) => setMailingAddress(event.target.value)} placeholder="Full business mailing address" className="flex min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" /></div>

              <section className="space-y-4 rounded-xl border bg-muted/20 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background"><CalendarDays className="size-4" /></span>
                  <div><h2 className="font-medium">Employee leave policy</h2><p className="text-sm text-muted-foreground">Choose how many paid leave days each employee receives and when that allowance resets.</p></div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="leave-period">Calculate paid leave</Label><select id="leave-period" value={leavePeriod} onChange={(event) => setLeavePeriod(event.target.value as "monthly" | "yearly")} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="monthly">Monthly allowance</option><option value="yearly">Yearly allowance</option></select></div>
                  <div className="space-y-2"><Label htmlFor="leave-allowance">Paid leave allowance</Label><Input id="leave-allowance" required type="number" min="0" step="0.5" value={leaveAllowanceDays} onChange={(event) => setLeaveAllowanceDays(Math.max(0, Number(event.target.value) || 0))} /><p className="text-xs text-muted-foreground">{leavePeriod === "monthly" ? "Days available to each employee every month." : "Days available to each employee per calendar year."}</p></div>
                </div>
                <p className="text-xs text-muted-foreground">Leave above this allowance becomes loss of pay. The deduction is calculated as monthly gross salary ÷ calendar days × loss-of-pay days.</p>
              </section>

              <section className="space-y-4 rounded-xl border bg-muted/20 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background"><Hash className="size-4" /></span>
                  <div><h2 className="font-medium">Invoice numbering</h2><p className="text-sm text-muted-foreground">Do you already use an invoice number format that you want to continue?</p></div>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3">
                  <input
                    type="checkbox"
                    checked={continueExistingNumbers}
                    onChange={(event) => {
                      setContinueExistingNumbers(event.target.checked)
                      setNumberingError("")
                    }}
                    className="mt-0.5 size-4 accent-foreground"
                  />
                  <span><span className="block text-sm font-medium">Continue my existing invoice sequence</span><span className="block text-xs text-muted-foreground">Turn this off to use the BreezyInvoice format, such as INV-{new Date().getFullYear()}-0001.</span></span>
                </label>

                {continueExistingNumbers && (
                  <div className="space-y-2">
                    <Label htmlFor="latestInvoiceNumber">Your latest invoice number</Label>
                    <Input
                      id="latestInvoiceNumber"
                      required
                      value={latestInvoiceNumber}
                      onChange={(event) => { setLatestInvoiceNumber(event.target.value); setNumberingError("") }}
                      placeholder="ABC/2025-26/0047"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">The changing sequence must be at the end. BreezyInvoice preserves the complete prefix and the number of leading zeroes.</p>
                    {nextNumberPreview && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Your next invoice will be {nextNumberPreview}</p>}
                    {numberingError && <p role="alert" className="text-sm font-medium text-destructive">{numberingError}</p>}
                  </div>
                )}
              </section>

              {saveError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{saveError}</p>}
              <Button className="w-full" type="submit" disabled={saving}>{saving ? "Saving your workspace…" : "Save and add client companies"} {!saving && <CheckCircle2 />}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
