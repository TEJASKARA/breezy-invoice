import type { jsPDF as JsPdfDocument } from "jspdf"
import type { Company, TemplateSettings } from "./mvp-store.tsx"

export type LetterheadStyle = "classic" | "centered" | "banner" | "image"

/** Company letterhead printed on employee letters and as a blank letterhead PDF. */
export type LetterheadSettings = {
  style: LetterheadStyle
  /** Full-width header artwork, used by the "image" style. */
  headerImageDataUrl: string | null
  /** Optional full-width footer artwork, used by the "image" style. */
  footerImageDataUrl: string | null
  phone: string
  email: string
  website: string
  /** Extra registration line, e.g. CIN. */
  registration: string
  showGstin: boolean
  footerText: string
}

export const letterheadStyles: { id: LetterheadStyle; name: string; description: string }[] = [
  { id: "classic", name: "Classic", description: "Logo and name on the left, accent rule below" },
  { id: "centered", name: "Centered", description: "Logo, name and address centered" },
  { id: "banner", name: "Banner", description: "Name on a band in your brand colour" },
  { id: "image", name: "Your own design", description: "Upload a header (and footer) image" },
]

export function defaultLetterhead(): LetterheadSettings {
  return { style: "classic", headerImageDataUrl: null, footerImageDataUrl: null, phone: "", email: "", website: "", registration: "", showGstin: true, footerText: "" }
}

export function normalizeLetterhead(value: Partial<LetterheadSettings> | null | undefined): LetterheadSettings {
  const base = defaultLetterhead()
  if (!value) return base
  return {
    style: (["classic", "centered", "banner", "image"] as const).includes(value.style as LetterheadStyle) ? value.style as LetterheadStyle : base.style,
    headerImageDataUrl: typeof value.headerImageDataUrl === "string" ? value.headerImageDataUrl : null,
    footerImageDataUrl: typeof value.footerImageDataUrl === "string" ? value.footerImageDataUrl : null,
    phone: String(value.phone || ""),
    email: String(value.email || ""),
    website: String(value.website || ""),
    registration: String(value.registration || ""),
    showGstin: value.showGstin !== false,
    footerText: String(value.footerText || ""),
  }
}

/** Contact line: phone · email · website. */
export function letterheadContactLine(letterhead: LetterheadSettings) {
  return [letterhead.phone, letterhead.email, letterhead.website].map((item) => item.trim()).filter(Boolean).join("  ·  ")
}

/** Registration line: GSTIN and any extra registration (CIN etc.). */
export function letterheadRegistrationLine(letterhead: LetterheadSettings, entity?: Pick<Company, "gstin">) {
  return [letterhead.showGstin && entity?.gstin ? `GSTIN: ${entity.gstin}` : "", letterhead.registration.trim()].filter(Boolean).join("  ·  ")
}

/** Lowest y (mm) the letter body may reach before the footer. */
export const LETTERHEAD_CONTENT_BOTTOM = 264

const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297
const MARGIN = 20

function rgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "2563EB"
  return [Number.parseInt(normalized.slice(0, 2), 16), Number.parseInt(normalized.slice(2, 4), 16), Number.parseInt(normalized.slice(4, 6), 16)]
}

function imageFormat(dataUrl: string) {
  return dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG"
}

/** Draws an image scaled to `width`, capped at `maxHeight`; returns its drawn height (0 if it can't be decoded). */
function fullWidthImage(doc: JsPdfDocument, dataUrl: string, y: number, maxHeight: number, alignBottom = false) {
  try {
    const properties = doc.getImageProperties(dataUrl)
    let width = PAGE_WIDTH
    let height = properties.height * (width / properties.width)
    if (height > maxHeight) { height = maxHeight; width = properties.width * (height / properties.height) }
    const x = (PAGE_WIDTH - width) / 2
    doc.addImage(dataUrl, imageFormat(dataUrl), x, alignBottom ? y - height : y, width, height)
    return height
  } catch {
    return 0
  }
}

function drawLogo(doc: JsPdfDocument, dataUrl: string | null, x: number, y: number, size: number) {
  if (!dataUrl) return 0
  try {
    const properties = doc.getImageProperties(dataUrl)
    const ratio = properties.width / properties.height
    const width = ratio >= 1 ? Math.min(size * ratio, size * 2.5) : size * ratio
    const height = ratio >= 1 ? width / ratio : size
    doc.addImage(dataUrl, imageFormat(dataUrl), x, y, width, height)
    return width
  } catch {
    return 0
  }
}

/**
 * Draws the letterhead header and footer on the current page and returns the
 * y position (mm) where the letter content can start.
 */
