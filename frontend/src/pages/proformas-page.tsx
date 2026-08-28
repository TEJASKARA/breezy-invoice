import { useMemo, useState } from "react"
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
import { cleanInvoiceFileName, createInvoicePdf } from "@/lib/invoice-pdf"
import { useMvpStore, type InvoiceLineItem, type Proforma } from "@/lib/mvp-store"
import { sharePdfViaWhatsApp } from "@/lib/whatsapp-share"
import { useWorkspaceAccess } from "@/lib/workspace-access"

const today = () => new Date().toISOString().slice(0, 10)
const plusDays = (days: number) => { const value = new Date(); value.setDate(value.getDate() + days); return value.toISOString().slice(0, 10) }
const line = (): InvoiceLineItem => ({ id: crypto.randomUUID(), description: "", hsnSac: "", taxableAmount: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0 })
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

export function ProformasPage() {
  const { companies, customers, proformas, template, addProforma, updateProforma, deleteProforma, addInvoice } = useMvpStore()
  const { can, refresh } = useWorkspaceAccess()
  const canManage = can("invoices.manage")
  const [entityId, setEntityId] = useState(companies[0]?.id || "")
  const availableCustomers = customers.filter((customer) => customer.entityId === entityId)
  const [customerId, setCustomerId] = useState(availableCustomers[0]?.id || "")
  const [date, setDate] = useState(today())
  const [validUntil, setValidUntil] = useState(plusDays(15))
  const [items, setItems] = useState<InvoiceLineItem[]>([line()])
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [preview, setPreview] = useState<Proforma | null>(null)
  const totals = useMemo(() => calculateInvoiceTotals(items), [items])
  const entity = companies.find((company) => company.id === entityId)
  const customer = customers.find((item) => item.id === customerId)

  const updateLine = (id: string, changes: Partial<InvoiceLineItem>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item))
  const proformaTemplate = { ...template, elements: { ...template.elements, invoiceTitle: { ...template.elements.invoiceTitle, label: "PROFORMA INVOICE" } } }

  async function save() {
    setError(""); setNotice("")
    if (!canManage) return setError("You do not have permission to generate proforma invoices.")
    if (!entity || !customer) return setError("Select an issuing entity and customer.")
    if (!items.length || items.some((item) => !item.description.trim() || item.taxableAmount <= 0)) return setError("Every line requires a description and taxable amount.")
    try {
      await addProforma({ entityId, entityName: entity.companyName, customerId, companyName: customer.companyName, date, validUntil, amount: totals.amount, taxableAmount: totals.taxableAmount, cgstAmount: totals.cgstAmount, sgstAmount: totals.sgstAmount, igstAmount: totals.igstAmount, lineItems: items, status: "Generated" })
      await refresh()
      setItems([line()])
      setNotice("Proforma invoice generated. One shared credit was used.")
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "The proforma could not be generated.") }
  }

  async function pdf(record: Proforma) {
    const recordEntity = companies.find((company) => company.id === record.entityId)
    const recordCustomer = customers.find((item) => item.id === record.customerId)
    return createInvoicePdf({ invoice: record, entity: recordEntity, customer: recordCustomer, template: proformaTemplate })
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
      setNotice(`${record.number} converted into a final invoice. One additional credit was used.`)
    } catch (conversionError) { setError(conversionError instanceof Error ? conversionError.message : "Conversion failed.") }
  }

  return <div className="space-y-7">
    <PageHeader eyebrow="Sales documents" title="Proforma invoices" description="Create quotations in invoice format and convert accepted proformas into final invoices." />
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{notice}</p> : null}
    <Card><CardHeader><CardTitle>New proforma</CardTitle><CardDescription>A credit is used only after successful generation. Conversion creates a separate invoice and uses another credit.</CardDescription></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-2"><Label htmlFor="proforma-entity">Issuing entity</Label><select id="proforma-entity" className={selectClass} value={entityId} onChange={(event) => { const next = event.target.value; setEntityId(next); setCustomerId(customers.find((item) => item.entityId === next)?.id || "") }}>{companies.map((company) => <option key={company.id} value={company.id}>{company.companyName}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="proforma-customer">Customer</Label><select id="proforma-customer" className={selectClass} value={customerId} onChange={(event) => setCustomerId(event.target.value)}>{availableCustomers.map((item) => <option key={item.id} value={item.id}>{item.companyName}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="proforma-date">Issue date</Label><Input id="proforma-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="proforma-valid-until">Valid until</Label><Input id="proforma-valid-until" type="date" min={date} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></div>
      </div>
      <div className="space-y-3">{items.map((item, index) => <div key={item.id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[2fr_1fr_repeat(4,1fr)_auto]">
        <Input aria-label={`Description ${index + 1}`} placeholder="Description" value={item.description} onChange={(event) => updateLine(item.id, { description: event.target.value })} />
        <Input aria-label={`HSN or SAC ${index + 1}`} placeholder="HSN/SAC" value={item.hsnSac} onChange={(event) => updateLine(item.id, { hsnSac: event.target.value })} />
        {(["taxableAmount", "cgstAmount", "sgstAmount", "igstAmount"] as const).map((field) => <Input key={field} aria-label={`${field} ${index + 1}`} type="number" min="0" placeholder={field.replace("Amount", "").toUpperCase()} value={item[field] || ""} onChange={(event) => updateLine(item.id, { [field]: Math.max(0, Number(event.target.value) || 0) })} />)}
        <Button size="icon" variant="ghost" aria-label="Remove line" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}><Trash2 /></Button>
      </div>)}</div>
      <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" onClick={() => setItems((current) => [...current, line()])}><FilePlus2 />Add description</Button><div className="text-right"><p className="text-sm text-muted-foreground">Taxable ₹{totals.taxableAmount.toLocaleString("en-IN")}</p><p className="text-lg font-semibold">Total ₹{totals.amount.toLocaleString("en-IN")}</p></div></div>
      <div className="flex justify-end"><Button disabled={!canManage || !companies.length || !availableCustomers.length} onClick={() => void save()}><ReceiptText />Generate proforma</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Proforma register</CardTitle><CardDescription>Generated proformas can be downloaded, shared or converted without changing their original record.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{proformas.length ? proformas.map((record) => <TableRow key={record.id}><TableCell className="font-medium">{record.number}</TableCell><TableCell>{record.companyName}</TableCell><TableCell>{record.date}</TableCell><TableCell>₹{record.amount.toLocaleString("en-IN")}</TableCell><TableCell><Badge variant="outline">{record.convertedInvoiceId ? "Converted" : record.status}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" aria-label="Preview proforma" onClick={() => setPreview(record)}><Eye /></Button><Button size="icon" variant="ghost" aria-label="Download proforma" onClick={() => void download(record)}><Download /></Button><Button size="icon" variant="ghost" aria-label="Share proforma" onClick={() => void share(record)}><Share2 /></Button><Button size="sm" variant="outline" disabled={!canManage || Boolean(record.convertedInvoiceId)} onClick={() => void convert(record)}>Convert</Button><Button size="icon" variant="ghost" aria-label="Delete proforma" disabled={!canManage} onClick={() => void deleteProforma(record.id)}><Trash2 /></Button></div></TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No proforma invoices yet.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    {preview ? <div className="fixed inset-0 z-50 overflow-auto bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Proforma preview"><div className="mx-auto max-w-5xl space-y-3"><div className="flex justify-end"><Button variant="secondary" onClick={() => setPreview(null)}>Close preview</Button></div><InvoicePreview invoice={preview} entity={companies.find((item) => item.id === preview.entityId)} customer={customers.find((item) => item.id === preview.customerId)} template={proformaTemplate} /></div></div> : null}
  </div>
}
