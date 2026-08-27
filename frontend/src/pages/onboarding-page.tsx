import { useState } from "react"
import { Building2, CalendarDays, CheckCircle2, Hash } from "lucide-react"
import { Navigate, useNavigate } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { verifyGstin, type GstVerification } from "@/lib/gst-api"
import { parseExistingInvoiceNumber, useMvpStore } from "@/lib/mvp-store"
import { useWorkspaceAccess } from "@/lib/workspace-access"

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
const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/

export function OnboardingPage() {
  const { setup, loading, completeSetup } = useMvpStore()
  const { workspace, refresh: refreshWorkspaceAccess } = useWorkspaceAccess()
  const navigate = useNavigate()
  const [firmName, setFirmName] = useState("")
  const [accountType, setAccountType] = useState<"ca" | "founder" | "employee" | null>(null)
  const [industry, setIndustry] = useState("")
  const [otherIndustry, setOtherIndustry] = useState("")
  const [hasGstin, setHasGstin] = useState<boolean | null>(null)
  const [gstin, setGstin] = useState("")
  const [pan, setPan] = useState("")
  const [mailingAddress, setMailingAddress] = useState("")
  const [continueExistingNumbers, setContinueExistingNumbers] = useState(false)
  const [latestInvoiceNumber, setLatestInvoiceNumber] = useState("")
  const [leavePeriod, setLeavePeriod] = useState<"monthly" | "yearly">("monthly")
  const [leaveAllowanceDays, setLeaveAllowanceDays] = useState(1)
  const [numberingError, setNumberingError] = useState("")
  const [saveError, setSaveError] = useState("")
  const [saving, setSaving] = useState(false)
  const [verifyingGstin, setVerifyingGstin] = useState(false)
  const [gstDetails, setGstDetails] = useState<GstVerification | null>(null)
  const [gstDetailsConfirmed, setGstDetailsConfirmed] = useState(false)

  if (loading) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading your workspace…</div>
  if (setup) return <Navigate to="/workspace" replace />

  const existingNumbering = continueExistingNumbers ? parseExistingInvoiceNumber(latestInvoiceNumber) : null
  const nextNumberPreview = existingNumbering
    ? `${existingNumbering.prefix}${String(existingNumbering.nextNumber).padStart(existingNumbering.padding, "0")}`
    : ""

  async function fetchGstDetails() {
    const normalizedGstin = gstin.trim().toUpperCase()
    if (!workspace?.id) throw new Error("Your workspace is still loading. Please try again.")
    if (!gstinPattern.test(normalizedGstin)) throw new Error("Enter a valid 15-character GSTIN first.")
    setVerifyingGstin(true)
    setSaveError("")
    try {
      const details = await verifyGstin(normalizedGstin, workspace.id)
      setGstDetails(details)
      const fetchedName = details.trade_name || details.legal_name
      if (fetchedName) setFirmName(fetchedName)
      setPan(details.pan)
      if (details.billing_address) setMailingAddress(details.billing_address)
      setGstDetailsConfirmed(false)
      return details
    } catch (error) {
      const message = error instanceof Error ? error.message : "GSTIN verification failed."
      setSaveError(message)
      throw error
    } finally {
      setVerifyingGstin(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const normalizedGstin = gstin.trim().toUpperCase()
    if (hasGstin === null) {
      setSaveError("Tell us whether your business has a GSTIN.")
      return
    }
    if (accountType === null) {
      setSaveError("Tell us how you will use ChanaX.")
      return
    }
    if (hasGstin && !gstinPattern.test(normalizedGstin)) {
      setSaveError("Enter a valid 15-character GSTIN, for example 27AAAAA0000A1Z5.")
      return
    }
    if (hasGstin && (!gstDetails || gstDetails.gstin !== normalizedGstin)) {
      setSaveError("Verify the GSTIN before continuing.")
      return
    }
    if (hasGstin && !gstDetailsConfirmed) {
      setSaveError("Review the fetched GST details and confirm that they are correct.")
      return
    }
    if (!hasGstin && pan.trim() && !panPattern.test(pan.trim().toUpperCase())) {
      setSaveError("Enter a valid 10-character PAN or leave it blank.")
      return
    }
    if (!firmName.trim() || !mailingAddress.trim()) {
      setSaveError("Enter the business name and mailing address.")
      return
    }
    if (continueExistingNumbers && !existingNumbering) {
      setNumberingError("Enter the complete latest invoice number ending in its sequence digits, for example ABC/2025-26/0047.")
      return
    }
    setSaving(true)
    setSaveError("")
    try {
      const verified = hasGstin ? gstDetails : null
      await completeSetup({
        firmName: firmName.trim() || verified?.trade_name || verified?.legal_name || "",
        accountType,
        industry: industry === "Other" ? otherIndustry.trim() : industry,
        hasGstin,
        gstin: hasGstin ? normalizedGstin : "",
        pan: hasGstin ? verified?.pan || normalizedGstin.slice(2, 12) : pan.trim().toUpperCase(),
        legalName: verified?.legal_name || "",
        tradeName: verified?.trade_name || "",
        gstRegistrationStatus: verified?.registration_status || "",
        mailingAddress: mailingAddress.trim() || verified?.billing_address || "",
        premisesAddress: verified?.premises_address || mailingAddress.trim(),
        invoiceNumbering: existingNumbering ?? { mode: "default", prefix: "", nextNumber: 1, padding: 4 },
        leavePolicy: { period: leavePeriod, allowanceDays: Math.max(0, leaveAllowanceDays) },
      })
      if (hasGstin && workspace?.id) {
        const verification = await verifyGstin(normalizedGstin, workspace.id)
        if (!verification.workspace_verified) {
          throw new Error(
            verification.registration_status
              ? `This GSTIN has registration status “${verification.registration_status}” and could not be verified for free credits.`
              : "The GSTIN details were found, but the workspace verification could not be completed. Please try again.",
          )
        }
        await refreshWorkspaceAccess()
      }
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
          <CardHeader><CardTitle>Your business details</CardTitle><CardDescription>Verify your GSTIN to securely fill the registered business details. Non-GST businesses can continue without it.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-6">
              {saveError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{saveError}</p>}
              <div className="space-y-2">
                <Label htmlFor="industry">Industry</Label>
                <select id="industry" required value={industry} onChange={(event) => { setIndustry(event.target.value); if (event.target.value !== "Other") setOtherIndustry("") }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Select your industry</option>
                  {industries.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                {industry === "Other" && <Input required value={otherIndustry} onChange={(event) => setOtherIndustry(event.target.value)} placeholder="Enter your industry" aria-label="Other industry" />}
                <p className="text-xs text-muted-foreground">This helps ChanaX tailor templates and reports to your business.</p>
              </div>
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">Does your business have a GSTIN?</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={`cursor-pointer rounded-xl border p-4 transition-colors ${hasGstin === true ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-background hover:bg-muted/30"}`}>
                    <input type="radio" name="hasGstin" required checked={hasGstin === true} onChange={() => { setHasGstin(true); setGstDetails(null); setGstDetailsConfirmed(false); setPan(""); setSaveError("") }} className="sr-only" />
                    <span className="block font-medium">Yes, I have a GSTIN</span>
                    <span className="mt-1 block text-xs text-muted-foreground">You receive 10 provisional shared credits. GST verification unlocks 20 more.</span>
                  </label>
                  <label className={`cursor-pointer rounded-xl border p-4 transition-colors ${hasGstin === false ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-background hover:bg-muted/30"}`}>
                    <input type="radio" name="hasGstin" required checked={hasGstin === false} onChange={() => { setHasGstin(false); setGstin(""); setGstDetails(null); setGstDetailsConfirmed(false); setPan(""); setSaveError("") }} className="sr-only" />
                    <span className="block font-medium">No, I do not have a GSTIN</span>
                    <span className="mt-1 block text-xs text-muted-foreground">You receive 10 shared credits for invoices or payslips.</span>
                  </label>
                </div>
              </fieldset>
              {hasGstin ? (
                <div className="space-y-3">
                  <Label htmlFor="gstin">GSTIN</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input id="gstin" required minLength={15} maxLength={15} value={gstin} onChange={(event) => { setGstin(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15)); setGstDetails(null); setGstDetailsConfirmed(false); setPan(""); setSaveError("") }} placeholder="27AAAAA0000A1Z5" className="font-mono uppercase" />
                    <Button type="button" variant="outline" disabled={verifyingGstin || gstin.length !== 15} onClick={() => void fetchGstDetails().catch(() => undefined)}>{verifyingGstin ? "Checking GSTIN…" : "Fetch GST details"}</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{gstin.length}/15 characters. ChanaX reuses saved verification data when this GSTIN was checked before.</p>
                </div>
              ) : null}

              {hasGstin && gstDetails ? (
                <section className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300" />
                    <div>
                      <h2 className="font-medium text-emerald-900 dark:text-emerald-100">GSTIN verified with WhiteBooks</h2>
                      <p className="text-sm text-emerald-800/80 dark:text-emerald-200/80">Review the registered details below. You can edit the business display name and mailing address before saving.</p>
                    </div>
                  </div>
                  <dl className="grid gap-3 rounded-lg border bg-background p-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs text-muted-foreground">Legal name</dt><dd className="mt-1 font-medium">{gstDetails.legal_name || "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Trade name</dt><dd className="mt-1 font-medium">{gstDetails.trade_name || "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">PAN</dt><dd className="mt-1 font-mono font-medium">{gstDetails.pan}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Registration status</dt><dd className="mt-1 font-medium">{gstDetails.registration_status}</dd></div>
                  </dl>
                  <div className="space-y-2"><Label htmlFor="firmName">Business display name</Label><Input id="firmName" required value={firmName} onChange={(event) => { setFirmName(event.target.value); setGstDetailsConfirmed(false) }} placeholder="Business name" /><p className="text-xs text-muted-foreground">This is the name ChanaX will show in your workspace and documents.</p></div>
                  <div className="space-y-2"><Label htmlFor="address">Mailing address</Label><textarea id="address" required value={mailingAddress} onChange={(event) => { setMailingAddress(event.target.value); setGstDetailsConfirmed(false) }} placeholder="Full business mailing address" className="flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" /></div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3">
                    <input type="checkbox" checked={gstDetailsConfirmed} onChange={(event) => { setGstDetailsConfirmed(event.target.checked); setSaveError("") }} className="mt-0.5 size-4 accent-foreground" />
                    <span><span className="block text-sm font-medium">I have reviewed these business details</span><span className="block text-xs text-muted-foreground">The legal name, PAN and GST status remain linked to the verified GSTIN.</span></span>
                  </label>
                </section>
              ) : null}

              {hasGstin === false ? (
                <section className="space-y-4 rounded-xl border bg-muted/20 p-4">
                  <div><h2 className="font-medium">Enter your business details</h2><p className="text-sm text-muted-foreground">GST information will be omitted from your invoices. PAN is optional.</p></div>
                  <div className="space-y-2"><Label htmlFor="firmName">Firm or business name</Label><Input id="firmName" required value={firmName} onChange={(event) => setFirmName(event.target.value)} placeholder="Rushi & Co." /></div>
                  <div className="space-y-2"><Label htmlFor="pan">PAN (optional)</Label><Input id="pan" minLength={10} maxLength={10} value={pan} onChange={(event) => { setPan(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)); setSaveError("") }} placeholder="ABCDE1234F" className="font-mono uppercase" /></div>
                  <div className="space-y-2"><Label htmlFor="address">Mailing address</Label><textarea id="address" required value={mailingAddress} onChange={(event) => setMailingAddress(event.target.value)} placeholder="Full business mailing address" className="flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" /></div>
                </section>
              ) : null}
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">How will you use ChanaX?</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {([
                    ["ca", "CA / accounting firm", "Manage multiple client entities"],
                    ["founder", "Founder / owner", "Manage your company and team"],
                    ["employee", "Employee", "Use access assigned by an admin"],
                  ] as const).map(([value, title, description]) => <label key={value} className={`cursor-pointer rounded-xl border p-4 transition-colors ${accountType === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-background hover:bg-muted/30"}`}><input className="sr-only" type="radio" name="accountType" required checked={accountType === value} onChange={() => { setAccountType(value); setSaveError("") }} /><span className="block font-medium">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span></label>)}
                </div>
                <p className="text-xs text-muted-foreground">The subscription owner remains the workspace admin and controls every invited member’s page permissions.</p>
              </fieldset>
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
                  <span><span className="block text-sm font-medium">Continue my existing invoice sequence</span><span className="block text-xs text-muted-foreground">Turn this off to use the ChanaX format, such as INV-{new Date().getFullYear()}-0001.</span></span>
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
                    <p className="text-xs text-muted-foreground">The changing sequence must be at the end. ChanaX preserves the complete prefix and the number of leading zeroes.</p>
                    {nextNumberPreview && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Your next invoice will be {nextNumberPreview}</p>}
                    {numberingError && <p role="alert" className="text-sm font-medium text-destructive">{numberingError}</p>}
                  </div>
                )}
              </section>

              <Button className="w-full" type="submit" disabled={saving || hasGstin === null || (hasGstin && (!gstDetails || !gstDetailsConfirmed))}>{saving ? "Saving your workspace…" : "Save and add client companies"} {!saving && <CheckCircle2 />}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
