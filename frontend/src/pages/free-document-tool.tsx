import { useEffect, useMemo, useState } from "react"
import { Download, LoaderCircle, Plus, Trash2 } from "lucide-react"

import { InvoicePreview } from "@/components/invoice-preview"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { calculateInvoiceTotals } from "@/lib/invoice-calculations"
import { gstRateOptions, type GstTaxMode } from "@/lib/invoice-gst"
import { cleanInvoiceFileName, createInvoicePdf } from "@/lib/invoice-pdf"
import { useMvpStore, type Company, type Customer, type Invoice, type InvoiceLineItem } from "@/lib/mvp-store"
import { trackAction } from "@/lib/usage-tracking"

type Party = { name: string; address: string; gstin: string }
type Row = { id: string; description: string; hsnSac: string; quantity: string; rate: string; gstRate: number }
type FreeDocumentDraft = {
  business: Party
  customer: Party
  number: string
  date: string
  validUntil: string
  includesGst: boolean
  taxMode: GstTaxMode
  rows: Row[]
  paymentDetails: string
}

const today = () => new Date().toISOString().slice(0, 10)
const inDays = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10) }
const newRow = (): Row => ({ id: crypto.randomUUID(), description: "", hsnSac: "", quantity: "1", rate: "", gstRate: 18 })
const money = (value: number) => Math.round(value * 100) / 100
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const storageKey = (kind: string) => `chanax-free-${kind}`
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

function emptyDraft(kind: "invoice" | "quotation", business?: Party): FreeDocumentDraft {
  return {
    business: business || { name: "", address: "", gstin: "" },
    customer: { name: "", address: "", gstin: "" },
    number: kind === "quotation" ? "QTN-0001" : "INV-0001",
    date: today(),
    validUntil: inDays(15),
    includesGst: true,
    taxMode: "split",
    rows: [newRow()],
    paymentDetails: "",
  }
}

function loadDraft(kind: "invoice" | "quotation", business?: Party): FreeDocumentDraft {
  try {
    const saved = localStorage.getItem(storageKey(kind))
    if (saved) return { ...emptyDraft(kind, business), ...JSON.parse(saved) as Partial<FreeDocumentDraft> }
  } catch { /* start fresh */ }
  return emptyDraft(kind, business)
}

/** Line items with GST worked out from quantity, rate and GST %. */
export function freeDocumentLineItems(rows: Row[], includesGst: boolean, taxMode: GstTaxMode): InvoiceLineItem[] {
  return rows.filter((row) => row.description.trim() || Number(row.rate) > 0).map((row) => {
    const quantity = Math.max(0, Number(row.quantity) || 0)
    const unitPrice = Math.max(0, Number(row.rate) || 0)
    const taxableAmount = money(quantity * unitPrice)
    const rate = includesGst ? row.gstRate : 0
    const half = money(taxableAmount * rate / 200)
    return {
      id: row.id,
      description: row.description.trim() || "Item",
      hsnSac: row.hsnSac.trim(),
      quantity,
      unitPrice,
      taxableAmount,
      cgstAmount: taxMode === "split" ? half : 0,
      sgstAmount: taxMode === "split" ? half : 0,
      igstAmount: taxMode === "igst" ? money(taxableAmount * rate / 100) : 0,
    }
  })
}

