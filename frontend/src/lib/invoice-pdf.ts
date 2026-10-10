import type { jsPDF as JsPdfDocument } from "jspdf"

import { calculateInvoiceTotals, getInvoiceLineItems } from "@/lib/invoice-calculations"
import type { Company, Customer, Invoice, TemplateElementId, TemplateSettings } from "@/lib/mvp-store"
import { trackAction } from "@/lib/usage-tracking"

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

function fontName(style: TemplateSettings["fontStyle"]) {
  if (style === "serif") return "times"
  if (style === "mono") return "courier"
  return "helvetica"
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
  const accent = colour(template.accentColor)
  const ink: [number, number, number] = [24, 24, 27]
  const muted: [number, number, number] = [100, 116, 139]
  const soft: [number, number, number] = [245, 247, 250]
  const baseFont = fontName(template.fontStyle)
  const invoiceNumber = invoice.sourceNumber || invoice.number
  const issuerName = entity?.companyName || invoice.entityName || "Issuing entity"
  const customerName = customer?.companyName || invoice.companyName
  const lineItems = getInvoiceLineItems(invoice)
  const totals = calculateInvoiceTotals(lineItems)
  const netReceivable = invoice.netReceivable ?? totals.amount - (invoice.tdsAmount || 0) - (invoice.otherDeduction || 0)
  const compactOffset = template.compact ? -3 : 0
  const element = (id: TemplateElementId) => template.elements[id]
  const isQuotation = documentType === "quotation"
  const isGstInvoice = entity?.hasGstin ?? Boolean(entity?.gstin)
  const displayedTitle = isQuotation ? "QUOTATION / PROFORMA" : isGstInvoice ? element("invoiceTitle").label : "INVOICE"
  const validUntil = (invoice as Invoice & { validUntil?: string }).validUntil
  const showChanaxBranding = template.showChanaxBranding || !canRemoveBranding
  // The editor's 760px-wide page maps to A4, not one millimetre per 3px.
  const logoSize = Math.min(120, Math.max(40, template.logoSize)) * pageWidth / 760
  const hasCorrectionNotice = !isQuotation && (invoice.status === "Cancelled" || invoice.status === "Amended" || Boolean(invoice.correctsInvoiceNumber))
  const shift = (id: TemplateElementId) => ({
    x: (element(id).offsetX / 100) * pageWidth,
    y: (element(id).offsetY / 100) * pageHeight,
  })
  const paintPageBackground = () => {
    const background = colour(template.pageColor)
    doc.setFillColor(...background)
    doc.rect(0, 0, pageWidth, pageHeight, "F")
    if (template.watermarkEnabled && template.watermarkText.trim()) {
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
      doc.text("Created by ChanaX", pageWidth - margin, pageHeight - 7, { align: "right" })
    }
  }

  paintPageBackground()
  doc.setFont(baseFont, "normal")
  doc.setTextColor(...ink)

  if (template.preset === "breeze") {
    doc.setFillColor(...accent)
    doc.rect(0, 0, pageWidth, 8, "F")
  } else if (template.preset === "classic") {
    doc.setDrawColor(...accent)
    doc.setLineWidth(0.7)
    doc.rect(8, 8, pageWidth - 16, pageHeight - 16)
    doc.setLineWidth(0.2)
    doc.rect(10.5, 10.5, pageWidth - 21, pageHeight - 21)
  }

  const headerY = template.preset === "breeze" ? 20 : 16
  const logoShift = shift("logo")
  const logoShown = Boolean(element("logo").visible && template.logoDataUrl && addLogo(doc, template.logoDataUrl, margin + logoShift.x, headerY + logoShift.y, logoSize, logoSize))
  const issuerShift = shift("issuer")
  const issuerX = (logoShown ? margin + logoSize + 5 : margin) + issuerShift.x
  let headerBottom = headerY + (logoShown ? logoSize + logoShift.y : 0)
  if (element("issuer").visible) {
    doc.setFont(baseFont, "bold")
    doc.setFontSize(template.preset === "minimal" ? 15 : 17)
    const issuerWidth = Math.max(25, pageWidth - margin - 70 - issuerX)
    const issuerNameLines = doc.splitTextToSize(issuerName, issuerWidth) as string[]
    doc.text(issuerNameLines, issuerX, headerY + 6 + issuerShift.y)
    const addressY = headerY + 6 + issuerShift.y + issuerNameLines.length * 6 + 2
    doc.setFont(baseFont, "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(...muted)
    const issuerAddress = addressLines(doc, entity?.billingAddress || entity?.premisesAddress || "", issuerWidth)
    doc.text(issuerAddress, issuerX, addressY)
    const issuerMetaY = addressY + issuerAddress.length * 4
    if (entity?.gstin) doc.text(`GSTIN: ${entity.gstin}`, issuerX, issuerMetaY)
    if (entity?.pan) doc.text(`PAN: ${entity.pan}`, issuerX, issuerMetaY + 4)
    headerBottom = Math.max(headerBottom, issuerMetaY + 8)
  }

  if (element("invoiceTitle").visible) {
    const titleShift = shift("invoiceTitle")
    doc.setTextColor(...accent)
    doc.setFont(baseFont, "bold")
    doc.setFontSize(template.preset === "minimal" ? 17 : 20)
    const titleLines = doc.splitTextToSize(displayedTitle, 62) as string[]
    doc.text(titleLines, pageWidth - margin + titleShift.x, headerY + 6 + titleShift.y, { align: "right" })
    const titleMetaY = headerY + 6 + titleShift.y + titleLines.length * 7
    doc.setTextColor(...muted)
    doc.setFontSize(9)
    doc.setFont(baseFont, "normal")
    doc.text(invoiceNumber, pageWidth - margin + titleShift.x, titleMetaY, { align: "right" })
    doc.text(invoice.date, pageWidth - margin + titleShift.x, titleMetaY + 5, { align: "right" })
    headerBottom = Math.max(headerBottom, titleMetaY + 10)
  }

  const dividerY = Math.max(56 + compactOffset, headerBottom + 5)
  doc.setDrawColor(template.preset === "minimal" ? 210 : accent[0], template.preset === "minimal" ? 214 : accent[1], template.preset === "minimal" ? 220 : accent[2])
  doc.setLineWidth(template.preset === "minimal" ? 0.25 : 0.45)
  doc.line(margin, dividerY, pageWidth - margin, dividerY)

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
      invoice.status === "Cancelled" ? `CANCELLED INVOICE — DO NOT USE FOR PAYMENT OR TAX REPORTING.${replacement}` : invoice.status === "Amended" ? "AMENDED INVOICE — REFER TO THE RECORDED CORRECTION BEFORE USE." : `CORRECTED REPLACEMENT FOR INVOICE ${invoice.correctsInvoiceNumber}.`,
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
  const drawTableHeader = (y: number) => {
    if (template.preset === "breeze") {
      doc.setFillColor(...accent)
      doc.setTextColor(255, 255, 255)
    } else {
      doc.setFillColor(...soft)
      doc.setTextColor(...ink)
    }
    doc.rect(margin + itemsShift.x, y, pageWidth - margin * 2, 10, "F")
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
    doc.setTextColor(...ink)
    doc.setFont(baseFont, "normal")
    doc.setFontSize(isGstInvoice ? 6.5 : 8)
    doc.text(descriptionLines, margin + 1.5 + itemsShift.x, rowY + 5)
    const cells = [item.hsnSac || customer?.hsnSac || "-", String(item.quantity ?? 1), tableNumber(item.unitPrice ?? item.taxableAmount), tableNumber(item.taxableAmount), ...(isGstInvoice ? [tableNumber(item.cgstAmount), tableNumber(item.sgstAmount), tableNumber(item.igstAmount)] : []), tableNumber(item.taxableAmount + taxAmount)]
    cells.forEach((value, index) => drawCell(value, index + 1, rowY + 5, index === cells.length - 1))
    doc.setDrawColor(220, 224, 230)
    doc.setLineWidth(0.25)
    doc.line(margin + itemsShift.x, rowY + rowHeight, pageWidth - margin + itemsShift.x, rowY + rowHeight)
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
      if (template.preset === "classic") doc.setDrawColor(...accent)
      else doc.setDrawColor(220, 224, 230)
      doc.setLineWidth(0.3)
      if (template.preset === "breeze") doc.roundedRect(summaryX, summaryY, summaryWidth, 31, 2, 2, "S")
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
      if (template.preset === "breeze") doc.setFillColor(...accent)
      else if (template.preset === "minimal") doc.setFillColor(...soft)
      else doc.setFillColor(255, 255, 255)
      doc.rect(summaryX, summaryY + 15, summaryWidth, 16, "F")
      doc.setDrawColor(...(template.preset === "classic" ? accent : [220, 224, 230] as [number, number, number]))
      doc.line(summaryX, summaryY + 15, summaryX + summaryWidth, summaryY + 15)
      if (template.preset === "breeze") doc.setTextColor(225, 235, 255)
      else doc.setTextColor(...muted)
      doc.setFont(baseFont, "bold")
      doc.setFontSize(6.7)
      doc.text(isQuotation ? "QUOTATION TOTAL" : "INVOICE TOTAL", summaryX + 4, summaryY + 21)
      doc.text(isQuotation ? "ESTIMATED AMOUNT" : "NET RECEIVABLE", summaryX + summaryWidth - 4, summaryY + 21, { align: "right" })
      if (template.preset === "breeze") doc.setTextColor(255, 255, 255)
      else if (template.preset === "classic") doc.setTextColor(...accent)
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

  const footerY = Math.max(225, Math.min(250, totalsY + 22))
  doc.setDrawColor(220, 224, 230)
  doc.line(margin, footerY, pageWidth - margin, footerY)
  if (template.showTerms && element("terms").visible) {
    const termsShift = shift("terms")
    doc.setTextColor(...ink)
    doc.setFont(baseFont, "bold")
    doc.setFontSize(8.5)
    doc.text(element("terms").label, margin + termsShift.x, footerY + 8 + termsShift.y)
    doc.setFont(baseFont, "normal")
    doc.setTextColor(...muted)
    doc.setFontSize(7.5)
    const terms = (doc.splitTextToSize(template.termsText || "", 102) as string[]).slice(0, 4)
    doc.text(terms, margin + termsShift.x, footerY + 14 + termsShift.y)
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
      const declaration = doc.splitTextToSize(`This is a system-generated ${isQuotation ? "quotation" : "invoice"}. A signature is not required.`, 58) as string[]
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
