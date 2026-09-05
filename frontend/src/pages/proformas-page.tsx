import { useEffect, useMemo, useRef, useState } from "react"
import { Download, Eye, FilePlus2, ReceiptText, Share2, Trash2 } from "lucide-react"

import { InvoicePreview } from "@/components/invoice-preview"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { calculateInvoiceTotals } from "@/lib/invoice-calculations"
import { freeAllowanceError, getFreeDocumentAllowance } from "@/lib/free-document-allowance"
import { cleanInvoiceFileName, createInvoicePdf } from "@/lib/invoice-pdf"
import { useMvpStore, type InvoiceLineItem, type Proforma } from "@/lib/mvp-store"
import { sharePdfViaWhatsApp } from "@/lib/whatsapp-share"
import { useWorkspaceAccess } from "@/lib/workspace-access"

const today = () => new Date().toISOString().slice(0, 10)
const plusDays = (days: number) => { const value = new Date(); value.setDate(value.getDate() + days); return value.toISOString().slice(0, 10) }
type DraftProformaLine = InvoiceLineItem & { cgstRate: number; sgstRate: number; igstRate: number }
type ProformaDraft = { entityId: string; customerId: string; date: string; validUntil: string; items: DraftProformaLine[] }
const line = (hsnSac = ""): DraftProformaLine => ({ id: crypto.randomUUID(), description: "", hsnSac, taxableAmount: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, cgstRate: 0, sgstRate: 0, igstRate: 0 })
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
const hsnCodesFor = (company: { hsnSac: string; hsnSacCodes?: string[] } | undefined) => [...new Set([...(company?.hsnSacCodes || []), company?.hsnSac || ""].filter(Boolean))]
const roundMoney = (value: number) => Math.round(value * 100) / 100
const rateFromAmount = (amount: number, taxableAmount: number) => taxableAmount > 0 ? roundMoney(amount * 100 / taxableAmount) : 0

function restoreLine(value: Partial<DraftProformaLine>): DraftProformaLine {
  const taxableAmount = Math.max(0, Number(value.taxableAmount) || 0)
  const cgstAmount = Math.max(0, Number(value.cgstAmount) || 0)
  const sgstAmount = Math.max(0, Number(value.sgstAmount) || 0)
  const igstAmount = Math.max(0, Number(value.igstAmount) || 0)
  return {
    ...line(String(value.hsnSac || "")),
    ...value,
    id: String(value.id || crypto.randomUUID()),
    description: String(value.description || ""),
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    cgstRate: Math.max(0, Number(value.cgstRate) || rateFromAmount(cgstAmount, taxableAmount)),
    sgstRate: Math.max(0, Number(value.sgstRate) || rateFromAmount(sgstAmount, taxableAmount)),
    igstRate: Math.max(0, Number(value.igstRate) || rateFromAmount(igstAmount, taxableAmount)),
  }
}