function PartyFields({ prefix, title, value, onChange }: { prefix: string; title: string; value: Party; onChange: (value: Party) => void }) {
  return <div className="space-y-3">
    <h3 className="text-sm font-semibold">{title}</h3>
    <div className="space-y-2"><Label htmlFor={`${prefix}-name`}>Name</Label><Input id={`${prefix}-name`} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder={prefix === "business" ? "Your business name" : "Customer or company name"} /></div>
    <div className="space-y-2"><Label htmlFor={`${prefix}-address`}>Address</Label><textarea id={`${prefix}-address`} rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={value.address} onChange={(event) => onChange({ ...value, address: event.target.value })} placeholder="Street, city, state, PIN" /></div>
    <div className="space-y-2"><Label htmlFor={`${prefix}-gstin`}>GSTIN (optional)</Label><Input id={`${prefix}-gstin`} value={value.gstin} maxLength={15} className="font-mono uppercase" onChange={(event) => onChange({ ...value, gstin: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="36ABCDE1234F1Z5" /></div>
  </div>
}

/** Free tools: a one-page invoice or quotation, typed in directly with a live preview. */
export function FreeDocumentTool({ kind }: { kind: "invoice" | "quotation" }) {
  const { setup, companies, customers, templateFor, completeSetup, addCustomers } = useMvpStore()
  const isQuotation = kind === "quotation"
  const savedBusiness = companies[0] ? { name: companies[0].companyName, address: companies[0].billingAddress, gstin: companies[0].gstin } : undefined
  const [draft, setDraft] = useState<FreeDocumentDraft>(() => loadDraft(kind, savedBusiness))
  const [previewDraft, setPreviewDraft] = useState(draft)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const template = useMemo(() => templateFor(companies[0]?.id), [companies[0]?.id, templateFor])

  useEffect(() => { try { localStorage.setItem(storageKey(kind), JSON.stringify(draft)) } catch { /* draft stays in memory */ } }, [draft, kind])
  // Redraw the preview shortly after typing stops.
  useEffect(() => { const timer = window.setTimeout(() => setPreviewDraft(draft), 600); return () => window.clearTimeout(timer) }, [draft])

  const update = (changes: Partial<FreeDocumentDraft>) => { setDraft((current) => ({ ...current, ...changes })); setError("") }
  const updateRow = (id: string, changes: Partial<Row>) => update({ rows: draft.rows.map((row) => row.id === id ? { ...row, ...changes } : row) })

  const build = (source: FreeDocumentDraft) => {
    const lineItems = freeDocumentLineItems(source.rows, source.includesGst, source.taxMode)
    const totals = calculateInvoiceTotals(lineItems)
    const gstin = (party: Party) => gstinPattern.test(party.gstin) ? party.gstin : ""
    const entity: Company = { id: "free-business", companyName: source.business.name || "Your business name", billingAddress: source.business.address, premisesAddress: source.business.address, gstin: gstin(source.business), pan: gstin(source.business).slice(2, 12), hsnSac: "", hasGstin: Boolean(gstin(source.business)) }
    const customer: Customer = { id: "free-customer", entityId: entity.id, companyName: source.customer.name || "Customer name", billingAddress: source.customer.address, premisesAddress: source.customer.address, gstin: gstin(source.customer), pan: gstin(source.customer).slice(2, 12), hsnSac: "" }
    const invoice: Invoice & { validUntil?: string; paymentDetails?: string } = {
      id: `free-${kind}`,
      number: source.number || (isQuotation ? "QTN-0001" : "INV-0001"),
      entityName: entity.companyName,
      customerId: customer.id,
      companyName: customer.companyName,
      date: source.date,
      status: "Generated",
      includesGst: source.includesGst,
      gstTaxMode: source.taxMode,
      lineItems,
      taxableAmount: totals.taxableAmount,
      cgstAmount: totals.cgstAmount,
      sgstAmount: totals.sgstAmount,
      igstAmount: totals.igstAmount,
      amount: totals.amount,
      ...(isQuotation ? { validUntil: source.validUntil, paymentDetails: source.paymentDetails.trim() } : {}),
    }
    return { invoice, entity, customer, totals }
  }
  const current = build(draft)
  const preview = useMemo(() => build(previewDraft), [previewDraft]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Keeps the business and customer for the account they create later. */
  const remember = async () => {
    if (!setup && draft.business.name.trim()) {
      await completeSetup({ firmName: draft.business.name.trim(), industry: "Other", hasGstin: Boolean(current.entity.gstin), gstin: current.entity.gstin, pan: current.entity.pan, mailingAddress: draft.business.address.trim(), premisesAddress: draft.business.address.trim() })
    }
    const entityId = companies[0]?.id
    const name = draft.customer.name.trim()
    if (entityId && name && !customers.some((item) => item.entityId === entityId && item.companyName.trim().toLowerCase() === name.toLowerCase())) {
      await addCustomers([{ entityId, companyName: name, billingAddress: draft.customer.address.trim(), premisesAddress: draft.customer.address.trim(), gstin: current.customer.gstin, pan: current.customer.pan, hsnSac: "", hasGstin: Boolean(current.customer.gstin) }])
    }
  }

  const download = async () => {
    if (!draft.business.name.trim() || !draft.customer.name.trim()) return setError("Enter your business name and the customer's name.")
    if (!current.invoice.lineItems?.length || current.totals.taxableAmount <= 0) return setError("Add at least one item with a rate.")
    if ([draft.business.gstin, draft.customer.gstin].some((value) => value && !gstinPattern.test(value))) return setError("A GSTIN must be 15 characters, like 36ABCDE1234F1Z5, or left empty.")
    setBusy(true)
    try {
      const doc = await createInvoicePdf({ invoice: current.invoice, entity: current.entity, customer: current.customer, template, documentType: kind })
      doc.save(`${cleanInvoiceFileName(current.customer.companyName)}_${cleanInvoiceFileName(current.invoice.number)}.pdf`)
      trackAction(isQuotation ? "free_quotation_downloaded" : "free_invoice_downloaded")
      void remember().catch(() => undefined)
    } catch {
      setError(`The ${kind} PDF could not be created. Please try again.`)
    } finally {
      setBusy(false)
    }
  }

  const label = isQuotation ? "Quotation" : "Invoice"
  return <div className="grid gap-6 xl:grid-cols-[minmax(360px,520px)_1fr]">
    <Card className="h-fit">
      <CardHeader><CardTitle>Generate {label.toLowerCase()}</CardTitle><CardDescription>Type the details; the preview updates as you go. Nothing is sent anywhere.</CardDescription></CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <PartyFields prefix="business" title="From (your business)" value={draft.business} onChange={(business) => update({ business })} />
          <PartyFields prefix="customer" title={isQuotation ? "Quotation for" : "Bill to"} value={draft.customer} onChange={(customer) => update({ customer })} />
        </div>
        <div className={`grid gap-3 ${isQuotation ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <div className="space-y-2"><Label htmlFor="free-number">{label} number</Label><Input id="free-number" value={draft.number} onChange={(event) => update({ number: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="free-date">Date</Label><Input id="free-date" type="date" value={draft.date} onChange={(event) => update({ date: event.target.value })} /></div>
          {isQuotation ? <div className="space-y-2"><Label htmlFor="free-valid">Valid until</Label><Input id="free-valid" type="date" min={draft.date} value={draft.validUntil} onChange={(event) => update({ validUntil: event.target.value })} /></div> : null}
        </div>
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={draft.includesGst} onChange={(event) => update({ includesGst: event.target.checked })} />Include GST</label>
          {draft.includesGst ? <select aria-label="Tax type" className={selectClass} value={draft.taxMode} onChange={(event) => update({ taxMode: event.target.value as GstTaxMode })}><option value="split">CGST + SGST (same state)</option><option value="igst">IGST (other state)</option></select> : null}
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Items</h3>
          {draft.rows.map((row, index) => <div key={row.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border p-3">
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
              <Input aria-label={`Description ${index + 1}`} placeholder="Item or service" value={row.description} onChange={(event) => updateRow(row.id, { description: event.target.value })} />
              <Input aria-label={`HSN or SAC ${index + 1}`} placeholder="HSN/SAC" inputMode="numeric" maxLength={8} value={row.hsnSac} onChange={(event) => updateRow(row.id, { hsnSac: event.target.value.replace(/\D/g, "") })} />
              <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                <Input aria-label={`Quantity ${index + 1}`} type="number" min="0" step="any" placeholder="Qty" value={row.quantity} onChange={(event) => updateRow(row.id, { quantity: event.target.value })} />
                <Input aria-label={`Rate ${index + 1}`} type="number" min="0" step="any" placeholder="Rate (₹)" value={row.rate} onChange={(event) => updateRow(row.id, { rate: event.target.value })} />
                {draft.includesGst ? <select aria-label={`GST rate ${index + 1}`} className={selectClass} value={row.gstRate} onChange={(event) => updateRow(row.id, { gstRate: Number(event.target.value) })}>{gstRateOptions.map((rate) => <option key={rate} value={rate}>{rate}% GST</option>)}</select> : <span />}
              </div>
            </div>
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove item ${index + 1}`} disabled={draft.rows.length === 1} onClick={() => update({ rows: draft.rows.filter((item) => item.id !== row.id) })}><Trash2 /></Button>
          </div>)}
          <Button type="button" variant="outline" size="sm" onClick={() => update({ rows: [...draft.rows, newRow()] })}><Plus />Add item</Button>
        </div>
        {isQuotation ? <div className="space-y-2"><Label htmlFor="free-payment">Payment details (optional)</Label><textarea id="free-payment" rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={draft.paymentDetails} onChange={(event) => update({ paymentDetails: event.target.value })} placeholder={"Bank: Example Bank\nA/C: 1234567890\nIFSC: EXMP0000123\nUPI: business@upi"} /></div> : null}
        <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Taxable value</span><span>₹{current.totals.taxableAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
          {draft.includesGst ? <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span>₹{(current.totals.cgstAmount + current.totals.sgstAmount + current.totals.igstAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div> : null}
          <div className="flex justify-between text-base font-semibold"><span>Total</span><span>₹{current.totals.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
        </div>
        {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void download()}>{busy ? <LoaderCircle className="animate-spin" /> : <Download />}Download {label.toLowerCase()} PDF</Button>
          <Button variant="ghost" onClick={() => { setDraft(emptyDraft(kind, draft.business)); setError("") }}>Start a new {label.toLowerCase()}</Button>
        </div>
      </CardContent>
    </Card>
    <div className="min-w-0 space-y-2">
      <p className="text-sm font-medium">Preview</p>
      <div className="rounded-lg border bg-muted/40 p-3"><InvoicePreview invoice={preview.invoice} entity={preview.entity} customer={preview.customer} template={template} documentType={kind} /></div>
    </div>
  </div>
}
