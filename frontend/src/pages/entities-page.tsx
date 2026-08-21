import { useEffect, useState } from "react"
import { Building2, Plus, Trash2 } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type Company, useMvpStore } from "@/lib/mvp-store"
import { useAuthUser } from "@/lib/use-auth-user"
import { useWorkspaceAccess } from "@/lib/workspace-access"

type EntityForm = Omit<Company, "id">
const emptyCompany = (): EntityForm => ({ companyName: "", billingAddress: "", gstin: "", pan: "", premisesAddress: "", hsnSac: "" })
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const hsnSacPattern = /^(?:[0-9]{4}|[0-9]{6}|[0-9]{8})$/
const hasFormData = (form: EntityForm) => [
  form.companyName,
  form.billingAddress,
  form.gstin,
  form.pan,
  form.premisesAddress,
  form.hsnSac,
].some((value) => value.trim())

export function EntitiesPage() {
  const { companies, addCompanies, deleteCompany } = useMvpStore()
  const { user } = useAuthUser()
  const { can } = useWorkspaceAccess()
  const canManage = can("entities.manage")
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyCompany)
  const [draftReady, setDraftReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const draftStorageKey = user ? `breezyinvoice-entity-draft:${user.id}` : null

  useEffect(() => {
    if (!draftStorageKey) return
    setDraftReady(false)
    setForm(emptyCompany())
    setShowForm(false)
    try {
      const saved = window.localStorage.getItem(draftStorageKey)
      if (saved) {
        const draft = { ...emptyCompany(), ...JSON.parse(saved) } as EntityForm
        setForm(draft)
        setShowForm(hasFormData(draft))
      }
    } catch {
      window.localStorage.removeItem(draftStorageKey)
    } finally {
      setDraftReady(true)
    }
  }, [draftStorageKey])

  useEffect(() => {
    if (!draftStorageKey || !draftReady) return
    if (hasFormData(form)) window.localStorage.setItem(draftStorageKey, JSON.stringify(form))
    else window.localStorage.removeItem(draftStorageKey)
  }, [draftReady, draftStorageKey, form])

  const discardForm = () => {
    setForm(emptyCompany())
    if (draftStorageKey) window.localStorage.removeItem(draftStorageKey)
    setShowForm(false)
    setNotice("")
  }

  const useDemoIdentifiers = () => {
    setForm((current) => ({
      ...current,
      gstin: "29ABCDE1234F1Z5",
      pan: "ABCDE1234F",
      hsnSac: current.hsnSac || "998314",
    }))
    setNoticeIsError(false)
    setNotice("Demo identifiers added. Replace them with verified statutory details before using this entity for real invoices.")
  }

  const save = async () => {
    const gstin = form.gstin.toUpperCase().trim()
    const pan = form.pan.toUpperCase().trim()
    if (!form.companyName.trim()) {
      setNoticeIsError(true)
      setNotice("Company name is required.")
      return
    }
    if (!gstinPattern.test(gstin)) {
      setNoticeIsError(true)
      setNotice("GSTIN must be a valid 15-character GST number.")
      return
    }
    if (!panPattern.test(pan)) {
      setNoticeIsError(true)
      setNotice("PAN must follow the valid 10-character format, for example ABCDE1234F.")
      return
    }
    if (gstin.slice(2, 12) !== pan) {
      setNoticeIsError(true)
      setNotice("The PAN does not match the PAN embedded in the GSTIN.")
      return
    }
    if (form.hsnSac && !hsnSacPattern.test(form.hsnSac)) {
      setNoticeIsError(true)
      setNotice("HSN/SAC must contain exactly 4, 6, or 8 digits.")
      return
    }
    setSaving(true)
    try {
      await addCompanies([{ ...form, gstin, pan }])
      setForm(emptyCompany())
      if (draftStorageKey) window.localStorage.removeItem(draftStorageKey)
      setShowForm(false)
      setNoticeIsError(false)
      setNotice("Entity saved to your workspace with validated GSTIN, PAN, and HSN/SAC.")
    } catch (error) {
      setNoticeIsError(true)
      setNotice(error instanceof Error ? error.message : "The entity could not be saved. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Master data"
        title="Managed entities"
        description="Add the businesses or legal entities managed under this BreezyInvoice workspace."
        actions={
          canManage ? <Button onClick={() => setShowForm((value) => !value)}><Plus />Add entity</Button> : null
        }
      />

      {notice && (
        <p
          role={noticeIsError ? "alert" : "status"}
          className={noticeIsError
            ? "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive"
            : "rounded-lg bg-muted p-3 text-sm text-muted-foreground"}
        >
          {notice}
        </p>
      )}

      {showForm && canManage && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Add a company</CardTitle>
                <CardDescription>Your unfinished form is kept when you move to another section. Enter valid statutory identifiers.</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={useDemoIdentifiers}>Use demo identifiers</Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="entity-companyName">Company name</Label>
              <Input id="entity-companyName" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entity-gstin">GSTIN</Label>
              <Input id="entity-gstin" value={form.gstin} maxLength={15} autoCapitalize="characters" placeholder="36AAICR5789A1Z4" onChange={(event) => setForm({ ...form, gstin: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15) })} />
              <p className="text-xs text-muted-foreground">{form.gstin.length}/15 characters</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="entity-pan">PAN</Label>
              <Input id="entity-pan" value={form.pan} maxLength={10} autoCapitalize="characters" placeholder="AAICR5789A" onChange={(event) => setForm({ ...form, pan: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) })} />
              <p className="text-xs text-muted-foreground">{form.pan.length}/10 characters</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="entity-hsnSac">Default HSN/SAC</Label>
              <Input id="entity-hsnSac" value={form.hsnSac} maxLength={8} inputMode="numeric" placeholder="997212" onChange={(event) => setForm({ ...form, hsnSac: event.target.value.replace(/\D/g, "").slice(0, 8) })} />
              <p className="text-xs text-muted-foreground">Enter exactly 4, 6, or 8 digits.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="entity-billing-address">Billing address</Label>
              <textarea id="entity-billing-address" value={form.billingAddress} onChange={(event) => setForm({ ...form, billingAddress: event.target.value })} className="min-h-20 w-full rounded-md border border-input bg-transparent p-2 text-sm" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entity-premises-address">Premises address</Label>
              <textarea id="entity-premises-address" value={form.premisesAddress} onChange={(event) => setForm({ ...form, premisesAddress: event.target.value })} className="min-h-20 w-full rounded-md border border-input bg-transparent p-2 text-sm" />
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button variant="outline" onClick={discardForm} disabled={saving}>Discard</Button>
              <Button onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save company"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Entities</CardTitle>
          <CardDescription>{companies.length} saved compan{companies.length === 1 ? "y" : "ies"}.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Company</TableHead><TableHead>GSTIN</TableHead><TableHead className="hidden md:table-cell">PAN</TableHead><TableHead className="hidden lg:table-cell">HSN/SAC</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {companies.length ? companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-muted"><Building2 className="size-4 text-muted-foreground" /></span>
                      <div><p className="font-medium">{company.companyName}</p><p className="max-w-56 truncate text-xs text-muted-foreground">{company.billingAddress || "Address pending"}</p></div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{company.gstin}</TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">{company.pan}</TableCell>
                  <TableCell className="hidden lg:table-cell">{company.hsnSac || "—"}</TableCell>
                  <TableCell><Badge variant="outline">Active</Badge></TableCell>
                  <TableCell className="text-right">
                    {!canManage ? <span className="text-xs text-muted-foreground">View only</span> : pendingDelete === company.id ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button>
                        <Button size="sm" variant="destructive" onClick={async () => { try { await deleteCompany(company.id); setPendingDelete(null); setNoticeIsError(false); setNotice(`${company.companyName} was deleted. Existing invoices were left unchanged.`) } catch (error) { setNoticeIsError(true); setNotice(error instanceof Error ? error.message : "The entity could not be deleted.") } }}>Confirm delete</Button>
                      </div>
                    ) : (
                      <Button size="icon" variant="ghost" aria-label={`Delete ${company.companyName}`} onClick={() => setPendingDelete(company.id)}><Trash2 /></Button>
                    )}
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} className="h-40 text-center text-muted-foreground">Add the first legal entity managed by this workspace.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
