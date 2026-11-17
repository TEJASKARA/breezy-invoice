import { useState } from "react"
import { LoaderCircle, ShieldCheck, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { customerErrorMessage } from "@/lib/customer-errors"
import { verifyGstin, type GstVerification } from "@/lib/gst-api"
import { type Company, useMvpStore } from "@/lib/mvp-store"
import { useWorkspaceAccess } from "@/lib/workspace-access"

const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** Adds a GSTIN to a company (entity) that was saved without one. */
export function EntityGstinDialog({ company, onClose, onSaved }: { company: Company; onClose: () => void; onSaved?: (message: string) => void }) {
  const { updateCompany } = useMvpStore()
  const { user, workspace } = useWorkspaceAccess()
  const [gstin, setGstin] = useState("")
  const [verified, setVerified] = useState<GstVerification | null>(null)
  const [useRegisteredDetails, setUseRegisteredDetails] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const normalized = gstin.trim().toUpperCase()

  const verify = async () => {
    setError("")
    setVerified(null)
    if (!gstinPattern.test(normalized)) return setError("Enter a valid 15-character GSTIN.")
    if (!workspace?.id || !user) return setError("Your workspace is still loading. Please try again.")
    setVerifying(true)
    try {
      setVerified(await verifyGstin(normalized, workspace.id, { userId: user.id }))
    } catch (caught) {
      setError(customerErrorMessage(caught, "GSTIN verification failed."))
    } finally {
      setVerifying(false)
    }
  }

  const save = async () => {
    setError("")
    if (!gstinPattern.test(normalized)) return setError("Enter a valid 15-character GSTIN.")
    if (company.pan && company.pan.toUpperCase() !== normalized.slice(2, 12)) return setError(`This GSTIN belongs to PAN ${normalized.slice(2, 12)}, but the company's saved PAN is ${company.pan}.`)
    const details = verified && verified.gstin === normalized && useRegisteredDetails ? {
      companyName: verified.trade_name || verified.legal_name || company.companyName,
      billingAddress: verified.billing_address || company.billingAddress,
      premisesAddress: verified.premises_address || verified.billing_address || company.premisesAddress,
    } : {}
    setSaving(true)
    try {
      await updateCompany(company.id, { hasGstin: true, gstin: normalized, pan: normalized.slice(2, 12), ...details })
      onSaved?.(`GSTIN ${normalized} added to ${details.companyName || company.companyName}. New invoices and quotations will show it.`)
      onClose()
    } catch (caught) {
      setError(customerErrorMessage(caught, "The GSTIN could not be saved."))
    } finally {
      setSaving(false)
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="entity-gstin-title">
    <div className="w-full max-w-lg space-y-4 rounded-xl border bg-background p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="entity-gstin-title" className="text-lg font-semibold">Add GSTIN</h2><p className="mt-1 text-sm text-muted-foreground">For {company.companyName}. Existing invoices are not changed.</p></div>
        <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose} disabled={saving}><X /></Button>
      </div>
      <div className="space-y-2">
        <Label htmlFor="entity-gstin-input">GSTIN</Label>
        <div className="flex gap-2">
          <Input id="entity-gstin-input" value={gstin} maxLength={15} autoCapitalize="characters" placeholder="36AAICR5789A1Z4" onChange={(event) => { setGstin(event.target.value.toUpperCase()); setVerified(null); setError("") }} />
          <Button type="button" variant="outline" disabled={verifying || normalized.length !== 15} onClick={() => void verify()}>{verifying ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}Verify</Button>
        </div>
        <p className="text-xs text-muted-foreground">{normalized.length}/15 characters. Verify to check it is active on the GST portal.</p>
      </div>
      {verified && verified.gstin === normalized ? <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
        <p className="font-medium">Verified: {verified.trade_name || verified.legal_name}</p>
        {verified.billing_address ? <p className="text-xs">{verified.billing_address}</p> : null}
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={useRegisteredDetails} onChange={(event) => setUseRegisteredDetails(event.target.checked)} /><span>Use the GST-registered name and address for this company</span></label>
      </div> : null}
      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={() => void save()} disabled={saving || normalized.length !== 15}>{saving ? <LoaderCircle className="animate-spin" /> : null}Save GSTIN</Button>
      </div>
    </div>
  </div>
}
