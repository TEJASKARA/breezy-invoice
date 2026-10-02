import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"

import type { Company, Customer, Invoice, TemplateElementId, TemplateElementSetting, TemplateSettings } from "@/lib/mvp-store"
import { calculateInvoiceTotals, getInvoiceLineItems } from "@/lib/invoice-calculations"
import { cn } from "@/lib/utils"

function money(value: number) {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const verticalSnapGuides = [8, 50, 92]
const snapDistancePixels = 8

type PreviewEditor = {
  selectedTextId: string | null
  selectedElementId: TemplateElementId | null
  onSelectText: (id: string) => void
  onMoveText: (id: string, x: number, y: number) => void
  onSelectElement: (id: TemplateElementId) => void
  onMoveElement: (id: TemplateElementId, offsetX: number, offsetY: number) => void
}

function EditableInvoiceElement({ id, setting, editor, onPointerDown, children, className }: {
  id: TemplateElementId
  setting: TemplateElementSetting
  editor?: PreviewEditor
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, id: TemplateElementId) => void
  children: ReactNode
  className?: string
}) {
  if (!setting.visible) return null
  return (
    <div
      role={editor ? "button" : undefined}
      tabIndex={editor ? 0 : undefined}
      aria-label={editor ? `Move ${setting.label}` : undefined}
      onPointerDown={(event) => onPointerDown(event, id)}
      onClick={(event) => { event.stopPropagation(); editor?.onSelectElement(id) }}
      onKeyDown={(event) => {
        if (!editor || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
        event.preventDefault()
        const offsetX = setting.offsetX + (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0)
        const offsetY = setting.offsetY + (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0)
        editor.onMoveElement(id, Math.min(35, Math.max(-35, offsetX)), Math.min(35, Math.max(-35, offsetY)))
      }}
      className={cn(
        "relative",
        editor && "cursor-move select-none rounded-sm",
        editor?.selectedElementId === id && "z-10 outline outline-2 outline-offset-2 outline-blue-500",
        className,
      )}
      style={{ transform: `translate(${setting.offsetX}cqw, ${setting.offsetY * 1.414}cqw)` }}
    >
      {children}
    </div>
  )
}

export function InvoicePreview({
  invoice,
  entity,
  customer,
  template,
  documentType = "invoice",
  editor,
}: {
  invoice: Invoice
  entity?: Company
  customer?: Customer
  template: TemplateSettings
  documentType?: "invoice" | "quotation"
  editor?: PreviewEditor
}) {
  const pageRef = useRef<HTMLElement>(null)
  const [activeVerticalGuide, setActiveVerticalGuide] = useState<number | null>(null)
  const items = getInvoiceLineItems(invoice)
  const totals = calculateInvoiceTotals(items)
  const netReceivable = invoice.netReceivable ?? totals.amount - (invoice.tdsAmount || 0) - (invoice.otherDeduction || 0)
  const fontClass = template.fontStyle === "serif" ? "font-serif" : template.fontStyle === "mono" ? "font-mono" : "font-sans"
  const isClassic = template.preset === "classic"
  const isMinimal = template.preset === "minimal"
  const element = (id: TemplateElementId) => template.elements[id]
  const isGstInvoice = entity?.hasGstin ?? Boolean(entity?.gstin)
  const isQuotation = documentType === "quotation"
  const displayedTitle = isQuotation ? "QUOTATION / PROFORMA" : isGstInvoice ? element("invoiceTitle").label : "INVOICE"
  const validUntil = (invoice as Invoice & { validUntil?: string }).validUntil

  const startTextDrag = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (!editor || !pageRef.current) return
    event.preventDefault()
    event.stopPropagation()
    editor.onSelectText(id)
    const page = pageRef.current
    const move = (pointerEvent: PointerEvent) => {
      const bounds = page.getBoundingClientRect()
      const rawX = Math.min(96, Math.max(2, ((pointerEvent.clientX - bounds.left) / bounds.width) * 100))
      const snapThreshold = (snapDistancePixels / bounds.width) * 100
      const guide = verticalSnapGuides.reduce<number | null>((closest, candidate) => {
        if (Math.abs(candidate - rawX) > snapThreshold) return closest
        if (closest === null || Math.abs(candidate - rawX) < Math.abs(closest - rawX)) return candidate
        return closest
      }, null)
      const x = guide ?? rawX
      const y = Math.min(96, Math.max(2, ((pointerEvent.clientY - bounds.top) / bounds.height) * 100))
      setActiveVerticalGuide(guide)
      editor.onMoveText(id, x, y)
    }
    const stop = () => {
      setActiveVerticalGuide(null)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
  }

  const startElementDrag = (event: ReactPointerEvent<HTMLDivElement>, id: TemplateElementId) => {
    if (!editor || !pageRef.current) return
    event.preventDefault()
    event.stopPropagation()
    editor.onSelectElement(id)
    const page = pageRef.current
    const startX = event.clientX
    const startY = event.clientY
    const draggedBounds = event.currentTarget.getBoundingClientRect()
    const initial = element(id)
    const move = (pointerEvent: PointerEvent) => {
      const bounds = page.getBoundingClientRect()
      const deltaX = pointerEvent.clientX - startX
      const anchors = [draggedBounds.left + deltaX, draggedBounds.left + draggedBounds.width / 2 + deltaX, draggedBounds.right + deltaX]
      let snappedDeltaX = deltaX
      let activeGuide: number | null = null
      let closestDistance = Number.POSITIVE_INFINITY
      verticalSnapGuides.forEach((guide) => {
        const guidePixels = bounds.left + bounds.width * guide / 100
        anchors.forEach((anchor) => {
          const distance = Math.abs(guidePixels - anchor)
          if (distance <= snapDistancePixels && distance < closestDistance) {
            closestDistance = distance
            activeGuide = guide
            snappedDeltaX = deltaX + guidePixels - anchor
          }
        })
      })
      setActiveVerticalGuide(activeGuide)
      const offsetX = initial.offsetX + (snappedDeltaX / bounds.width) * 100
      const offsetY = initial.offsetY + ((pointerEvent.clientY - startY) / bounds.height) * 100
      editor.onMoveElement(id, Math.min(35, Math.max(-35, offsetX)), Math.min(35, Math.max(-35, offsetY)))
    }
    const stop = () => {
      setActiveVerticalGuide(null)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
  }

  return (
    <article
      ref={pageRef}
      className={`${fontClass} relative mx-auto aspect-[210/297] min-h-[920px] w-full max-w-[760px] overflow-hidden p-8 text-zinc-900 shadow-sm md:p-12 ${isClassic ? "border-4 border-double" : "border"}`}
      style={{ backgroundColor: template.pageColor, borderColor: isClassic ? template.accentColor : undefined, containerType: "inline-size" }}
    >
      {editor && activeVerticalGuide !== null ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-50 border-l-2 border-blue-500" style={{ left: `${activeVerticalGuide}%` }} /> : null}
      {!isClassic && !isMinimal && <div className="-mx-8 -mt-8 mb-8 h-2 md:-mx-12 md:-mt-12" style={{ backgroundColor: template.accentColor }} />}
      <header className="flex items-start justify-between gap-6 border-b pb-7" style={{ borderColor: template.accentColor }}>
        <div className="flex min-w-0 gap-4">
          {template.logoDataUrl && <EditableInvoiceElement id="logo" setting={element("logo")} editor={editor} onPointerDown={startElementDrag}><img src={template.logoDataUrl} alt="Company logo" className="h-16 w-16 shrink-0 rounded object-contain" /></EditableInvoiceElement>}
          <EditableInvoiceElement id="issuer" setting={element("issuer")} editor={editor} onPointerDown={startElementDrag}>
            <h2 className="text-2xl font-bold">{entity?.companyName || invoice.entityName || "Issuing entity"}</h2>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">{entity?.billingAddress || entity?.premisesAddress || "Address not provided"}</p>
            {entity?.gstin && <p className="mt-1 text-xs text-zinc-500">GSTIN: {entity.gstin}</p>}
            {entity?.pan && <p className="text-xs text-zinc-500">PAN: {entity.pan}</p>}
          </EditableInvoiceElement>
        </div>
        <EditableInvoiceElement id="invoiceTitle" setting={element("invoiceTitle")} editor={editor} onPointerDown={startElementDrag} className="shrink-0 text-right">
          <h1 className="text-2xl font-bold" style={{ color: template.accentColor }}>{displayedTitle}</h1>
          <p className="mt-2 text-sm text-zinc-500">{invoice.sourceNumber || invoice.number}</p>
          <p className="text-sm text-zinc-500">{invoice.date}</p>
          {!isQuotation && invoice.sourceProformaNumber ? <p className="mt-1 text-xs text-zinc-500">Created from quotation {invoice.sourceProformaNumber}</p> : null}
        </EditableInvoiceElement>
      </header>

      {isQuotation && (
        <div className="mt-4 rounded-md border border-amber-400 bg-amber-50 px-4 py-2 text-center text-xs font-bold uppercase tracking-wide text-amber-950">
          This is a quotation, not a sales or tax invoice. It does not record a completed sale.
        </div>
      )}
      {!isQuotation && (invoice.status === "Cancelled" || invoice.status === "Amended") ? (
        <div className="mt-4 rounded-md border border-red-400 bg-red-50 px-4 py-2 text-center text-xs font-bold uppercase tracking-wide text-red-900">
          {invoice.status === "Cancelled" ? "Cancelled invoice — do not use for payment or tax reporting." : "Amended invoice — refer to the recorded correction before use."}
          {invoice.correction?.replacementInvoiceNumber ? ` Replacement: ${invoice.correction.replacementInvoiceNumber}.` : ""}
        </div>
      ) : null}
      {!isQuotation && invoice.correctsInvoiceNumber ? (
        <div className="mt-4 rounded-md border border-blue-400 bg-blue-50 px-4 py-2 text-center text-xs font-bold uppercase tracking-wide text-blue-900">
          Corrected replacement for invoice {invoice.correctsInvoiceNumber}.
        </div>
      ) : null}

      <section className={`grid gap-8 md:grid-cols-2 ${isQuotation ? "py-5" : "py-7"}`}>
        <EditableInvoiceElement id="customer" setting={element("customer")} editor={editor} onPointerDown={startElementDrag}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: template.accentColor }}>{element("customer").label}</p>
          <h3 className="mt-2 font-bold">{customer?.companyName || invoice.companyName}</h3>
          <p className="mt-1 text-sm text-zinc-500">{customer?.billingAddress || customer?.premisesAddress || "Address not provided"}</p>
          {customer?.gstin && <p className="mt-2 text-xs text-zinc-500">GSTIN: {customer.gstin}</p>}
          {customer?.pan && <p className="text-xs text-zinc-500">PAN: {customer.pan}</p>}
        </EditableInvoiceElement>
        <EditableInvoiceElement id="invoiceDetails" setting={element("invoiceDetails")} editor={editor} onPointerDown={startElementDrag} className="md:text-right">
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: template.accentColor }}>{isQuotation ? "Quotation details" : element("invoiceDetails").label}</p>
          <p className="mt-2 text-sm">Status: <strong>{invoice.status}</strong></p>
          <p className="text-sm">Items: <strong>{items.length}</strong></p>
          {isQuotation && validUntil ? <p className="text-sm">Valid until: <strong>{validUntil}</strong></p> : null}
        </EditableInvoiceElement>
      </section>

      <EditableInvoiceElement id="lineItems" setting={element("lineItems")} editor={editor} onPointerDown={startElementDrag} className="overflow-hidden border">
        <table className="w-full text-left text-xs">
          <thead style={{ backgroundColor: isMinimal || isClassic ? "#f4f4f5" : template.accentColor, color: isMinimal || isClassic ? "#18181b" : "white" }}>
            <tr><th className="p-2.5">Description</th><th className="p-2.5">HSN/SAC</th><th className="p-2.5 text-right">Amount</th>{isGstInvoice ? <><th className="p-2.5 text-right">CGST</th><th className="p-2.5 text-right">SGST</th><th className="p-2.5 text-right">IGST</th></> : null}<th className="p-2.5 text-right">Total</th></tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const tax = item.cgstAmount + item.sgstAmount + item.igstAmount
              return (
                <tr key={item.id} className="border-t">
                  <td className="p-2.5 font-medium">{item.description}</td>
                  <td className="p-2.5 text-zinc-500">{item.hsnSac || "—"}</td>
                  <td className="whitespace-nowrap p-2.5 text-right">{money(item.taxableAmount)}</td>
                  {isGstInvoice ? <><td className="whitespace-nowrap p-2.5 text-right text-zinc-500">{money(item.cgstAmount)}</td><td className="whitespace-nowrap p-2.5 text-right text-zinc-500">{money(item.sgstAmount)}</td><td className="whitespace-nowrap p-2.5 text-right text-zinc-500">{money(item.igstAmount)}</td></> : null}
                  <td className="whitespace-nowrap p-2.5 text-right font-semibold">{money(item.taxableAmount + tax)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </EditableInvoiceElement>

      <EditableInvoiceElement
        id="totals"
        setting={element("totals")}
        editor={editor}
        onPointerDown={startElementDrag}
        className="mt-7 w-full text-sm"
      >
          <section className={cn(
            "overflow-hidden border",
            template.preset === "breeze" && "rounded-xl border-zinc-200",
            template.preset === "classic" && "border-2 border-zinc-700",
            template.preset === "minimal" && "border-x-0 border-zinc-200",
          )}>
            <div className={`grid grid-cols-2 divide-x divide-y divide-zinc-200 ${isGstInvoice ? "sm:grid-cols-4 sm:divide-y-0" : "sm:grid-cols-1 sm:divide-y-0"}`}>
              <div className="p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Taxable value</p><p className="mt-1 font-semibold">{money(totals.taxableAmount)}</p></div>
              {isGstInvoice ? <><div className="p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">CGST</p><p className="mt-1 font-semibold">{money(totals.cgstAmount)}</p></div>
              <div className="p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">SGST</p><p className="mt-1 font-semibold">{money(totals.sgstAmount)}</p></div>
              <div className="p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">IGST</p><p className="mt-1 font-semibold">{money(totals.igstAmount)}</p></div></> : null}
            </div>
            <div
              className={cn(
                "grid grid-cols-2 border-t",
                template.preset === "breeze" && "border-transparent text-white",
                template.preset === "classic" && "border-t-2",
                template.preset === "minimal" && "border-zinc-200 bg-zinc-100 text-zinc-900",
              )}
              style={template.preset === "breeze" ? { backgroundColor: template.accentColor } : template.preset === "classic" ? { borderColor: template.accentColor, color: template.accentColor } : undefined}
            >
              <div className={cn("border-r p-3", template.preset === "breeze" ? "border-white/25" : "border-zinc-200")}><p className={cn("text-[10px] font-bold uppercase tracking-wider", template.preset === "breeze" ? "text-white/75" : "text-zinc-500")}>{isQuotation ? "Quotation total" : "Invoice total"}</p><p className="mt-1 text-lg font-bold">{money(totals.amount)}</p></div>
              <div className="p-3 text-right"><p className={cn("text-[10px] font-bold uppercase tracking-wider", template.preset === "breeze" ? "text-white/75" : "text-zinc-500")}>{isQuotation ? "Estimated amount" : "Net receivable"}</p><p className="mt-1 text-lg font-bold">{money(isQuotation ? totals.amount : netReceivable)}</p></div>
            </div>
            {((invoice.tdsAmount || 0) > 0 || (invoice.otherDeduction || 0) > 0) && (
              <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                {(invoice.tdsAmount || 0) > 0 && <span>Less: TDS {money(invoice.tdsAmount || 0)}</span>}
                {(invoice.otherDeduction || 0) > 0 && <span>Other deduction {money(invoice.otherDeduction || 0)}</span>}
              </div>
            )}
          </section>
      </EditableInvoiceElement>

      <footer className="mt-14 grid grid-cols-2 gap-10 border-t pt-5 text-xs text-zinc-500">
        <EditableInvoiceElement id="terms" setting={element("terms")} editor={editor} onPointerDown={startElementDrag}>
          {template.showTerms && element("terms").visible && (
            <>
              <p className="font-semibold text-zinc-800">{element("terms").label}</p>
              <p className="mt-2 whitespace-pre-wrap leading-5">{template.termsText}</p>
            </>
          )}
        </EditableInvoiceElement>
        <EditableInvoiceElement id="signature" setting={element("signature")} editor={editor} onPointerDown={startElementDrag} className="text-right">
          <p className="font-semibold text-zinc-800">For {entity?.companyName || invoice.entityName || "Issuing entity"}</p>
          {template.signatureMode === "uploaded" && template.signatureDataUrl && (
            <img src={template.signatureDataUrl} alt="Authorised signature" className="ml-auto mt-3 h-16 max-w-44 object-contain object-right" />
          )}
          {template.signatureMode === "system" && (
            <p className="ml-auto mt-7 max-w-64 leading-5">This is a system-generated {isQuotation ? "quotation" : "invoice"}. A signature is not required.</p>
          )}
          {template.signatureMode === "uploaded" && <p className="mt-2">{element("signature").label}</p>}
        </EditableInvoiceElement>
      </footer>

      {template.customTexts.map((block) => (
        <div
          key={block.id}
          role={editor ? "button" : undefined}
          tabIndex={editor ? 0 : undefined}
          onPointerDown={(event) => startTextDrag(event, block.id)}
          onClick={() => editor?.onSelectText(block.id)}
          onKeyDown={(event) => {
            if (!editor || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
            event.preventDefault()
            const x = block.x + (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0)
            const y = block.y + (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0)
            editor.onMoveText(block.id, Math.min(96, Math.max(2, x)), Math.min(96, Math.max(2, y)))
          }}
          className={`absolute z-20 max-w-[55%] whitespace-pre-wrap rounded-sm px-1 py-0.5 leading-tight ${editor ? "cursor-move select-none" : "pointer-events-none"} ${editor?.selectedTextId === block.id ? "outline outline-2 outline-offset-2 outline-blue-500" : ""}`}
          style={{
            left: `${block.x}%`,
            top: `${block.y}%`,
            color: block.color,
            fontSize: `${block.fontSize}px`,
            fontWeight: block.bold ? 700 : 400,
            textAlign: block.align,
            transform: block.align === "center" ? "translateX(-50%)" : block.align === "right" ? "translateX(-100%)" : undefined,
          }}
        >
          {block.text}
        </div>
      ))}
    </article>
  )
}