export function ProformasPage() {
  const { setup, companies, customers, proformas, template, addProforma, updateProforma, deleteProforma, addInvoice } = useMvpStore()
  const { can, refresh, workspace, subscription, creditAccount } = useWorkspaceAccess()
  const canManage = can("invoices.manage")
  const quotationAllowance = getFreeDocumentAllowance(setup, subscription, creditAccount, "quotation", proformas.length)
  const [entityId, setEntityId] = useState(companies[0]?.id || "")
  const availableCustomers = customers.filter((customer) => customer.entityId === entityId)
  const [customerId, setCustomerId] = useState(availableCustomers[0]?.id || "")
  const [date, setDate] = useState(today())
  const [validUntil, setValidUntil] = useState(plusDays(15))
  const [items, setItems] = useState<DraftProformaLine[]>([line()])
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [preview, setPreview] = useState<Proforma | null>(null)
  const invoiceItems = useMemo<InvoiceLineItem[]>(() => items.map(({ cgstRate: _cgstRate, sgstRate: _sgstRate, igstRate: _igstRate, ...item }) => item), [items])
  const totals = useMemo(() => calculateInvoiceTotals(invoiceItems), [invoiceItems])
  const entity = companies.find((company) => company.id === entityId)
  const customer = customers.find((item) => item.id === customerId)
  const entityHsnCodes = hsnCodesFor(entity)
  const draftStorageKey = workspace?.id ? `chanax.proforma-draft.${workspace.id}` : ""
  const loadedDraftKey = useRef("")

  useEffect(() => {
    if (!draftStorageKey || loadedDraftKey.current === draftStorageKey) return
    loadedDraftKey.current = draftStorageKey
    try {
      const saved = localStorage.getItem(draftStorageKey)
      if (!saved) return
      const draft = JSON.parse(saved) as Partial<ProformaDraft>
      if (draft.entityId) setEntityId(draft.entityId)
      if (draft.customerId) setCustomerId(draft.customerId)
      if (draft.date) setDate(draft.date)
      if (draft.validUntil) setValidUntil(draft.validUntil)
      if (Array.isArray(draft.items) && draft.items.length) setItems(draft.items.map(restoreLine))
    } catch {
      localStorage.removeItem(draftStorageKey)
    }
  }, [draftStorageKey])

  useEffect(() => {
    if (!draftStorageKey || loadedDraftKey.current !== draftStorageKey) return
    localStorage.setItem(draftStorageKey, JSON.stringify({ entityId, customerId, date, validUntil, items } satisfies ProformaDraft))
  }, [customerId, date, draftStorageKey, entityId, items, validUntil])

  useEffect(() => {
    if (!companies.length || companies.some((company) => company.id === entityId)) return
    setEntityId(companies[0].id)
  }, [companies, entityId])

  useEffect(() => {
    if (!entityId || availableCustomers.some((available) => available.id === customerId)) return
    setCustomerId(availableCustomers[0]?.id || "")
  }, [availableCustomers, customerId, entityId])

  const updateLine = (id: string, changes: Partial<DraftProformaLine>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item))
  const updateTaxableAmount = (id: string, taxableAmount: number) => setItems((current) => current.map((item) => item.id !== id ? item : {
    ...item,
    taxableAmount,
    cgstAmount: roundMoney(taxableAmount * item.cgstRate / 100),
    sgstAmount: roundMoney(taxableAmount * item.sgstRate / 100),
    igstAmount: roundMoney(taxableAmount * item.igstRate / 100),
  }))
  const updateTaxRate = (id: string, field: "cgstRate" | "sgstRate" | "igstRate", suppliedRate: number) => {
    const rate = Math.min(100, Math.max(0, suppliedRate))
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item
      if (field === "igstRate") return { ...item, igstRate: rate, igstAmount: roundMoney(item.taxableAmount * rate / 100), ...(rate > 0 ? { cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0 } : {}) }
      return { ...item, [field]: rate, [field === "cgstRate" ? "cgstAmount" : "sgstAmount"]: roundMoney(item.taxableAmount * rate / 100), ...(rate > 0 ? { igstRate: 0, igstAmount: 0 } : {}) }
    }))
  }
  const proformaTemplate = { ...template, elements: { ...template.elements, invoiceTitle: { ...template.elements.invoiceTitle, label: "QUOTATION / PROFORMA" } } }

  async function save() {
    setError(""); setNotice("")
    if (!canManage) return setError("You do not have permission to generate proforma invoices.")
    if (!entity || !customer) return setError("Select an issuing entity and customer.")
    if (!items.length || items.some((item) => !item.description.trim() || item.taxableAmount <= 0)) return setError("Every line requires a description and taxable amount.")
    const allowanceError = freeAllowanceError(quotationAllowance, 1)
    if (allowanceError) return setError(allowanceError)
    try {
      await addProforma({ entityId, entityName: entity.companyName, customerId, companyName: customer.companyName, date, validUntil, amount: totals.amount, taxableAmount: totals.taxableAmount, cgstAmount: totals.cgstAmount, sgstAmount: totals.sgstAmount, igstAmount: totals.igstAmount, lineItems: invoiceItems, status: "Generated" })
      await refresh()
      if (draftStorageKey) localStorage.removeItem(draftStorageKey)
      setItems([line(entityHsnCodes[0])])
      setNotice("Quotation generated. One quotation credit was used; your invoice and payslip credits were not affected.")
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "The proforma could not be generated.") }
  }

  async function pdf(record: Proforma) {
    const recordEntity = companies.find((company) => company.id === record.entityId)
    const recordCustomer = customers.find((item) => item.id === record.customerId)
    return createInvoicePdf({ invoice: record, entity: recordEntity, customer: recordCustomer, template: proformaTemplate, documentType: "quotation" })
  }

  async function download(record: Proforma) {
    const doc = await pdf(record)
    doc.save(`${cleanInvoiceFileName(record.companyName)}_${record.date}_proforma.pdf`)
  }

  async function share(record: Proforma) {
    await sharePdfViaWhatsApp({ title: `Proforma ${record.number}`, message: `Proforma ${record.number} for ${record.companyName}.`, createFile: async () => { const doc = await pdf(record); return { name: `${cleanInvoiceFileName(record.companyName)}_${record.date}_proforma.pdf`, data: new Uint8Array(doc.output("arraybuffer")) } } })
  }

  async function convert(record: Proforma) {
    if (record.convertedInvoiceId) return
    try {
      await addInvoice({ entityName: record.entityName, customerId: record.customerId, companyName: record.companyName, date: today(), amount: record.amount, taxableAmount: record.taxableAmount, cgstAmount: record.cgstAmount, sgstAmount: record.sgstAmount, igstAmount: record.igstAmount, lineItems: record.lineItems, status: "Generated" })
      await updateProforma(record.id, { convertedInvoiceId: "created" })
      await refresh()
      setNotice(`${record.number} converted into a final sales invoice. One document credit was used; the original quotation remains saved.`)
    } catch (conversionError) { setError(conversionError instanceof Error ? conversionError.message : "Conversion failed.") }
  }

  return <div className="space-y-7">
    <PageHeader eyebrow="Quotations" title="Proforma quotations" description="Prepare a quotation before a sale, then convert an accepted quotation into a final sales invoice." />
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{notice}</p> : null}
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-semibold">A proforma is a quotation—not a sales or tax invoice.</p><p className="mt-1">It does not record a completed sale. Generated documents carry this notice clearly in both the preview and downloaded PDF.</p></div>
    {quotationAllowance ? <p className={`rounded-lg border p-3 text-sm ${quotationAllowance.remaining === 0 ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" : "bg-muted/40 text-muted-foreground"}`}><strong className="text-foreground">Quotation credits:</strong> {quotationAllowance.remaining} remaining. These credits can only be used for proforma quotations.</p> : null}
    <Card><CardHeader><CardTitle>New quotation / proforma</CardTitle><CardDescription>One quotation credit is used only after successful generation. Converting it later creates a final invoice and uses one document credit.</CardDescription></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-2"><Label htmlFor="proforma-entity">Issuing entity</Label><select id="proforma-entity" className={selectClass} value={entityId} onChange={(event) => { const next = event.target.value; const nextHsnCodes = hsnCodesFor(companies.find((company) => company.id === next)); setEntityId(next); setCustomerId(customers.find((item) => item.entityId === next)?.id || ""); setItems((current) => current.map((item) => ({ ...item, hsnSac: nextHsnCodes.includes(item.hsnSac) ? item.hsnSac : nextHsnCodes[0] || "" }))) }}>{companies.map((company) => <option key={company.id} value={company.id}>{company.companyName}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="proforma-customer">Customer</Label><select id="proforma-customer" className={selectClass} value={customerId} onChange={(event) => setCustomerId(event.target.value)}>{availableCustomers.map((item) => <option key={item.id} value={item.id}>{item.companyName}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="proforma-date">Issue date</Label><Input id="proforma-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="proforma-valid-until">Valid until</Label><Input id="proforma-valid-until" type="date" min={date} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></div>
      </div>
      <div className="space-y-3">{items.map((item, index) => <div key={item.id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[2fr_1fr_repeat(4,1fr)_auto]">
        <Input aria-label={`Description ${index + 1}`} placeholder="Description" value={item.description} onChange={(event) => updateLine(item.id, { description: event.target.value })} />
        {entityHsnCodes.length ? <select aria-label={`HSN or SAC ${index + 1}`} className={selectClass} value={item.hsnSac} onChange={(event) => updateLine(item.id, { hsnSac: event.target.value })}><option value="">Select HSN/SAC</option>{entityHsnCodes.map((code) => <option key={code} value={code}>{code}</option>)}</select> : <Input aria-label={`HSN or SAC ${index + 1}`} placeholder="HSN/SAC (optional)" value={item.hsnSac} onChange={(event) => updateLine(item.id, { hsnSac: event.target.value })} />}
        <Input aria-label={`Taxable amount ${index + 1}`} type="number" min="0" step="0.01" placeholder="TAXABLE" value={item.taxableAmount || ""} onChange={(event) => updateTaxableAmount(item.id, Math.max(0, Number(event.target.value) || 0))} />
        {(["cgstRate", "sgstRate", "igstRate"] as const).map((field) => <Input key={field} aria-label={`${field.replace("Rate", "").toUpperCase()} percentage ${index + 1}`} type="number" min="0" max="100" step="0.01" placeholder={`${field.replace("Rate", "").toUpperCase()} %`} value={item[field] || ""} onChange={(event) => updateTaxRate(item.id, field, Number(event.target.value) || 0)} />)}
        <Button size="icon" variant="ghost" aria-label="Remove line" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}><Trash2 /></Button>
      </div>)}</div>
      <p className="text-xs text-muted-foreground">Enter GST percentages. Adding IGST clears CGST/SGST, and adding CGST or SGST clears IGST. Your unfinished proforma is saved on this device.</p>
      <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" onClick={() => setItems((current) => [...current, line(entityHsnCodes[0])])}><FilePlus2 />Add description</Button><div className="text-right"><p className="text-sm text-muted-foreground">Taxable ₹{totals.taxableAmount.toLocaleString("en-IN")}</p><p className="text-lg font-semibold">Total ₹{totals.amount.toLocaleString("en-IN")}</p></div></div>
      <div className="flex justify-end"><Button disabled={!canManage || !companies.length || !availableCustomers.length || quotationAllowance?.remaining === 0} onClick={() => void save()}><ReceiptText />Generate quotation</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Quotation register</CardTitle><CardDescription>Generated quotations can be downloaded, shared or converted without changing their original record.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{proformas.length ? proformas.map((record) => <TableRow key={record.id}><TableCell className="font-medium">{record.number}</TableCell><TableCell>{record.companyName}</TableCell><TableCell>{record.date}</TableCell><TableCell>₹{record.amount.toLocaleString("en-IN")}</TableCell><TableCell><Badge variant="outline">{record.convertedInvoiceId ? "Converted" : record.status}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" aria-label="Preview quotation" onClick={() => setPreview(record)}><Eye /></Button><Button size="icon" variant="ghost" aria-label="Download quotation" onClick={() => void download(record)}><Download /></Button><Button size="icon" variant="ghost" aria-label="Share quotation" onClick={() => void share(record)}><Share2 /></Button><Button size="sm" variant="outline" disabled={!canManage || Boolean(record.convertedInvoiceId)} onClick={() => void convert(record)}>Convert to invoice</Button><Button size="icon" variant="ghost" aria-label="Delete quotation" disabled={!canManage} onClick={() => void deleteProforma(record.id)}><Trash2 /></Button></div></TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No quotations yet.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    {preview ? <div className="fixed inset-0 z-50 overflow-auto bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Quotation preview"><div className="mx-auto max-w-5xl space-y-3"><div className="flex justify-end"><Button variant="secondary" onClick={() => setPreview(null)}>Close preview</Button></div><InvoicePreview invoice={preview} entity={companies.find((item) => item.id === preview.entityId)} customer={customers.find((item) => item.id === preview.customerId)} template={proformaTemplate} documentType="quotation" /></div></div> : null}
  </div>
}
