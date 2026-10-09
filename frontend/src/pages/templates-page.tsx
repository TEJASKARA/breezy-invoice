import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { AlignCenter, AlignLeft, AlignRight, Building2, Check, Eye, EyeOff, FilePlus2, ImagePlus, Move, Plus, ReceiptText, RotateCcw, Save, Trash2, Undo2, Upload } from "lucide-react"

import { InvoicePreview } from "@/components/invoice-preview"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { type Company, type Customer, type Invoice, type TemplateElementId, type TemplateSettings, type TemplateTextBlock, useMvpStore } from "@/lib/mvp-store"
import { useWorkspaceAccess } from "@/lib/workspace-access"
import { canRemoveChanaxBranding } from "@/lib/subscription-entitlements"
import { cn } from "@/lib/utils"
import { trackAction } from "@/lib/usage-tracking"

const templates = [
  { id: "classic" as const, name: "Classic Ledger", description: "Traditional bordered GST invoice" },
  { id: "breeze" as const, name: "Modern Breeze", description: "Bold, modern and brand-forward" },
  { id: "minimal" as const, name: "Minimal Professional", description: "Clean layout with generous spacing" },
]

const DEFAULT_SCOPE = "default"
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

const colors = ["#2563EB", "#0F172A", "#059669", "#E11D48", "#D97706", "#7C3AED"]
const pageColors = ["#FFFFFF", "#F8FAFC", "#FFF7ED", "#FFFBEB", "#F0FDF4", "#EFF6FF", "#FAF5FF"]
const editableElements: { id: TemplateElementId; name: string; canRename: boolean }[] = [
  { id: "logo", name: "Company logo", canRename: false },
  { id: "issuer", name: "Company details", canRename: false },
  { id: "invoiceTitle", name: "Invoice title", canRename: true },
  { id: "customer", name: "Customer details", canRename: true },
  { id: "invoiceDetails", name: "Invoice information", canRename: true },
  { id: "lineItems", name: "Item table", canRename: false },
  { id: "totals", name: "Totals", canRename: false },
  { id: "terms", name: "Terms and conditions", canRename: true },
  { id: "signature", name: "Signature", canRename: true },
]
const resetElements = (): TemplateSettings["elements"] => ({
  logo: { visible: true, offsetX: 0, offsetY: 0, label: "Company logo" },
  issuer: { visible: true, offsetX: 0, offsetY: 0, label: "Company details" },
  invoiceTitle: { visible: true, offsetX: 0, offsetY: 0, label: "TAX INVOICE" },
  customer: { visible: true, offsetX: 0, offsetY: 0, label: "Bill to" },
  invoiceDetails: { visible: true, offsetX: 0, offsetY: 0, label: "Invoice details" },
  lineItems: { visible: true, offsetX: 0, offsetY: 0, label: "Item table" },
  totals: { visible: true, offsetX: 0, offsetY: 0, label: "Invoice totals" },
  terms: { visible: true, offsetX: 0, offsetY: 0, label: "Terms & conditions" },
  signature: { visible: true, offsetX: 0, offsetY: 0, label: "Authorised signatory" },
})

function TemplateThumbnail({ preset, color, pageColor }: { preset: TemplateSettings["preset"]; color: string; pageColor: string }) {
  return (
    <div className="aspect-[1.45] rounded-md border p-2 shadow-sm" style={{ backgroundColor: pageColor }}>
      {preset === "breeze" && <div className="mb-2 h-3 rounded-sm" style={{ backgroundColor: color }} />}
      <div className="flex justify-between gap-2">
        <div className="space-y-1"><div className="h-1.5 w-12 rounded-full" style={{ backgroundColor: color }} /><div className="h-1 w-8 rounded-full bg-slate-200" /></div>
        <div className="h-1.5 w-10 rounded-full" style={{ backgroundColor: preset === "classic" ? "#0f172a" : color }} />
      </div>
      <div className={cn("mt-3 grid grid-cols-3 gap-1", preset === "classic" && "border border-slate-300 p-1")}>
        <div className="h-1 rounded-full bg-slate-200" /><div className="h-1 rounded-full bg-slate-200" /><div className="h-1 rounded-full bg-slate-200" />
      </div>
      <div className="mt-2 space-y-1">{[1, 2, 3].map((row) => <div key={row} className="h-1 rounded-full bg-slate-100" />)}</div>
    </div>
  )
}

