import type { jsPDF as JsPdfDocument } from "jspdf"

import { calculateInvoiceTotals, getInvoiceLineItems } from "@/lib/invoice-calculations"
import type { Company, Customer, Invoice, TemplateElementId, TemplateSettings } from "@/lib/mvp-store"
import { trackAction } from "@/lib/usage-tracking"
import { quotationPayment } from "@/lib/quotation-payment"
import { embedPdfFont } from "@/lib/document-fonts"
import { resolveTemplateStyle, tint } from "@/lib/template-style"

const pageWidth = 210
const pageHeight = 297
const margin = 16

function colour(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "2563EB"
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}

function money(value = 0) {
  return `INR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function cleanInvoiceFileName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "invoice"
}

function addLogo(doc: JsPdfDocument, logoDataUrl: string, x: number, y: number, width: number, height: number) {
  const format = logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG"
  try {
    const image = doc.getImageProperties(logoDataUrl)
    const scale = Math.min(width / image.width, height / image.height)
    const imageWidth = image.width * scale
    const imageHeight = image.height * scale
    doc.addImage(logoDataUrl, format, x + (width - imageWidth) / 2, y + (height - imageHeight) / 2, imageWidth, imageHeight, undefined, "FAST")
    return true
  } catch {
    return false
  }
}

async function loadPublicImageDataUrl(path: string) {
  if (typeof window === "undefined") return null
  try {
    const response = await fetch(path)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function addressLines(doc: JsPdfDocument, address: string, width: number) {
  return doc.splitTextToSize(address || "Address not provided", width) as string[]
}

export type InvoicePdfInput = {
  invoice: Invoice
  entity?: Company
  customer?: Customer
  template: TemplateSettings
  documentType?: "invoice" | "quotation"
  canRemoveBranding?: boolean
}

export async function createInvoicePdf({
  invoice,
  entity,
  customer,
  template,
  documentType = "invoice",
  canRemoveBranding = false,
}: InvoicePdfInput) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  const textScale = Math.min(1.1, Math.max(0.85, (template.documentTextScale ?? 100) / 100))
  const setFontSize = doc.setFontSize.bind(doc)
  doc.setFontSize = ((size: number) => setFontSize(size * textScale)) as typeof doc.setFontSize
  const style = resolveTemplateStyle(template)
  const accent = colour(style.headerColor)
  const tableHead = colour(style.tableHeadColor)
  const ink = colour(style.textColor)
  const muted: [number, number, number] = [100, 116, 139]
  const soft: [number, number, number] = [245, 247, 250]
  const stripe = colour(tint(style.tableHeadColor, 0.93))
  const white: [number, number, number] = [255, 255, 255]
  const baseFont = await embedPdfFont(doc, template.fontFamily, template.fontStyle)
  const invoiceNumber = invoice.sourceNumber || invoice.number
  const issuerName = entity?.companyName || invoice.entityName || "Issuing entity"
  const customerName = customer?.companyName || invoice.companyName
  const lineItems = getInvoiceLineItems(invoice)
  const totals = calculateInvoiceTotals(lineItems)
  const netReceivable = invoice.netReceivable ?? totals.amount - (invoice.tdsAmount || 0) - (invoice.otherDeduction || 0)
  const compactOffset = template.compact ? -3 : 0
  const element = (id: TemplateElementId) => template.elements[id]
  const isQuotation = documentType === "quotation"
  const documentHasGstAmounts = lineItems.some((item) => item.cgstAmount > 0 || item.sgstAmount > 0 || item.igstAmount > 0)
  // GST calculation is a document choice. An entity without a GSTIN can still
  // show GST amounts; its GSTIN simply remains absent from the document. The
  // amount check also keeps GST visible on documents created before this flag.
  const isGstInvoice = invoice.includesGst ?? (documentHasGstAmounts || (entity?.hasGstin ?? Boolean(entity?.gstin)))
  const displayedTitle = isQuotation ? "QUOTATION / PROFORMA" : isGstInvoice ? element("invoiceTitle").label : "INVOICE"
  const validUntil = (invoice as Invoice & { validUntil?: string }).validUntil
  const showChanaxBranding = template.showChanaxBranding || !canRemoveBranding
  // The editor's 760px-wide page maps to A4, not one millimetre per 3px.
  const logoSize = Math.min(200, Math.max(40, template.logoSize)) * pageWidth / 760
  const hasCorrectionNotice = !isQuotation && (invoice.status === "Cancelled" || invoice.status === "Amended" || Boolean(invoice.correctsInvoiceNumber))
  const chanaxBrandMark = showChanaxBranding ? await loadPublicImageDataUrl("/chanax-wordmark.png") : null
  const shift = (id: TemplateElementId) => ({
    x: (element(id).offsetX / 100) * pageWidth,
    y: (element(id).offsetY / 100) * pageHeight,
  })
  const paintPageBackground = () => {
    const background = colour(template.pageColor)
    doc.setFillColor(...background)
    doc.rect(0, 0, pageWidth, pageHeight, "F")
    if (style.backgroundImageDataUrl) {
      try { doc.addImage(style.backgroundImageDataUrl, style.backgroundImageDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST") } catch { /* keep the page usable if the image can't be decoded */ }
    }
    if (style.pageBorder === "double") {
      doc.setDrawColor(...accent)
      doc.setLineWidth(0.7)
      doc.rect(8, 8, pageWidth - 16, pageHeight - 16)
      doc.setLineWidth(0.2)
      doc.rect(10.5, 10.5, pageWidth - 21, pageHeight - 21)
    } else if (style.pageBorder === "thin") {
      doc.setDrawColor(...accent)
      doc.setLineWidth(0.35)
      if (style.rounded) doc.roundedRect(8, 8, pageWidth - 16, pageHeight - 16, 3, 3)
      else doc.rect(8, 8, pageWidth - 16, pageHeight - 16)
      doc.setLineWidth(0.2)
    }
    if (template.watermarkEnabled && template.watermarkImageDataUrl) {
      const opacity = Math.min(0.3, Math.max(0.05, template.watermarkOpacity))
      doc.saveGraphicsState()
      doc.setGState(doc.GState({ opacity }))
      addLogo(doc, template.watermarkImageDataUrl, pageWidth / 2 - 46, pageHeight / 2 - 46, 92, 92)
      doc.restoreGraphicsState()
    } else if (template.watermarkEnabled && template.watermarkText.trim()) {
      const opacity = Math.min(0.3, Math.max(0.05, template.watermarkOpacity))
      const watermarkInk = 82
      const watermarkColour = background.map((channel) => Math.round(channel * (1 - opacity) + watermarkInk * opacity)) as [number, number, number]
      doc.setTextColor(...watermarkColour)
      doc.setFont(baseFont, "bold")
      doc.setFontSize(31)
      doc.text(template.watermarkText.trim().slice(0, 48).toUpperCase(), pageWidth / 2, pageHeight / 2, { align: "center", angle: 32 })
    }
    if (showChanaxBranding) {
      doc.setTextColor(148, 163, 184)
      doc.setFont(baseFont, "normal")
      doc.setFontSize(6.5)
      if (chanaxBrandMark) addLogo(doc, chanaxBrandMark, margin, pageHeight - 12, 18, 6)
      doc.text("Generated by ChanaX", margin + (chanaxBrandMark ? 20 : 0), pageHeight - 7)
    }
  }

  paintPageBackground()
  doc.setFont(baseFont, "normal")
  doc.setTextColor(...ink)

  if (style.topStrip && !style.headerBand) {
    doc.setFillColor(...accent)
    doc.rect(0, 0, pageWidth, 8, "F")
  }

  const headerY = style.topStrip || style.headerBand ? 20 : 16
  const logoShift = shift("logo")
  const issuerShift = shift("issuer")
  const titleShift = shift("invoiceTitle")
  const logoAvailable = Boolean(element("logo").visible && template.logoDataUrl && (() => { try { doc.getImageProperties(template.logoDataUrl!); return true } catch { return false } })())
  const onBand = style.headerBand
  const headerInk: [number, number, number] = onBand ? white : ink
  const headerMuted: [number, number, number] = onBand ? [226, 232, 240] : muted
  const titleColour: [number, number, number] = onBand ? white : accent
  const nameSize = style.quietHeader ? 15 : 17
  const titleSize = style.quietHeader ? 17 : 20

  /** Lays out (and, when `draw` is true, prints) the header; returns its bottom edge. */
  const header = (draw: boolean) => {
    const centered = style.headerLayout === "centered"
    const logoRight = style.headerLayout === "logo-right"
    let bottom = headerY
    let logoBottom = headerY
    if (logoAvailable) {
      const logoX = centered ? (pageWidth - logoSize) / 2 : logoRight ? pageWidth - margin - logoSize : margin
      if (draw) addLogo(doc, template.logoDataUrl!, logoX + logoShift.x, headerY + logoShift.y, logoSize, logoSize)
      logoBottom = headerY + logoSize + logoShift.y
      bottom = Math.max(bottom, logoBottom)
    }
    const write = (text: string | string[], x: number, y: number, align: "left" | "right" | "center" = "left") => { if (draw) doc.text(text, x, y, { align }) }
    if (element("issuer").visible) {
      const issuerX = (centered ? pageWidth / 2 : logoRight || !logoAvailable ? margin : margin + logoSize + 5) + issuerShift.x
      const issuerWidth = centered ? 150 : logoRight ? Math.max(40, pageWidth - margin * 2 - Math.max(logoSize, 62) - 6) : Math.max(25, pageWidth - margin - 70 - issuerX)
      const align = centered ? "center" : "left"
      const nameY = (centered ? logoBottom + (logoAvailable ? 7 : 6) : headerY + 6) + issuerShift.y
      doc.setFont(baseFont, "bold")
      doc.setFontSize(nameSize)
      doc.setTextColor(...headerInk)
      const nameLines = doc.splitTextToSize(issuerName, issuerWidth) as string[]
      write(nameLines, issuerX, nameY, align)
      const addressY = nameY + nameLines.length * 6 + 2
      doc.setFont(baseFont, "normal")
      doc.setFontSize(8.5)
      doc.setTextColor(...headerMuted)
      const address = addressLines(doc, entity?.billingAddress || entity?.premisesAddress || "", issuerWidth)
      write(address, issuerX, addressY, align)
      let metaY = addressY + address.length * 4
      const meta = [entity?.gstin ? `GSTIN: ${entity.gstin}` : "", entity?.pan ? `PAN: ${entity.pan}` : ""].filter(Boolean)
      if (centered && meta.length) { write(meta.join("   |   "), issuerX, metaY, "center"); metaY += 4 }
      else meta.forEach((line) => { write(line, issuerX, metaY); metaY += 4 })
      bottom = Math.max(bottom, metaY + 4)
    }
    if (element("invoiceTitle").visible) {
      doc.setTextColor(...titleColour)
      doc.setFont(baseFont, "bold")
      doc.setFontSize(titleSize)
      if (centered) {
        const titleY = bottom + 6 + titleShift.y
        write(displayedTitle, pageWidth / 2 + titleShift.x, titleY, "center")
        doc.setTextColor(...headerMuted)
        doc.setFontSize(9)
        doc.setFont(baseFont, "normal")
        write(`${invoiceNumber}   |   ${invoice.date}`, pageWidth / 2 + titleShift.x, titleY + 6, "center")
        bottom = Math.max(bottom, titleY + 10)
      } else {
        const titleTop = (logoRight && logoAvailable ? logoBottom + 6 : headerY + 6) + titleShift.y
        const titleLines = doc.splitTextToSize(displayedTitle, 62) as string[]
        write(titleLines, pageWidth - margin + titleShift.x, titleTop, "right")
        const titleMetaY = titleTop + titleLines.length * 7
        doc.setTextColor(...headerMuted)
        doc.setFontSize(9)
        doc.setFont(baseFont, "normal")
        write(invoiceNumber, pageWidth - margin + titleShift.x, titleMetaY, "right")
        write(invoice.date, pageWidth - margin + titleShift.x, titleMetaY + 5, "right")
        bottom = Math.max(bottom, titleMetaY + 10)
      }
    }
    return bottom
  }

  let headerBottom = header(false)
  const dividerY = Math.max(56 + compactOffset, headerBottom + 5)
  if (onBand) {
    doc.setFillColor(...accent)
    doc.rect(0, 0, pageWidth, dividerY, "F")
  }
  headerBottom = header(true)
  doc.setTextColor(...ink)
  if (!onBand) {
    if (style.quietHeader) doc.setDrawColor(210, 214, 220)
    else doc.setDrawColor(...accent)
    doc.setLineWidth(style.quietHeader ? 0.25 : 0.45)
    doc.line(margin, dividerY, pageWidth - margin, dividerY)
  }

  if (isQuotation) {
    doc.setFillColor(255, 247, 214)
    doc.setDrawColor(217, 119, 6)
    doc.roundedRect(margin, dividerY + 4, pageWidth - margin * 2, 8, 1.5, 1.5, "FD")
    doc.setFont(baseFont, "bold")
    doc.setFontSize(7.2)
    doc.setTextColor(120, 53, 15)
    doc.text(
      "THIS IS A QUOTATION, NOT A SALES OR TAX INVOICE. IT DOES NOT RECORD A COMPLETED SALE.",
      pageWidth / 2,
      dividerY + 9,
      { align: "center" },
    )
  }

  if (hasCorrectionNotice) {
    const isOriginalCorrection = invoice.status === "Cancelled" || invoice.status === "Amended"
    doc.setFillColor(isOriginalCorrection ? 254 : 239, isOriginalCorrection ? 242 : 246, isOriginalCorrection ? 242 : 255)
    doc.setDrawColor(isOriginalCorrection ? 220 : 37, isOriginalCorrection ? 38 : 99, isOriginalCorrection ? 38 : 235)
    doc.roundedRect(margin, dividerY + 4, pageWidth - margin * 2, 8, 1.5, 1.5, "FD")
    doc.setFont(baseFont, "bold")
    doc.setFontSize(7.2)
    doc.setTextColor(isOriginalCorrection ? 153 : 30, isOriginalCorrection ? 27 : 64, isOriginalCorrection ? 27 : 175)
    const replacement = invoice.correction?.replacementInvoiceNumber ? ` REPLACEMENT: ${invoice.correction.replacementInvoiceNumber}.` : ""
    doc.text(
      invoice.status === "Cancelled" ? `CANCELLED INVOICE — DO NOT USE FOR PAYMENT OR TAX REPORTING.${replacement}` : invoice.status === "Amended" ? "AMENDED INVOICE — REFER TO THE RECORDED CORRECTION BEFORE USE." : `CORRECTED REPLACEMENT FOR INVOICE ${invoice.correctsInvoiceNumber}${invoice.regeneratedAt ? ` — REGENERATED ON ${invoice.regeneratedAt}` : ""}.`,
      pageWidth / 2,
      dividerY + 9,
      { align: "center" },
    )
  }

  const infoY = dividerY + (isQuotation || hasCorrectionNotice ? 20 : 10)
  let infoBottom = infoY + 25
  if (element("customer").visible) {
    const customerShift = shift("customer")
    doc.setFont(baseFont, "bold")
    doc.setFontSize(8)
    doc.setTextColor(...accent)
    doc.text(element("customer").label.toUpperCase(), margin + customerShift.x, infoY + customerShift.y)
    doc.setTextColor(...ink)
    doc.setFontSize(11)
    const nameLines = doc.splitTextToSize(customerName, 100) as string[]
    doc.text(nameLines, margin + customerShift.x, infoY + 7 + customerShift.y)
    doc.setFont(baseFont, "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(...muted)
    const customerAddress = addressLines(doc, customer?.billingAddress || customer?.premisesAddress || "", 100)
    const customerAddressY = infoY + 7 + customerShift.y + nameLines.length * 5 + 1
    doc.text(customerAddress, margin + customerShift.x, customerAddressY)
    let customerMetaY = customerAddressY + customerAddress.length * 4 + 1
    if (customer?.gstin) { doc.text(`GSTIN: ${customer.gstin}`, margin + customerShift.x, customerMetaY); customerMetaY += 4 }
    if (customer?.pan) { doc.text(`PAN: ${customer.pan}`, margin + customerShift.x, customerMetaY); customerMetaY += 4 }
    infoBottom = Math.max(infoBottom, customerMetaY)
  }

  if (element("invoiceDetails").visible) {
    const detailsShift = shift("invoiceDetails")
    doc.setFont(baseFont, "bold")
    doc.setFontSize(8)
    doc.setTextColor(...accent)
    doc.text(isQuotation ? "QUOTATION DETAILS" : element("invoiceDetails").label.toUpperCase(), 132 + detailsShift.x, infoY + detailsShift.y)
    doc.setTextColor(...ink)
    doc.setFont(baseFont, "normal")
    doc.text(isQuotation ? "Quotation number" : "Invoice number", 132 + detailsShift.x, infoY + 7 + detailsShift.y)
    doc.setFont(baseFont, "bold")
    doc.text(invoiceNumber, pageWidth - margin + detailsShift.x, infoY + 7 + detailsShift.y, { align: "right" })
    doc.setFont(baseFont, "normal")
    doc.text(isQuotation ? "Quotation date" : "Invoice date", 132 + detailsShift.x, infoY + 14 + detailsShift.y)
    doc.setFont(baseFont, "bold")
    doc.text(invoice.date, pageWidth - margin + detailsShift.x, infoY + 14 + detailsShift.y, { align: "right" })
    if (isQuotation && validUntil) {
      doc.setFont(baseFont, "normal")
      doc.text("Valid until", 132 + detailsShift.x, infoY + 21 + detailsShift.y)
      doc.setFont(baseFont, "bold")
      doc.text(validUntil, pageWidth - margin + detailsShift.x, infoY + 21 + detailsShift.y, { align: "right" })
    } else if (invoice.sourceProformaNumber) {
      doc.setFont(baseFont, "normal")
      doc.text("Source quotation", 132 + detailsShift.x, infoY + 21 + detailsShift.y)
      doc.setFont(baseFont, "bold")
      doc.text(invoice.sourceProformaNumber, pageWidth - margin + detailsShift.x, infoY + 21 + detailsShift.y, { align: "right" })
    }
    const statusY = infoY + detailsShift.y + (isQuotation && validUntil || invoice.sourceProformaNumber ? 28 : 21)
    doc.setFont(baseFont, "normal")
    doc.text(`Status: ${invoice.status}   |   Items: ${lineItems.length}`, 132 + detailsShift.x, statusY)
    infoBottom = Math.max(infoBottom, statusY + 5)
  }

  const itemsShift = shift("lineItems")
  const tableColumns = isGstInvoice
    ? [{ label: "Description", width: 36 }, { label: "HSN/SAC", width: 14 }, { label: "Qty", width: 9 }, { label: "Unit price", width: 20 }, { label: "Amount", width: 21 }, { label: "CGST", width: 17 }, { label: "SGST", width: 17 }, { label: "IGST", width: 17 }, { label: "Total", width: 27 }]
    : [{ label: "Description", width: 62 }, { label: "HSN/SAC", width: 20 }, { label: "Qty", width: 14 }, { label: "Unit price", width: 27 }, { label: "Amount", width: 27 }, { label: "Total", width: 28 }]
  const tableNumber = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const drawCell = (text: string, columnIndex: number, y: number, bold = false) => {
    const column = tableColumns[columnIndex]
    const x = margin + itemsShift.x + tableColumns.slice(0, columnIndex).reduce((sum, item) => sum + item.width, 0)
    const leftAligned = columnIndex < 2
    doc.setFont(baseFont, bold ? "bold" : "normal")
    let fontSize = isGstInvoice ? 6.5 : 8
    doc.setFontSize(fontSize)
    while (doc.getTextWidth(text) > column.width - 3 && fontSize > 5) { fontSize -= 0.25; doc.setFontSize(fontSize) }
    const lines = doc.splitTextToSize(text, column.width - 3) as string[]
    doc.text(lines, x + (leftAligned ? 1.5 : column.width - 1.5), y, { align: leftAligned ? "left" : "right" })
    return lines.length
  }
  const tableX = margin + itemsShift.x
  const tableWidth = pageWidth - margin * 2
  /** Vertical column rules for the boxed table style. */
  const columnRules = (top: number, bottom: number) => {
    let x = tableX
    tableColumns.slice(0, -1).forEach((column) => { x += column.width; doc.line(x, top, x, bottom) })
  }
  const drawTableHeader = (y: number) => {
    if (style.tableHeadFilled) {
      doc.setFillColor(...tableHead)
      doc.setTextColor(...white)
    } else {
      doc.setFillColor(...soft)
      doc.setTextColor(...ink)
    }
    if (style.rounded && style.tableStyle !== "boxed") doc.roundedRect(tableX, y, tableWidth, 10, 1.5, 1.5, "F")
    else doc.rect(tableX, y, tableWidth, 10, "F")
    if (style.tableStyle === "boxed") {
      doc.setDrawColor(203, 213, 225)
      doc.setLineWidth(0.25)
      doc.rect(tableX, y, tableWidth, 10, "S")
    }
    tableColumns.forEach((column, index) => drawCell(column.label, index, y + 6, true))
  }

  let rowY = Math.max(117 + compactOffset, infoBottom + 18) + itemsShift.y
  const tablePageBottom = 250
  if (element("lineItems").visible) drawTableHeader(rowY - 10)
  if (element("lineItems").visible) lineItems.forEach((item, index) => {
    doc.setFont(baseFont, "normal")
    doc.setFontSize(isGstInvoice ? 6.5 : 8)
    const descriptionLines = doc.splitTextToSize(item.description, tableColumns[0].width - 3) as string[]
    const rowHeight = Math.max(template.compact ? 10 : 13, descriptionLines.length * 3.5 + 6)
    if (rowY + rowHeight > tablePageBottom) {
      doc.addPage()
      paintPageBackground()
      doc.setFont(baseFont, "bold")
      doc.setTextColor(...ink)
      doc.setFontSize(12)
      doc.text(`${invoiceNumber} - continued`, margin + itemsShift.x, 18)
      drawTableHeader(26)
      rowY = 36
    }
    const taxAmount = item.cgstAmount + item.sgstAmount + item.igstAmount
    if (style.tableStyle === "striped" && index % 2 === 1) {
      doc.setFillColor(...stripe)
      doc.rect(tableX, rowY, tableWidth, rowHeight, "F")
    }
    doc.setTextColor(...ink)
    doc.setFont(baseFont, "normal")
    doc.setFontSize(isGstInvoice ? 6.5 : 8)
    doc.text(descriptionLines, margin + 1.5 + itemsShift.x, rowY + 5)
    const cells = [item.hsnSac || customer?.hsnSac || "-", String(item.quantity ?? 1), tableNumber(item.unitPrice ?? item.taxableAmount), tableNumber(item.taxableAmount), ...(isGstInvoice ? [tableNumber(item.cgstAmount), tableNumber(item.sgstAmount), tableNumber(item.igstAmount)] : []), tableNumber(item.taxableAmount + taxAmount)]
    cells.forEach((value, index) => drawCell(value, index + 1, rowY + 5, index === cells.length - 1))
    doc.setDrawColor(style.tableStyle === "boxed" ? 203 : 220, style.tableStyle === "boxed" ? 213 : 224, style.tableStyle === "boxed" ? 225 : 230)
    doc.setLineWidth(0.25)
    if (style.tableStyle === "boxed") {
      doc.rect(tableX, rowY, tableWidth, rowHeight, "S")
      columnRules(rowY, rowY + rowHeight)
    } else if (style.tableStyle === "lines" || (style.tableStyle !== "striped" && index === lineItems.length - 1)) {
      doc.line(tableX, rowY + rowHeight, tableX + tableWidth, rowY + rowHeight)
    } else if (style.tableStyle === "striped" && index === lineItems.length - 1) {
      doc.line(tableX, rowY + rowHeight, tableX + tableWidth, rowY + rowHeight)
    }
    rowY += rowHeight
    if (index === lineItems.length - 1) rowY += 2
  })

  // Reserve space for totals and footer, rather than breaking after four rows.
  if (rowY + 80 + Math.max(0, shift("totals").y) > pageHeight - 16) {
    doc.addPage()
    paintPageBackground()
    doc.setFont(baseFont, "bold")
    doc.setTextColor(...ink)
    doc.setFontSize(12)
    doc.text(`${invoiceNumber} - totals`, margin, 18)
    rowY = 30
  }

  const totalsShift = shift("totals")
  let totalsY = rowY + 10 + totalsShift.y
  if (element("totals").visible) {
      const summaryX = margin + totalsShift.x
      const summaryY = totalsY - 3
      const summaryWidth = pageWidth - margin * 2
      const columnWidth = summaryWidth / (isGstInvoice ? 4 : 1)
      const summaryItems: [string, number][] = [
        ["TAXABLE VALUE", totals.taxableAmount],
        ...(isGstInvoice ? [["CGST", totals.cgstAmount], ["SGST", totals.sgstAmount], ["IGST", totals.igstAmount]] as [string, number][] : []),
      ]
      if (style.totalsStyle === "outline") doc.setDrawColor(...accent)
      else doc.setDrawColor(220, 224, 230)
      doc.setLineWidth(0.3)
      if (style.rounded) doc.roundedRect(summaryX, summaryY, summaryWidth, 31, 2, 2, "S")
      else doc.rect(summaryX, summaryY, summaryWidth, 31, "S")
      summaryItems.forEach(([label, value], index) => {
        const itemX = summaryX + index * columnWidth
        if (index > 0) doc.line(itemX, summaryY, itemX, summaryY + 15)
        doc.setFont(baseFont, "bold")
        doc.setFontSize(6.7)
        doc.setTextColor(...muted)
        doc.text(label, itemX + 3, summaryY + 5.5)
        doc.setFontSize(8.8)
        doc.setTextColor(...ink)
        doc.text(money(value), itemX + 3, summaryY + 11.5)
      })
      if (style.totalsStyle === "filled") doc.setFillColor(...accent)
      else if (style.totalsStyle === "soft") doc.setFillColor(...soft)
      else doc.setFillColor(255, 255, 255)
      if (style.rounded && style.totalsStyle === "filled") {
        // Rounded bottom corners only: draw a rounded box and square off its top edge.
        doc.roundedRect(summaryX, summaryY + 15, summaryWidth, 16, 2, 2, "F")
        doc.rect(summaryX, summaryY + 15, summaryWidth, 4, "F")
      } else doc.rect(summaryX, summaryY + 15, summaryWidth, 16, "F")
      doc.setDrawColor(...(style.totalsStyle === "outline" ? accent : [220, 224, 230] as [number, number, number]))
      doc.line(summaryX, summaryY + 15, summaryX + summaryWidth, summaryY + 15)
      if (style.totalsStyle === "filled") doc.setTextColor(225, 235, 255)
      else doc.setTextColor(...muted)
      doc.setFont(baseFont, "bold")
      doc.setFontSize(6.7)
      doc.text(isQuotation ? "QUOTATION TOTAL" : "INVOICE TOTAL", summaryX + 4, summaryY + 21)
      doc.text(isQuotation ? "ESTIMATED AMOUNT" : "NET RECEIVABLE", summaryX + summaryWidth - 4, summaryY + 21, { align: "right" })
      if (style.totalsStyle === "filled") doc.setTextColor(...white)
      else if (style.totalsStyle === "outline") doc.setTextColor(...accent)
      else doc.setTextColor(...ink)
      doc.setFontSize(11.5)
      doc.text(money(totals.amount), summaryX + 4, summaryY + 28)
      doc.text(money(isQuotation ? totals.amount : netReceivable), summaryX + summaryWidth - 4, summaryY + 28, { align: "right" })
      totalsY = summaryY + 34
      if (invoice.tdsAmount || invoice.otherDeduction) {
        doc.setFont(baseFont, "normal")
        doc.setFontSize(7)
        doc.setTextColor(...muted)
        const deductions = [
          invoice.tdsAmount ? `Less: TDS ${money(invoice.tdsAmount)}` : "",
          invoice.otherDeduction ? `Other deduction ${money(invoice.otherDeduction)}` : "",
        ].filter(Boolean).join("   |   ")
        doc.text(deductions, summaryX + summaryWidth, totalsY + 2, { align: "right" })
        totalsY += 6
      }
  }

  const payment = quotationPayment(invoice, template)
  const showQuotationPaymentDetails = isQuotation && payment.show
  const showTerms = template.showTerms && element("terms").visible
  // Keep the footer clear of the permanent ChanaX mark at the bottom of the
  // page. Payment details and terms share the footer horizontally, so a
  // shallower, fixed reservation is more reliable than stacking them.
  const footerY = Math.max(218, Math.min(showChanaxBranding ? 238 : 248, totalsY + 16))
  doc.setDrawColor(220, 224, 230)
  doc.line(margin, footerY, pageWidth - margin, footerY)
  if (showQuotationPaymentDetails) {
    const paymentX = margin
    const paymentY = footerY + 6
    doc.setFont(baseFont, "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(...ink)
    doc.text("PAYMENT DETAILS", paymentX, paymentY)
    doc.setFont(baseFont, "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(...muted)
    const paymentLines = (doc.splitTextToSize(payment.text, 52) as string[]).slice(0, 5)
    if (paymentLines.length) doc.text(paymentLines, paymentX, paymentY + 6)
    if (payment.qr) {
      const qrSize = 22
      const qrX = margin + 56
      if (addLogo(doc, payment.qr, qrX, footerY + 4, qrSize, qrSize)) {
        doc.setFontSize(6.2)
        doc.text("Scan to pay", qrX + qrSize / 2, footerY + 29, { align: "center" })
      }
    }
  }
  if (showTerms) {
    const termsShift = shift("terms")
    // With payment details present, reserve three non-overlapping lanes:
    // payment/QR on the left, terms in the middle and signature on the right.
    const termsX = showQuotationPaymentDetails ? margin + 88 : margin
    const termsWidth = showQuotationPaymentDetails ? 44 : 102
    doc.setTextColor(...ink)
    doc.setFont(baseFont, "bold")
    doc.setFontSize(8.5)
    doc.text(element("terms").label, termsX + termsShift.x, footerY + 8 + termsShift.y)
    doc.setFont(baseFont, "normal")
    doc.setTextColor(...muted)
    doc.setFontSize(7.5)
    const terms = (doc.splitTextToSize(template.termsText || "", termsWidth) as string[]).slice(0, 4)
    doc.text(terms, termsX + termsShift.x, footerY + 14 + termsShift.y)
  }
  if (element("signature").visible) {
    const signatureShift = shift("signature")
    doc.setTextColor(...ink)
    doc.setFont(baseFont, "bold")
    doc.text(`For ${issuerName}`, pageWidth - margin + signatureShift.x, footerY + 8 + signatureShift.y, { align: "right" })
    if (template.signatureMode === "uploaded" && template.signatureDataUrl) {
      addLogo(doc, template.signatureDataUrl, pageWidth - margin - 38 + signatureShift.x, footerY + 10 + signatureShift.y, 38, 14)
      doc.setFont(baseFont, "normal")
      doc.setTextColor(...muted)
      doc.text(element("signature").label, pageWidth - margin + signatureShift.x, footerY + 27 + signatureShift.y, { align: "right" })
    } else if (template.signatureMode === "system") {
      doc.setFont(baseFont, "normal")
      doc.setTextColor(...muted)
      doc.setFontSize(7.2)
      const declaration = (doc.splitTextToSize(`This is a system-generated ${isQuotation ? "quotation" : "invoice"}. A signature is not required.`, showQuotationPaymentDetails ? 38 : 58) as string[]).slice(0, 3)
      doc.text(declaration, pageWidth - margin + signatureShift.x, footerY + 15 + signatureShift.y, { align: "right" })
    }
  }
  if (template.customTexts.length) {
    doc.setPage(1)
    template.customTexts.forEach((block) => {
      const x = (block.x / 100) * pageWidth
      const y = (block.y / 100) * pageHeight
      const align = block.align
      doc.setFont(baseFont, block.bold ? "bold" : "normal")
      doc.setFontSize(Math.max(6, Math.min(27, block.fontSize * 0.75)))
      doc.setTextColor(...colour(block.color))
      const maxWidth = align === "left" ? pageWidth - margin - x : align === "right" ? x - margin : Math.min(x - margin, pageWidth - margin - x) * 2
      const lines = (doc.splitTextToSize(block.text || "", Math.max(28, maxWidth)) as string[]).slice(0, 8)
      doc.text(lines, x, y, { align })
    })
  }

  return doc
}

export async function downloadInvoicePdf(input: InvoicePdfInput) {
  const doc = await createInvoicePdf(input)
  doc.save(invoicePdfFileName(input.invoice))
  trackAction(input.documentType === "quotation" ? "quotation_pdf_downloaded" : "invoice_pdf_downloaded")
}

export function invoicePdfFileName(invoice: Invoice) {
  return `${cleanInvoiceFileName(invoice.companyName)}_${cleanInvoiceFileName(invoice.date)}.pdf`
}

export async function createInvoicePdfFile(input: InvoicePdfInput) {
  const doc = await createInvoicePdf(input)
  return {
    name: invoicePdfFileName(input.invoice),
    data: new Uint8Array(doc.output("arraybuffer")),
  }
}
