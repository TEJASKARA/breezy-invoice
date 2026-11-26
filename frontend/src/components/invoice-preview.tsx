import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"

import type { Company, Customer, Invoice, TemplateElementId, TemplateElementSetting, TemplateSettings } from "@/lib/mvp-store"
import { calculateInvoiceTotals, getInvoiceLineItems } from "@/lib/invoice-calculations"
import { cn } from "@/lib/utils"
import { createInvoicePdf } from "@/lib/invoice-pdf"
import { quotationPayment } from "@/lib/quotation-payment"
import { documentFontCss, loadDocumentFontCss } from "@/lib/document-fonts"
import { resolveTemplateStyle, tint } from "@/lib/template-style"

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

type InvoicePreviewProps = {
  invoice: Invoice
  entity?: Company
  customer?: Customer
  template: TemplateSettings
  documentType?: "invoice" | "quotation"
  editor?: PreviewEditor
  canRemoveBranding?: boolean
}

/** Non-editing previews use the download renderer, including its page breaks. */
export function InvoicePreview(props: InvoicePreviewProps) {
  return props.editor ? <EditableInvoicePreview {...props} /> : <GeneratedInvoicePreview {...props} />
}

function GeneratedInvoicePreview({ invoice, entity, customer, template, documentType, canRemoveBranding }: InvoicePreviewProps) {
  const [pdf, setPdf] = useState<{ url: string; pages: string[]; error: boolean }>({ url: "", pages: [], error: false })
  useEffect(() => {
    let cancelled = false
    let url = ""
    setPdf({ url: "", pages: [], error: false })
    void createInvoicePdf({ invoice, entity, customer, template, documentType, canRemoveBranding }).then(async (doc) => {
      if (cancelled) return
      url = URL.createObjectURL(doc.output("blob"))
      const { renderPdfPreview } = await import("@/lib/pdf-preview")
      const pages = await renderPdfPreview(doc.output("arraybuffer"), () => cancelled)
      if (!cancelled) setPdf({ url, pages, error: false })
    }).catch(() => {
      if (url) URL.revokeObjectURL(url)
      if (!cancelled) setPdf({ url: "", pages: [], error: true })
    })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [invoice, entity, customer, template, documentType, canRemoveBranding])
  if (pdf.error) return <p role="alert" className="rounded-lg border p-4 text-sm">We couldn't prepare the PDF preview. Please close it and try again.</p>
  if (!pdf.url) return <p role="status" className="p-8 text-center text-sm text-muted-foreground">Preparing PDF preview…</p>
  return <div className="space-y-2">
    <p className="text-center text-xs text-muted-foreground">This is the generated PDF, including all pages. <a className="underline" href={pdf.url} target="_blank" rel="noreferrer">Open PDF in a new tab</a></p>
    {pdf.pages.map((page, index) => <img key={index} src={page} alt={`${documentType === "quotation" ? "Quotation" : "Invoice"} PDF page ${index + 1} of ${pdf.pages.length}`} className="mx-auto w-full max-w-[760px] border bg-white shadow-sm" />)}
  </div>
}

function EditableInvoicePreview({
  invoice,
  entity,
  customer,
  template,
  documentType = "invoice",
  editor,
  canRemoveBranding = false,
}: {
  invoice: Invoice
  entity?: Company
  customer?: Customer
  template: TemplateSettings
  documentType?: "invoice" | "quotation"
  editor?: PreviewEditor
  canRemoveBranding?: boolean
}) {
  const pageRef = useRef<HTMLElement>(null)
  const [activeVerticalGuide, setActiveVerticalGuide] = useState<number | null>(null)
  const items = getInvoiceLineItems(invoice)
  const totals = calculateInvoiceTotals(items)
  const netReceivable = invoice.netReceivable ?? totals.amount - (invoice.tdsAmount || 0) - (invoice.otherDeduction || 0)
  const style = resolveTemplateStyle(template)
  const fontFamily = documentFontCss(template.fontFamily, template.fontStyle)
  useEffect(() => { loadDocumentFontCss(template.fontFamily) }, [template.fontFamily])
  const onBand = style.headerBand
  const headerInk = onBand ? "#FFFFFF" : style.textColor
  const headerMuted = onBand ? "rgba(255,255,255,.8)" : undefined
  const titleColor = onBand ? "#FFFFFF" : style.headerColor
  const element = (id: TemplateElementId) => template.elements[id]
  const isGstInvoice = invoice.includesGst ?? entity?.hasGstin ?? Boolean(entity?.gstin)
  const isQuotation = documentType === "quotation"
  const displayedTitle = isQuotation ? "QUOTATION / PROFORMA" : isGstInvoice ? element("invoiceTitle").label : "INVOICE"
  const validUntil = (invoice as Invoice & { validUntil?: string }).validUntil
  const showChanaxBranding = template.showChanaxBranding || !canRemoveBranding
  const payment = quotationPayment(invoice, template)
  const showQuotationPaymentDetails = isQuotation && payment.show
  const showTerms = template.showTerms && element("terms").visible
  const logoSize = Math.min(200, Math.max(40, template.logoSize))
  const watermarkOpacity = Math.min(0.3, Math.max(0.05, template.watermarkOpacity))
  const textScale = Math.min(1.1, Math.max(0.85, (template.documentTextScale ?? 100) / 100))

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
      className={`relative isolate mx-auto aspect-[210/297] min-h-[920px] w-full max-w-[760px] overflow-hidden p-8 shadow-sm md:p-12 ${style.pageBorder === "double" ? "border-4 border-double" : style.pageBorder === "thin" ? "border-2" : "border"} ${style.pageBorder === "thin" && style.rounded ? "rounded-xl" : ""}`}
      style={{ backgroundColor: template.pageColor, borderColor: style.pageBorder !== "none" ? style.headerColor : undefined, color: style.textColor, fontFamily, containerType: "inline-size", zoom: textScale }}
    >
      {style.backgroundImageDataUrl ? <img src={style.backgroundImageDataUrl} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 size-full object-fill" /> : null}
      {editor && activeVerticalGuide !== null ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-50 border-l-2 border-blue-500" style={{ left: `${activeVerticalGuide}%` }} /> : null}
      {template.watermarkEnabled && (template.watermarkImageDataUrl || template.watermarkText.trim()) ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden">{template.watermarkImageDataUrl ? <img src={template.watermarkImageDataUrl} alt="" className="max-h-[46%] max-w-[58%] -rotate-[32deg] object-contain" style={{ opacity: watermarkOpacity }} /> : <span className="max-w-[85%] -rotate-[32deg] break-words text-center text-6xl font-bold uppercase tracking-[0.2em] text-zinc-700" style={{ opacity: watermarkOpacity }}>{template.watermarkText}</span>}</div> : null}
      {showChanaxBranding ? <div className="pointer-events-none absolute bottom-3 left-4 z-30 flex items-center gap-1.5 text-[9px] font-medium tracking-wide text-zinc-400"><img src="/chanax-wordmark.png" alt="" className="h-3 w-auto object-contain opacity-70" /><span>Generated by ChanaX</span></div> : null}
      {style.topStrip && !onBand && <div className="relative -mx-8 -mt-8 mb-8 h-2 md:-mx-12 md:-mt-12" style={{ backgroundColor: style.headerColor }} />}
      <header
        className={cn("relative flex gap-6 pb-7", style.headerLayout === "centered" ? "flex-col items-center text-center" : "items-start justify-between", onBand ? "-mx-8 -mt-8 px-8 pt-8 md:-mx-12 md:-mt-12 md:px-12 md:pt-12" : "border-b")}
        style={onBand ? { backgroundColor: style.headerColor, color: headerInk } : { borderColor: style.quietHeader ? "#e4e4e7" : style.headerColor }}
      >
        {style.headerLayout === "logo-right" ? <>
          <EditableInvoiceElement id="issuer" setting={element("issuer")} editor={editor} onPointerDown={startElementDrag}>
            <h2 className={cn("font-bold", style.quietHeader ? "text-xl" : "text-2xl")} style={{ color: headerInk }}>{entity?.companyName || invoice.entityName || "Issuing entity"}</h2>
            <p className="mt-2 max-w-sm text-sm text-zinc-500" style={{ color: headerMuted }}>{entity?.billingAddress || entity?.premisesAddress || "Address not provided"}</p>
            {entity?.gstin && <p className="mt-1 text-xs text-zinc-500" style={{ color: headerMuted }}>GSTIN: {entity.gstin}</p>}
            {entity?.pan && <p className="text-xs text-zinc-500" style={{ color: headerMuted }}>PAN: {entity.pan}</p>}
          </EditableInvoiceElement>
          <div className="flex shrink-0 flex-col items-end gap-3 text-right">
            {template.logoDataUrl && <EditableInvoiceElement id="logo" setting={element("logo")} editor={editor} onPointerDown={startElementDrag}><img src={template.logoDataUrl} alt="Company logo" className="shrink-0 rounded object-contain" style={{ width: logoSize, height: logoSize }} /></EditableInvoiceElement>}
            <EditableInvoiceElement id="invoiceTitle" setting={element("invoiceTitle")} editor={editor} onPointerDown={startElementDrag}>
              <h1 className={cn("font-bold", style.quietHeader ? "text-xl" : "text-2xl")} style={{ color: titleColor }}>{displayedTitle}</h1>
              <p className="mt-2 text-sm text-zinc-500" style={{ color: headerMuted }}>{invoice.sourceNumber || invoice.number}</p>
              <p className="text-sm text-zinc-500" style={{ color: headerMuted }}>{invoice.date}</p>
            </EditableInvoiceElement>
          </div>
        </> : style.headerLayout === "centered" ? <>
          {template.logoDataUrl && <EditableInvoiceElement id="logo" setting={element("logo")} editor={editor} onPointerDown={startElementDrag}><img src={template.logoDataUrl} alt="Company logo" className="mx-auto shrink-0 rounded object-contain" style={{ width: logoSize, height: logoSize }} /></EditableInvoiceElement>}
          <EditableInvoiceElement id="issuer" setting={element("issuer")} editor={editor} onPointerDown={startElementDrag}>
            <h2 className={cn("font-bold", style.quietHeader ? "text-xl" : "text-2xl")} style={{ color: headerInk }}>{entity?.companyName || invoice.entityName || "Issuing entity"}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500" style={{ color: headerMuted }}>{entity?.billingAddress || entity?.premisesAddress || "Address not provided"}</p>
            {entity?.gstin || entity?.pan ? <p className="mt-1 text-xs text-zinc-500" style={{ color: headerMuted }}>{[entity?.gstin ? `GSTIN: ${entity.gstin}` : "", entity?.pan ? `PAN: ${entity.pan}` : ""].filter(Boolean).join("  |  ")}</p> : null}
          </EditableInvoiceElement>
          <EditableInvoiceElement id="invoiceTitle" setting={element("invoiceTitle")} editor={editor} onPointerDown={startElementDrag}>
            <h1 className={cn("font-bold", style.quietHeader ? "text-xl" : "text-2xl")} style={{ color: titleColor }}>{displayedTitle}</h1>
            <p className="mt-1 text-sm text-zinc-500" style={{ color: headerMuted }}>{invoice.sourceNumber || invoice.number}  |  {invoice.date}</p>
          </EditableInvoiceElement>
        </> : <>
          <div className="flex min-w-0 gap-4">
            {template.logoDataUrl && <EditableInvoiceElement id="logo" setting={element("logo")} editor={editor} onPointerDown={startElementDrag}><img src={template.logoDataUrl} alt="Company logo" className="shrink-0 rounded object-contain" style={{ width: logoSize, height: logoSize }} /></EditableInvoiceElement>}
            <EditableInvoiceElement id="issuer" setting={element("issuer")} editor={editor} onPointerDown={startElementDrag}>
              <h2 className={cn("font-bold", style.quietHeader ? "text-xl" : "text-2xl")} style={{ color: headerInk }}>{entity?.companyName || invoice.entityName || "Issuing entity"}</h2>
              <p className="mt-2 max-w-sm text-sm text-zinc-500" style={{ color: headerMuted }}>{entity?.billingAddress || entity?.premisesAddress || "Address not provided"}</p>
              {entity?.gstin && <p className="mt-1 text-xs text-zinc-500" style={{ color: headerMuted }}>GSTIN: {entity.gstin}</p>}
              {entity?.pan && <p className="text-xs text-zinc-500" style={{ color: headerMuted }}>PAN: {entity.pan}</p>}
            </EditableInvoiceElement>
          </div>
          <EditableInvoiceElement id="invoiceTitle" setting={element("invoiceTitle")} editor={editor} onPointerDown={startElementDrag} className="shrink-0 text-right">
            <h1 className={cn("font-bold", style.quietHeader ? "text-xl" : "text-2xl")} style={{ color: titleColor }}>{displayedTitle}</h1>
            <p className="mt-2 text-sm text-zinc-500" style={{ color: headerMuted }}>{invoice.sourceNumber || invoice.number}</p>
            <p className="text-sm text-zinc-500" style={{ color: headerMuted }}>{invoice.date}</p>
            {!isQuotation && invoice.sourceProformaNumber ? <p className="mt-1 text-xs text-zinc-500" style={{ color: headerMuted }}>Created from quotation {invoice.sourceProformaNumber}</p> : null}
          </EditableInvoiceElement>
        </>}
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
          Corrected replacement for invoice {invoice.correctsInvoiceNumber}{invoice.regeneratedAt ? ` — regenerated on ${invoice.regeneratedAt}` : ""}.
        </div>
      ) : null}

      <section className={`grid gap-8 md:grid-cols-2 ${isQuotation ? "py-5" : "py-7"}`}>
        <EditableInvoiceElement id="customer" setting={element("customer")} editor={editor} onPointerDown={startElementDrag}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: style.headerColor }}>{element("customer").label}</p>
          <h3 className="mt-2 font-bold">{customer?.companyName || invoice.companyName}</h3>
          <p className="mt-1 text-sm text-zinc-500">{customer?.billingAddress || customer?.premisesAddress || "Address not provided"}</p>
          {customer?.gstin && <p className="mt-2 text-xs text-zinc-500">GSTIN: {customer.gstin}</p>}
          {customer?.pan && <p className="text-xs text-zinc-500">PAN: {customer.pan}</p>}
        </EditableInvoiceElement>
        <EditableInvoiceElement id="invoiceDetails" setting={element("invoiceDetails")} editor={editor} onPointerDown={startElementDrag} className="md:text-right">
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: style.headerColor }}>{isQuotation ? "Quotation details" : element("invoiceDetails").label}</p>
          <p className="mt-2 text-sm">Status: <strong>{invoice.status}</strong></p>
          <p className="text-sm">Items: <strong>{items.length}</strong></p>
          {isQuotation && validUntil ? <p className="text-sm">Valid until: <strong>{validUntil}</strong></p> : null}
        </EditableInvoiceElement>
      </section>

      <EditableInvoiceElement id="lineItems" setting={element("lineItems")} editor={editor} onPointerDown={startElementDrag} className={cn("relative overflow-hidden", style.tableStyle === "boxed" ? "border border-slate-300" : style.tableStyle === "plain" || style.tableStyle === "striped" ? "border-b" : "border", style.rounded && style.tableStyle !== "boxed" && "rounded-lg")}>
        <table className={cn("w-full text-left text-xs", style.tableStyle === "boxed" && "[&_td]:border [&_td]:border-slate-300 [&_th]:border [&_th]:border-slate-300")}>
          <thead style={{ backgroundColor: style.tableHeadFilled ? style.tableHeadColor : "#f4f4f5", color: style.tableHeadFilled ? "white" : style.textColor }}>
            <tr><th className="p-2.5">Description</th><th className="p-2.5">HSN/SAC</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit price</th><th className="p-2.5 text-right">Amount</th>{isGstInvoice ? <><th className="p-2.5 text-right">CGST</th><th className="p-2.5 text-right">SGST</th><th className="p-2.5 text-right">IGST</th></> : null}<th className="p-2.5 text-right">Total</th></tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const tax = item.cgstAmount + item.sgstAmount + item.igstAmount
              return (
                <tr key={item.id} className={cn(style.tableStyle === "lines" && "border-t")} style={style.tableStyle === "striped" && index % 2 === 1 ? { backgroundColor: tint(style.tableHeadColor, 0.93) } : undefined}>
                  <td className="p-2.5 font-medium">{item.description}</td>
                  <td className="p-2.5 text-zinc-500">{item.hsnSac || "—"}</td>
                  <td className="p-2 text-right">{item.quantity}</td>
                  <td className="whitespace-nowrap p-2 text-right">{money(item.unitPrice ?? item.taxableAmount)}</td>
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
          <section className={cn("relative overflow-hidden border", style.rounded && "rounded-xl", style.totalsStyle === "outline" ? "border-2" : "border-zinc-200", style.quietHeader && style.totalsStyle === "soft" && "border-x-0")} style={style.totalsStyle === "outline" ? { borderColor: style.headerColor } : undefined}>
            <div className={`grid grid-cols-2 divide-x divide-y divide-zinc-200 ${isGstInvoice ? "sm:grid-cols-4 sm:divide-y-0" : "sm:grid-cols-1 sm:divide-y-0"}`}>
              <div className="p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Taxable value</p><p className="mt-1 font-semibold">{money(totals.taxableAmount)}</p></div>
              {isGstInvoice ? <><div className="p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">CGST</p><p className="mt-1 font-semibold">{money(totals.cgstAmount)}</p></div>
              <div className="p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">SGST</p><p className="mt-1 font-semibold">{money(totals.sgstAmount)}</p></div>
              <div className="p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">IGST</p><p className="mt-1 font-semibold">{money(totals.igstAmount)}</p></div></> : null}
            </div>
            <div
              className={cn(
                "grid grid-cols-2 border-t",
                style.totalsStyle === "filled" && "border-transparent text-white",
                style.totalsStyle === "outline" && "border-t-2",
                style.totalsStyle === "soft" && "border-zinc-200 bg-zinc-100",
              )}
              style={style.totalsStyle === "filled" ? { backgroundColor: style.headerColor } : style.totalsStyle === "outline" ? { borderColor: style.headerColor, color: style.headerColor } : undefined}
            >
              <div className={cn("border-r p-3", style.totalsStyle === "filled" ? "border-white/25" : "border-zinc-200")}><p className={cn("text-[10px] font-bold uppercase tracking-wider", style.totalsStyle === "filled" ? "text-white/75" : "text-zinc-500")}>{isQuotation ? "Quotation total" : "Invoice total"}</p><p className="mt-1 text-lg font-bold">{money(totals.amount)}</p></div>
              <div className="p-3 text-right"><p className={cn("text-[10px] font-bold uppercase tracking-wider", style.totalsStyle === "filled" ? "text-white/75" : "text-zinc-500")}>{isQuotation ? "Estimated amount" : "Net receivable"}</p><p className="mt-1 text-lg font-bold">{money(isQuotation ? totals.amount : netReceivable)}</p></div>
            </div>
            {((invoice.tdsAmount || 0) > 0 || (invoice.otherDeduction || 0) > 0) && (
              <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                {(invoice.tdsAmount || 0) > 0 && <span>Less: TDS {money(invoice.tdsAmount || 0)}</span>}
                {(invoice.otherDeduction || 0) > 0 && <span>Other deduction {money(invoice.otherDeduction || 0)}</span>}
              </div>
            )}
          </section>
      </EditableInvoiceElement>

      <footer className="mt-14 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5 border-t pt-5 text-xs text-zinc-500">
        <EditableInvoiceElement id="terms" setting={element("terms")} editor={editor} onPointerDown={startElementDrag} className={cn(showTerms && showQuotationPaymentDetails && "grid grid-cols-2 gap-5")}>
          {showQuotationPaymentDetails && (
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0 flex-1"><p className="font-semibold text-zinc-800">Payment details</p><p className="mt-2 max-h-16 overflow-hidden whitespace-pre-wrap leading-4">{payment.text}</p></div>
              {payment.qr ? <div className="shrink-0 text-center"><img src={payment.qr} alt="UPI payment QR code" className="size-14 rounded border object-contain" /><p className="mt-1 text-[10px]">Scan to pay</p></div> : null}
            </div>
          )}
          {showTerms && (
            <div className="min-w-0">
              <p className="font-semibold text-zinc-800">{element("terms").label}</p>
              <p className="mt-2 max-h-16 overflow-hidden whitespace-pre-wrap leading-4">{template.termsText}</p>
            </div>
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