function sampleInvoice(entityName: string, customerName: string): Invoice {
  return {
    id: "template-preview",
    number: "INV-2026-0001",
    sourceNumber: "INV-2026-0001",
    entityName,
    companyName: customerName,
    date: "2026-08-05",
    status: "Generated",
    amount: 47200,
    lineItems: [
      { id: "sample-1", description: "Professional services", hsnSac: "998311", taxableAmount: 25000, cgstAmount: 2250, sgstAmount: 2250, igstAmount: 0 },
      { id: "sample-2", description: "Monthly compliance support", hsnSac: "998311", taxableAmount: 12500, cgstAmount: 1125, sgstAmount: 1125, igstAmount: 0 },
      { id: "sample-3", description: "Documentation charges", hsnSac: "998311", taxableAmount: 2500, cgstAmount: 225, sgstAmount: 225, igstAmount: 0 },
    ],
  }
}

export function TemplatesPage() {
  const {
    setup,
    companies,
    customers,
    template: workspaceTemplate,
    updateTemplate: persistWorkspaceTemplate,
    templateFor,
    hasEntityTemplate,
    updateEntityTemplate,
    clearEntityTemplate,
  } = useMvpStore()
  const { can, subscription } = useWorkspaceAccess()

  const brandingCanBeRemoved = canRemoveChanaxBranding(subscription)
  const [scopeId, setScopeId] = useState<string>(DEFAULT_SCOPE)
  const scopeEntity = scopeId === DEFAULT_SCOPE ? undefined : companies.find((company) => company.id === scopeId)
  const canManage = can("templates.manage") && !scopeEntity?.transferredAt
  const activeScopeId = scopeEntity ? scopeEntity.id : DEFAULT_SCOPE
  const scopeHasCustomTemplate = Boolean(scopeEntity && hasEntityTemplate(scopeEntity.id))
  const savedTemplate: TemplateSettings = scopeEntity ? templateFor(scopeEntity.id) : workspaceTemplate
  // Unsaved edits live here until the user clicks Save.
  const [draft, setDraft] = useState<TemplateSettings | null>(null)
  const template: TemplateSettings = draft ?? savedTemplate
  const isDirty = draft !== null
  const scopeName = scopeEntity ? scopeEntity.companyName : "all entities"
  const updateTemplate = (changes: Partial<TemplateSettings>) => {
    if (!canManage) return
    setDraft((current) => ({ ...(current ?? savedTemplate), ...changes }))
  }
  const logoInputRef = useRef<HTMLInputElement>(null)
  const signatureInputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null)
  const [colorDraft, setColorDraft] = useState(template.accentColor)
  const [pageColorDraft, setPageColorDraft] = useState(template.pageColor)
  const [selectedTextId, setSelectedTextId] = useState<string | null>(template.customTexts[0]?.id ?? null)
  const [selectedElementId, setSelectedElementId] = useState<TemplateElementId | null>("invoiceTitle")
  const [previewDocumentType, setPreviewDocumentType] = useState<"invoice" | "quotation">("invoice")

  const previewEntity: Company = scopeEntity ?? companies[0] ?? {
    id: "preview-entity",
    companyName: setup?.firmName || "Your Firm Name",
    billingAddress: setup?.mailingAddress || "Your mailing address will appear here",
    premisesAddress: setup?.mailingAddress || "",
    gstin: setup?.gstin || "36ABCDE1234F1Z5",
    pan: setup?.gstin?.slice(2, 12) || "ABCDE1234F",
    hsnSac: "998311",
  }
  const previewCustomer: Customer = customers.find((customer) => customer.entityId === previewEntity.id) ?? customers[0] ?? {
    id: "preview-customer",
    entityId: previewEntity.id,
    companyName: "Sample Client Private Limited",
    billingAddress: "Client billing address will appear here",
    premisesAddress: "Client premises address",
    gstin: "36AAACS1234A1Z5",
    pan: "AAACS1234A",
    hsnSac: "998311",
  }
  const previewInvoice = useMemo(
    () => sampleInvoice(previewEntity.companyName, previewCustomer.companyName),
    [previewEntity.companyName, previewCustomer.companyName],
  )
  const previewDocument = useMemo(() => previewDocumentType === "quotation" ? {
    ...previewInvoice,
    number: "QTN-2026-0001",
    sourceNumber: "QTN-2026-0001",
    validUntil: "2026-08-20",
  } : previewInvoice, [previewDocumentType, previewInvoice])
  const selectedText = template.customTexts.find((block) => block.id === selectedTextId) ?? null
  const selectedElementDefinition = editableElements.find((item) => item.id === selectedElementId) ?? null
  const selectedElement = selectedElementId ? template.elements[selectedElementId] : null

  useEffect(() => setColorDraft(template.accentColor), [template.accentColor])
  useEffect(() => setPageColorDraft(template.pageColor), [template.pageColor])
  useEffect(() => {
    setSelectedTextId(null)
    setSelectedElementId("invoiceTitle")
  }, [activeScopeId])
  useEffect(() => {
    if (scopeId !== DEFAULT_SCOPE && !companies.some((company) => company.id === scopeId)) {
      setDraft(null)
      setScopeId(DEFAULT_SCOPE)
    }
  }, [companies, scopeId])
  useEffect(() => {
    if (!isDirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isDirty])

  const showMessage = (text: string, type: "success" | "error" = "success") => {
    setMessage({ text, type })
    window.setTimeout(() => setMessage(null), 4000)
  }

  const uploadImage = (kind: "logo" | "signature", event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      showMessage(`Please upload the ${kind} as a PNG or JPG image.`, "error")
      return
    }
    if (file.size > 1.5 * 1024 * 1024) {
      showMessage(`${kind === "logo" ? "Logo" : "Signature"} must be smaller than 1.5 MB.`, "error")
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (kind === "logo") updateTemplate({ logoDataUrl: String(reader.result) })
      else updateTemplate({ signatureDataUrl: String(reader.result), signatureMode: "uploaded" })
      showMessage(`${kind === "logo" ? "Logo" : "Signature"} added. Click Save to apply it to ${scopeName}.`)
    }
    reader.onerror = () => showMessage(`The ${kind} image could not be read.`, "error")
    reader.readAsDataURL(file)
  }

  const updateText = (id: string, changes: Partial<TemplateTextBlock>) => {
    updateTemplate({ customTexts: template.customTexts.map((block) => block.id === id ? { ...block, ...changes } : block) })
  }

  const updateElement = (id: TemplateElementId, changes: Partial<TemplateSettings["elements"][TemplateElementId]>) => {
    updateTemplate({ elements: { ...template.elements, [id]: { ...template.elements[id], ...changes } } })
  }

  const addText = () => {
    const block: TemplateTextBlock = {
      id: crypto.randomUUID(),
      text: "Enter your text here",
      x: 8,
      y: Math.min(88, 70 + template.customTexts.length * 5),
      fontSize: 12,
      bold: false,
      color: "#18181B",
      align: "left",
    }
    updateTemplate({ customTexts: [...template.customTexts, block] })
    setSelectedTextId(block.id)
  }

  const resetTemplate = () => {
    updateTemplate({
      preset: "breeze",
      accentColor: "#2563EB",
      pageColor: "#FFFFFF",
      logoDataUrl: null,
      logoSize: 64,
      watermarkEnabled: false,
      watermarkText: "DRAFT",
      watermarkOpacity: 0.1,
      showChanaxBranding: true,
      signatureDataUrl: null,
      signatureMode: "system",
      showTerms: true,
      termsText: "Payment is due as agreed with the issuing entity. Thank you for your business.",
      customTexts: [],
      fontStyle: "sans",
      compact: false,
      elements: resetElements(),
    })
    setSelectedTextId(null)
    showMessage(`Template reset to Modern Breeze. Click Save to apply it to ${scopeName}.`)
  }

  const saveTemplate = () => {
    if (!canManage || !draft) return
    const securedDraft = brandingCanBeRemoved ? draft : { ...draft, showChanaxBranding: true }
    const { entityTemplates: _entityTemplates, ...changes } = securedDraft
    if (scopeEntity) updateEntityTemplate(scopeEntity.id, changes)
    else persistWorkspaceTemplate(changes)
    setDraft(null)
    trackAction("template_saved", { scope: scopeEntity ? "entity" : "default" })
    showMessage(`Template saved for ${scopeName}.`)
  }

  const discardChanges = () => {
    setDraft(null)
    showMessage("Unsaved changes discarded.")
  }

  const changeScope = (nextScopeId: string) => {
    if (nextScopeId === activeScopeId) return
    if (isDirty && !window.confirm(`You have unsaved template changes for ${scopeName}. Discard them?`)) return
    setDraft(null)
    setScopeId(nextScopeId)
  }

  const switchToDefaultTemplate = () => {
    if (!canManage || !scopeEntity) return
    if (!window.confirm(`Remove the custom template for ${scopeEntity.companyName} and use the default template?`)) return
    setDraft(null)
    clearEntityTemplate(scopeEntity.id)
    showMessage(`${scopeEntity.companyName} now uses the default template.`)
  }

  const createEntityTemplate = () => {
    if (!canManage || !scopeEntity) return
    const securedTemplate = brandingCanBeRemoved ? template : { ...template, showChanaxBranding: true }
    const { entityTemplates: _entityTemplates, ...changes } = securedTemplate
    updateEntityTemplate(scopeEntity.id, changes)
    setDraft(null)
    showMessage(`Custom template created for ${scopeEntity.companyName}.`)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Document studio"
        title="Design sales invoices and quotations"
        description="Pick an entity to give it its own logo, colours and layout. Entities without a custom template use the default. Downloaded PDFs use these same saved settings."
        actions={canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={resetTemplate}><RotateCcw />Reset</Button>
            <Button variant="outline" disabled={!isDirty} onClick={discardChanges}><Undo2 />Discard</Button>
            <Button disabled={!isDirty} onClick={saveTemplate}><Save />{isDirty ? "Save changes" : "Saved"}</Button>
          </div>
        ) : null}
      />

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-end">
          <div className="w-full space-y-2 md:max-w-sm">
            <Label htmlFor="template-scope" className="flex items-center gap-2"><Building2 className="size-4" />Template for</Label>
            <select id="template-scope" className={selectClass} value={activeScopeId} onChange={(event) => changeScope(event.target.value)}>
              <option value={DEFAULT_SCOPE}>Default template (all entities)</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>{company.companyName}{hasEntityTemplate(company.id) ? " — custom" : ""}</option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
            {!scopeEntity ? (
              <>
                <Badge variant="secondary">Default</Badge>
                <span className="text-muted-foreground">
                  Used by every entity without its own template
                  {companies.length ? ` (${companies.filter((company) => !hasEntityTemplate(company.id)).length} of ${companies.length})` : ""}.
                </span>
              </>
            ) : scopeHasCustomTemplate ? (
              <>
                <Badge>Custom template</Badge>
                <span className="text-muted-foreground">Used for every document issued by {scopeEntity.companyName}.</span>
                {canManage ? <Button size="sm" variant="outline" className="md:ml-auto" onClick={switchToDefaultTemplate}><Undo2 />Use default template</Button> : null}
              </>
            ) : (
              <>
                <Badge variant="outline">Using default</Badge>
                <span className="text-muted-foreground">Saving changes here creates a custom template for {scopeEntity.companyName}.</span>
                {canManage ? <Button size="sm" className="md:ml-auto" onClick={createEntityTemplate}><Plus />Create custom template</Button> : null}
              </>
            )}
          </div>
          {isDirty ? (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 md:w-auto">
              <span>Unsaved changes</span>
              <Button size="sm" onClick={saveTemplate}><Save />Save</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!canManage ? <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">You have view-only access to this template. Ask a workspace admin for template editing permission to make changes.</p> : null}

      {message && (
        <p
          role={message.type === "error" ? "alert" : "status"}
          className={cn(
            "rounded-lg border px-4 py-3 text-sm font-medium",
            message.type === "error"
              ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              : "border-border bg-muted text-foreground",
          )}
        >
          {message.text}
        </p>
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
        <Card className={cn("h-fit xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto", !canManage && "pointer-events-none opacity-70")}>
          <CardContent className="space-y-6 p-5">
            <section className="space-y-3">
              <div><h2 className="font-semibold">Choose a template</h2><p className="text-sm text-muted-foreground">Three layouts designed for Indian GST invoices.</p></div>
              <div className="space-y-3">
                {templates.map((item) => (
                  <button key={item.id} type="button" onClick={() => updateTemplate({ preset: item.id })} className={cn("grid w-full grid-cols-[88px_1fr_auto] items-center gap-3 rounded-lg border p-2 text-left transition hover:bg-muted/50", template.preset === item.id && "border-foreground ring-1 ring-foreground")}>
                    <TemplateThumbnail preset={item.id} color={template.accentColor} pageColor={template.pageColor} />
                    <span className="min-w-0"><span className="block text-sm font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{item.description}</span></span>
                    {template.preset === item.id && <Check className="size-4" aria-label="Selected" />}
                  </button>
                ))}
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div><Label>Invoice elements</Label><p className="mt-1 text-xs text-muted-foreground">Select an existing item, drag it in the preview, rename its heading, or remove it.</p></div>
              <div className="grid grid-cols-2 gap-2">
                {editableElements.map((item) => {
                  const setting = template.elements[item.id]
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { setSelectedElementId(item.id); setSelectedTextId(null) }}
                      className={cn("flex items-center gap-2 rounded-md border p-2 text-left text-xs", selectedElementId === item.id && "border-foreground bg-muted", !setting.visible && "text-muted-foreground")}
                    >
                      {setting.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    </button>
                  )
                })}
              </div>
              {selectedElement && selectedElementDefinition && selectedElementId && (
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{selectedElementDefinition.name}</p><Button size="sm" variant="outline" onClick={() => updateElement(selectedElementId, { visible: !selectedElement.visible })}>{selectedElement.visible ? <><EyeOff />Hide</> : <><Eye />Restore</>}</Button></div>
                  {selectedElementDefinition.canRename && <div><Label className="text-xs">Displayed heading</Label><Input value={selectedElement.label} onChange={(event) => updateElement(selectedElementId, { label: event.target.value })} /></div>}
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Horizontal position</Label><Input type="number" min="-35" max="35" value={Math.round(selectedElement.offsetX)} onChange={(event) => updateElement(selectedElementId, { offsetX: Math.min(35, Math.max(-35, Number(event.target.value) || 0)) })} /></div>
                    <div><Label className="text-xs">Vertical position</Label><Input type="number" min="-35" max="35" value={Math.round(selectedElement.offsetY)} onChange={(event) => updateElement(selectedElementId, { offsetY: Math.min(35, Math.max(-35, Number(event.target.value) || 0)) })} /></div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateElement(selectedElementId, { offsetX: 0, offsetY: 0 })}><Undo2 />Reset position</Button>
                    <Button className="ml-auto" size="sm" variant="destructive" disabled={!selectedElement.visible} onClick={() => updateElement(selectedElementId, { visible: false })}><Trash2 />Remove</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Removed items stay in this list so you can restore them later.</p>
                </div>
              )}
            </section>

            <Separator />

            <section className="space-y-3">
              <div><Label>Company logo</Label><p className="mt-1 text-xs text-muted-foreground">PNG or JPG, up to 1.5 MB.</p></div>
              <input ref={logoInputRef} id="template-logo-upload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" className="sr-only" onChange={(event) => uploadImage("logo", event)} />
              {template.logoDataUrl ? (
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <img src={template.logoDataUrl} alt="Uploaded company logo" className="size-14 rounded-md object-contain" />
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium">Custom logo</p><p className="text-xs text-muted-foreground">Included in previews and PDFs</p></div>
                  <Button variant="ghost" size="icon" onClick={() => updateTemplate({ logoDataUrl: null })} aria-label="Remove logo"><Trash2 /></Button>
                </div>
              ) : (
                <Button asChild variant="outline" className="h-auto w-full justify-start border-dashed p-4">
                  <label htmlFor="template-logo-upload" className="cursor-pointer"><ImagePlus /><span className="text-left"><span className="block">Upload your logo</span><span className="block text-xs font-normal text-muted-foreground">Choose a PNG or JPG</span></span></label>
                </Button>
              )}
              {template.logoDataUrl && <Button variant="outline" className="w-full" onClick={() => logoInputRef.current?.click()}><Upload />Replace logo</Button>}
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3"><Label htmlFor="template-logo-size" className="text-xs">Logo size</Label><span className="text-xs tabular-nums text-muted-foreground">{template.logoSize}px</span></div>
                <Input id="template-logo-size" type="range" min="40" max="120" step="4" value={template.logoSize} onChange={(event) => updateTemplate({ logoSize: Number(event.target.value) })} className="h-5 cursor-pointer p-0" />
                <p className="text-xs text-muted-foreground">Enlarge or reduce the logo in previews and downloaded documents.</p>
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div><Label>Signature</Label><p className="mt-1 text-xs text-muted-foreground">Upload a signature or show a system-generated declaration.</p></div>
              <div className="grid grid-cols-3 gap-2">
                <Button type="button" variant={template.signatureMode === "uploaded" ? "default" : "outline"} onClick={() => template.signatureDataUrl ? updateTemplate({ signatureMode: "uploaded" }) : signatureInputRef.current?.click()}>Upload</Button>
                <Button type="button" variant={template.signatureMode === "system" ? "default" : "outline"} onClick={() => updateTemplate({ signatureMode: "system" })}>System</Button>
                <Button type="button" variant={template.signatureMode === "none" ? "default" : "outline"} onClick={() => updateTemplate({ signatureMode: "none" })}>None</Button>
              </div>
              <input ref={signatureInputRef} id="template-signature-upload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" className="sr-only" onChange={(event) => uploadImage("signature", event)} />
              {template.signatureDataUrl && (
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <img src={template.signatureDataUrl} alt="Uploaded signature" className="h-12 w-28 object-contain object-left" />
                  <Button variant="outline" size="sm" onClick={() => signatureInputRef.current?.click()}>Replace</Button>
                  <Button variant="ghost" size="icon" aria-label="Remove signature" onClick={() => updateTemplate({ signatureDataUrl: null, signatureMode: "system" })}><Trash2 /></Button>
                </div>
              )}
              {template.signatureMode === "system" && <p className="rounded-md bg-muted p-3 text-xs">This is a system-generated invoice. A signature is not required.</p>}
            </section>

            <Separator />

            <section className="space-y-3">
              <label className="flex cursor-pointer items-center justify-between gap-4">
                <span><span className="block text-sm font-medium">Terms &amp; conditions</span><span className="block text-xs text-muted-foreground">Show or remove this section</span></span>
                <input type="checkbox" checked={template.showTerms} onChange={(event) => updateTemplate({ showTerms: event.target.checked })} className="size-4 accent-foreground" />
              </label>
              {template.showTerms && <textarea value={template.termsText} onChange={(event) => updateTemplate({ termsText: event.target.value })} rows={4} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Enter payment terms, bank instructions, or other conditions" />}
            </section>

            <Separator />

            <section className="space-y-3">
              <div className="flex items-start justify-between gap-3"><div><Label>Custom text</Label><p className="mt-1 text-xs text-muted-foreground">Add text and drag it anywhere on the invoice.</p></div><Button size="sm" onClick={addText}><Plus />Add text</Button></div>
              {template.customTexts.length > 0 && (
                <div className="space-y-2">
                  {template.customTexts.map((block, index) => (
                    <button key={block.id} type="button" onClick={() => { setSelectedTextId(block.id); setSelectedElementId(null) }} className={cn("flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm", selectedTextId === block.id && "border-foreground bg-muted")}><Move className="size-4" /><span className="min-w-0 flex-1 truncate">{block.text || `Text ${index + 1}`}</span></button>
                  ))}
                </div>
              )}
              {selectedText && (
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <textarea value={selectedText.text} onChange={(event) => updateText(selectedText.id, { text: event.target.value })} rows={3} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm" />
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Font size</Label><Input type="number" min="8" max="36" value={selectedText.fontSize} onChange={(event) => updateText(selectedText.id, { fontSize: Math.min(36, Math.max(8, Number(event.target.value) || 8)) })} /></div>
                    <div><Label className="text-xs">Text color</Label><Input type="color" value={selectedText.color} onChange={(event) => updateText(selectedText.id, { color: event.target.value.toUpperCase() })} className="p-1" /></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="icon" variant={selectedText.align === "left" ? "default" : "outline"} aria-label="Align left" onClick={() => updateText(selectedText.id, { align: "left" })}><AlignLeft /></Button>
                    <Button size="icon" variant={selectedText.align === "center" ? "default" : "outline"} aria-label="Align center" onClick={() => updateText(selectedText.id, { align: "center" })}><AlignCenter /></Button>
                    <Button size="icon" variant={selectedText.align === "right" ? "default" : "outline"} aria-label="Align right" onClick={() => updateText(selectedText.id, { align: "right" })}><AlignRight /></Button>
                    <Button variant={selectedText.bold ? "default" : "outline"} onClick={() => updateText(selectedText.id, { bold: !selectedText.bold })}>Bold</Button>
                    <Button className="ml-auto" size="icon" variant="destructive" aria-label="Delete custom text" onClick={() => { updateTemplate({ customTexts: template.customTexts.filter((block) => block.id !== selectedText.id) }); setSelectedTextId(null) }}><Trash2 /></Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Position: {Math.round(selectedText.x)}% from left, {Math.round(selectedText.y)}% from top. Drag the highlighted text on the preview to move it.</p>
                </div>
              )}
            </section>

            <Separator />

            <section className="space-y-3">
              <Label>Brand color</Label>
              <div className="flex flex-wrap items-center gap-2">
                {colors.map((color) => <button key={color} type="button" aria-label={`Use brand color ${color}`} onClick={() => { setColorDraft(color); updateTemplate({ accentColor: color }) }} className={cn("size-8 rounded-full border-2 border-background shadow-sm ring-offset-2", template.accentColor.toUpperCase() === color && "ring-2 ring-foreground")} style={{ backgroundColor: color }} />)}
                <Input type="color" value={template.accentColor} onChange={(event) => { const value = event.target.value.toUpperCase(); setColorDraft(value); updateTemplate({ accentColor: value }) }} className="size-9 p-1" aria-label="Choose a custom brand color" />
                <Input value={colorDraft} onChange={(event) => { const value = event.target.value.toUpperCase(); if (/^#[0-9A-F]{0,6}$/.test(value)) setColorDraft(value) }} onBlur={() => /^#[0-9A-F]{6}$/.test(colorDraft) ? updateTemplate({ accentColor: colorDraft }) : setColorDraft(template.accentColor)} className="h-9 w-28 font-mono text-xs" aria-label="Brand color hex value" />
              </div>
            </section>

            <section className="space-y-3">
              <div><Label>Page color</Label><p className="mt-1 text-xs text-muted-foreground">Changes the document paper colour in previews and downloaded PDFs. Light colours provide the best readability.</p></div>
              <div className="flex flex-wrap items-center gap-2">
                {pageColors.map((color) => <button key={color} type="button" aria-label={`Use page color ${color}`} onClick={() => { setPageColorDraft(color); updateTemplate({ pageColor: color }) }} className={cn("size-8 rounded-full border shadow-sm ring-offset-2", template.pageColor.toUpperCase() === color && "ring-2 ring-foreground")} style={{ backgroundColor: color }} />)}
                <Input type="color" value={template.pageColor} onChange={(event) => { const value = event.target.value.toUpperCase(); setPageColorDraft(value); updateTemplate({ pageColor: value }) }} className="size-9 p-1" aria-label="Choose a custom page color" />
                <Input value={pageColorDraft} onChange={(event) => { const value = event.target.value.toUpperCase(); if (/^#[0-9A-F]{0,6}$/.test(value)) setPageColorDraft(value) }} onBlur={() => /^#[0-9A-F]{6}$/.test(pageColorDraft) ? updateTemplate({ pageColor: pageColorDraft }) : setPageColorDraft(template.pageColor)} className="h-9 w-28 font-mono text-xs" aria-label="Page color hex value" />
                <Button type="button" size="sm" variant="outline" onClick={() => { setPageColorDraft("#FFFFFF"); updateTemplate({ pageColor: "#FFFFFF" }) }}>Reset white</Button>
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <label className="flex cursor-pointer items-center justify-between gap-4">
                <span><span className="block text-sm font-medium">Document watermark</span><span className="block text-xs text-muted-foreground">Place light text behind the document content</span></span>
                <input type="checkbox" checked={template.watermarkEnabled} onChange={(event) => updateTemplate({ watermarkEnabled: event.target.checked })} className="size-4 accent-foreground" />
              </label>
              {template.watermarkEnabled ? (
                <div className="space-y-3 rounded-lg border p-3">
                  <div><Label htmlFor="template-watermark-text" className="text-xs">Watermark text</Label><Input id="template-watermark-text" maxLength={48} value={template.watermarkText} onChange={(event) => updateTemplate({ watermarkText: event.target.value })} placeholder="DRAFT, PAID or CONFIDENTIAL" /></div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3"><Label htmlFor="template-watermark-opacity" className="text-xs">Visibility</Label><span className="text-xs tabular-nums text-muted-foreground">{Math.round(template.watermarkOpacity * 100)}%</span></div>
                    <Input id="template-watermark-opacity" type="range" min="0.05" max="0.3" step="0.01" value={template.watermarkOpacity} onChange={(event) => updateTemplate({ watermarkOpacity: Number(event.target.value) })} className="h-5 cursor-pointer p-0" />
                  </div>
                </div>
              ) : null}
            </section>

            <section className="space-y-3 rounded-lg border p-3">
              <label className={cn("flex items-center justify-between gap-4", brandingCanBeRemoved ? "cursor-pointer" : "cursor-not-allowed")}>
                <span><span className="block text-sm font-medium">Created by ChanaX</span><span className="block text-xs text-muted-foreground">Small mark at the bottom-right of every document</span></span>
                <input
                  type="checkbox"
                  checked={brandingCanBeRemoved ? template.showChanaxBranding : true}
                  disabled={!brandingCanBeRemoved}
                  onChange={(event) => updateTemplate({ showChanaxBranding: event.target.checked })}
                  className="size-4 accent-foreground"
                />
              </label>
              <p className="text-xs text-muted-foreground">{brandingCanBeRemoved ? "Your paid subscription lets you remove this mark. It remains enabled by default." : "The mark is included on the free plan. An active paid subscription unlocks the option to remove it."}</p>
            </section>

            <section className="space-y-3">
              <Label>Typography</Label>
              <div className="grid grid-cols-3 gap-2">{(["sans", "serif", "mono"] as const).map((font) => <Button key={font} type="button" variant={template.fontStyle === font ? "default" : "outline"} onClick={() => updateTemplate({ fontStyle: font })}>{font === "sans" ? "Modern" : font === "serif" ? "Classic" : "Mono"}</Button>)}</div>
            </section>

            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-3"><span><span className="block text-sm font-medium">Compact line items</span><span className="block text-xs text-muted-foreground">Fit more products on one page</span></span><input type="checkbox" checked={template.compact} onChange={(event) => updateTemplate({ compact: event.target.checked })} className="size-4 accent-foreground" /></label>
          </CardContent>
        </Card>

        <div className="page-grid min-w-0 overflow-auto rounded-xl border bg-muted/30 p-3 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg border bg-background p-1" aria-label="Document preview type">
              <Button size="sm" variant={previewDocumentType === "invoice" ? "default" : "ghost"} onClick={() => setPreviewDocumentType("invoice")}><ReceiptText />Sales invoice</Button>
              <Button size="sm" variant={previewDocumentType === "quotation" ? "default" : "ghost"} onClick={() => setPreviewDocumentType("quotation")}><FilePlus2 />Quotation / proforma</Button>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Move className="size-4" />Drag elements toward the left, centre, or right guide to align them. Coordinates and arrow-key movement remain available.</div>
          </div>
          {previewDocumentType === "quotation" ? <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Quotation previews and PDFs are always marked as not being sales or tax invoices.</p> : null}
          <InvoicePreview
            invoice={previewDocument}
            entity={previewEntity}
            customer={previewCustomer}
            template={template}
            documentType={previewDocumentType}
            canRemoveBranding={brandingCanBeRemoved}
            editor={{
              selectedTextId,
              selectedElementId,
              onSelectText: (id) => { setSelectedTextId(id); setSelectedElementId(null) },
              onMoveText: (id, x, y) => updateText(id, { x, y }),
              onSelectElement: (id) => { setSelectedElementId(id); setSelectedTextId(null) },
              onMoveElement: (id, offsetX, offsetY) => updateElement(id, { offsetX, offsetY }),
            }}
          />
        </div>
      </div>
    </div>
  )
}