export function drawLetterhead(doc: JsPdfDocument, { entity, template, letterhead }: { entity?: Company; template: TemplateSettings; letterhead: LetterheadSettings }) {
  const accent = rgb(template.accentColor)
  const name = entity?.companyName || "Your Company Name"
  const address = (entity?.billingAddress || entity?.premisesAddress || "").replace(/\s*\n\s*/g, ", ")
  const contact = letterheadContactLine(letterhead)
  const registration = letterheadRegistrationLine(letterhead, entity)
  let top = 18

  if (letterhead.style === "image" && letterhead.headerImageDataUrl) {
    const height = fullWidthImage(doc, letterhead.headerImageDataUrl, 0, 60)
    top = Math.max(height + 8, 18)
  } else if (letterhead.style === "banner") {
    doc.setFillColor(...accent)
    doc.rect(0, 0, PAGE_WIDTH, 34, "F")
    const logoWidth = drawLogo(doc, template.logoDataUrl, MARGIN, 8, 18)
    const x = logoWidth ? MARGIN + logoWidth + 6 : MARGIN
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(16)
    doc.text(name, x, 15)
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5)
    const lines = [address, contact].filter(Boolean).flatMap((line) => doc.splitTextToSize(line, PAGE_WIDTH - x - MARGIN) as string[]).slice(0, 3)
    if (lines.length) doc.text(lines, x, 21)
    top = 44
  } else if (letterhead.style === "centered") {
    const logoSize = 16
    let y = 14
    try {
      if (template.logoDataUrl) {
        const properties = doc.getImageProperties(template.logoDataUrl)
        const ratio = properties.width / properties.height
        const height = logoSize
        const width = Math.min(height * ratio, 60)
        doc.addImage(template.logoDataUrl, imageFormat(template.logoDataUrl), (PAGE_WIDTH - width) / 2, y, width, width / ratio)
        y += width / ratio + 6
      }
    } catch { /* keep the letterhead usable if the logo can't be decoded */ }
    doc.setTextColor(20); doc.setFont("helvetica", "bold"); doc.setFontSize(17)
    doc.text(name, PAGE_WIDTH / 2, y + 2, { align: "center" })
    y += 8
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(90)
    for (const line of [address, contact].filter(Boolean)) {
      const wrapped = (doc.splitTextToSize(line, 160) as string[]).slice(0, 2)
      doc.text(wrapped, PAGE_WIDTH / 2, y, { align: "center" })
      y += wrapped.length * 4
    }
    y += 2
    doc.setDrawColor(...accent); doc.setLineWidth(0.6); doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y); doc.setLineWidth(0.2)
    top = y + 10
  } else {
    // Classic (also used for "image" until a header image is uploaded).
    const logoWidth = drawLogo(doc, template.logoDataUrl, MARGIN, 14, 18)
    const x = logoWidth ? MARGIN + logoWidth + 6 : MARGIN
    doc.setTextColor(20); doc.setFont("helvetica", "bold"); doc.setFontSize(17)
    doc.text(name, x, 21)
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(90)
    let y = 26
    for (const line of [address, contact].filter(Boolean)) {
      const wrapped = (doc.splitTextToSize(line, PAGE_WIDTH - x - MARGIN) as string[]).slice(0, 2)
      doc.text(wrapped, x, y)
      y += wrapped.length * 4
    }
    y = Math.max(y, logoWidth ? 34 : y) + 2
    doc.setDrawColor(...accent); doc.setLineWidth(0.8); doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y); doc.setLineWidth(0.2)
    top = y + 10
  }

  // Footer
  if (letterhead.style === "image" && letterhead.footerImageDataUrl) {
    fullWidthImage(doc, letterhead.footerImageDataUrl, PAGE_HEIGHT, 26, true)
  } else {
    const footerLines = [registration, letterhead.footerText.trim()].filter(Boolean)
    if (footerLines.length || letterhead.style === "banner") {
      doc.setDrawColor(...accent); doc.setLineWidth(0.4); doc.line(MARGIN, 274, PAGE_WIDTH - MARGIN, 274); doc.setLineWidth(0.2)
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(110)
      footerLines.slice(0, 2).forEach((line, index) => doc.text((doc.splitTextToSize(line, 170) as string[])[0], PAGE_WIDTH / 2, 279 + index * 4, { align: "center" }))
    }
  }
  doc.setTextColor(20)
  return top
}

/** A blank page on the company letterhead, ready to print or write on. */
export async function createLetterheadPdf({ entity, template, letterhead, canRemoveBranding = false }: { entity?: Company; template: TemplateSettings; letterhead: LetterheadSettings; canRemoveBranding?: boolean }) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true })
  const page = rgb(template.pageColor || "#FFFFFF")
  if (template.pageColor && template.pageColor.toUpperCase() !== "#FFFFFF") { doc.setFillColor(...page); doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, "F") }
  drawLetterhead(doc, { entity, template, letterhead })
  if (template.showChanaxBranding || !canRemoveBranding) {
    doc.setTextColor(148, 163, 184); doc.setFont("helvetica", "normal"); doc.setFontSize(6.5)
    doc.text("Created by ChanaX", PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 4, { align: "right" })
  }
  return doc
}

export function letterheadFileName(entity?: Pick<Company, "companyName">) {
  return `${(entity?.companyName || "Company").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "Company"}_letterhead.pdf`
}
