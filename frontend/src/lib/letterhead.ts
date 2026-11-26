import type { jsPDF as JsPdfDocument } from "jspdf"
import type { Company, TemplateSettings } from "./mvp-store.tsx"
import { embedPdfFont } from "@/lib/document-fonts"

export type LetterheadStyle = "classic" | "centered" | "banner" | "split" | "image"
export type LetterheadBorder = "none" | "thin" | "double"

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
  /** Library font id (document-fonts.ts); empty uses the template's font. */
  fontFamily: string
  /** Letterhead colour; null uses the brand colour from Templates. */
  accentColor: string | null
  textColor: string
  /** Logo height in mm. */
  logoSize: number
  /** Company name size in pt. */
  nameSize: number
  /** Side for the logo in the Classic, Banner and Split styles. */
  logoPosition: "left" | "right"
  /** Page colour; null uses the template's page colour. */
  pageColor: string | null
  pageBorder: LetterheadBorder
  watermarkText: string
  watermarkOpacity: number
  /** Full-page background, e.g. a scanned pre-printed letterpad. */
  backgroundImageDataUrl: string | null
}

export const letterheadStyles: { id: LetterheadStyle; name: string; description: string }[] = [
  { id: "classic", name: "Classic", description: "Logo and name, accent rule below" },
  { id: "centered", name: "Centered", description: "Logo, name and address centred" },
  { id: "banner", name: "Banner", description: "Name on a band in your colour" },
  { id: "split", name: "Split", description: "Name on one side, contact on the other" },
  { id: "image", name: "Your own design", description: "Upload a header (and footer) image" },
]

export function defaultLetterhead(): LetterheadSettings {
  return {
    style: "classic", headerImageDataUrl: null, footerImageDataUrl: null, phone: "", email: "", website: "", registration: "", showGstin: true, footerText: "",
    fontFamily: "", accentColor: null, textColor: "#141414", logoSize: 18, nameSize: 17, logoPosition: "left", pageColor: null, pageBorder: "none", watermarkText: "", watermarkOpacity: 0.08, backgroundImageDataUrl: null,
  }
}

const hexColour = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

export function normalizeLetterhead(value: Partial<LetterheadSettings> | null | undefined): LetterheadSettings {
  const base = defaultLetterhead()
  if (!value) return base
  return {
    style: (["classic", "centered", "banner", "split", "image"] as const).includes(value.style as LetterheadStyle) ? value.style as LetterheadStyle : base.style,
    headerImageDataUrl: typeof value.headerImageDataUrl === "string" ? value.headerImageDataUrl : null,
    footerImageDataUrl: typeof value.footerImageDataUrl === "string" ? value.footerImageDataUrl : null,
    phone: String(value.phone || ""),
    email: String(value.email || ""),
    website: String(value.website || ""),
    registration: String(value.registration || ""),
    showGstin: value.showGstin !== false,
    footerText: String(value.footerText || ""),
    fontFamily: typeof value.fontFamily === "string" ? value.fontFamily : "",
    accentColor: hexColour(value.accentColor),
    textColor: hexColour(value.textColor) || base.textColor,
    logoSize: clamp(value.logoSize, 10, 40, base.logoSize),
    nameSize: clamp(value.nameSize, 12, 26, base.nameSize),
    logoPosition: value.logoPosition === "right" ? "right" : "left",
    pageColor: hexColour(value.pageColor),
    pageBorder: value.pageBorder === "thin" || value.pageBorder === "double" ? value.pageBorder : "none",
    watermarkText: String(value.watermarkText || "").slice(0, 48),
    watermarkOpacity: clamp(value.watermarkOpacity, 0.04, 0.3, base.watermarkOpacity),
    backgroundImageDataUrl: typeof value.backgroundImageDataUrl === "string" ? value.backgroundImageDataUrl : null,
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

/** Draws the logo `size` mm tall (wide logos capped at 2.5× that); returns its width. */
function drawLogo(doc: JsPdfDocument, dataUrl: string | null, x: number, y: number, size: number, alignRight = false) {
  if (!dataUrl) return 0
  try {
    const properties = doc.getImageProperties(dataUrl)
    const ratio = properties.width / properties.height
    const width = Math.min(size * ratio, size * 2.5)
    const height = width / ratio
    doc.addImage(dataUrl, imageFormat(dataUrl), alignRight ? x - width : x, y, width, height)
    return width
  } catch {
    return 0
  }
}

export type LetterheadDrawOptions = { entity?: Company; template: TemplateSettings; letterhead: LetterheadSettings; font?: string }

/** Letterhead colour: its own, else the brand colour from Templates. */
export function letterheadAccent(template: Pick<TemplateSettings, "accentColor">, letterhead: LetterheadSettings) {
  return letterhead.accentColor || template.accentColor
}

/**
 * Page background for letterhead pages: page colour, background image, border
 * and watermark. Falls back to the template's page colour and watermark.
 */
export function paintLetterheadPage(doc: JsPdfDocument, { template, letterhead, font = "helvetica" }: LetterheadDrawOptions) {
  const page = rgb(letterhead.pageColor || template.pageColor || "#FFFFFF")
  doc.setFillColor(...page)
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, "F")
  if (letterhead.backgroundImageDataUrl) {
    try { doc.addImage(letterhead.backgroundImageDataUrl, imageFormat(letterhead.backgroundImageDataUrl), 0, 0, PAGE_WIDTH, PAGE_HEIGHT) } catch { /* keep the page usable */ }
  }
  const accent = rgb(letterheadAccent(template, letterhead))
  if (letterhead.pageBorder !== "none") {
    doc.setDrawColor(...accent)
    doc.setLineWidth(letterhead.pageBorder === "double" ? 0.7 : 0.35)
    doc.rect(8, 8, PAGE_WIDTH - 16, PAGE_HEIGHT - 16)
    if (letterhead.pageBorder === "double") { doc.setLineWidth(0.2); doc.rect(10.5, 10.5, PAGE_WIDTH - 21, PAGE_HEIGHT - 21) }
    doc.setLineWidth(0.2)
  }
  const watermark = letterhead.watermarkText.trim() || (template.watermarkEnabled ? template.watermarkText?.trim() : "")
  if (watermark) {
    const opacity = letterhead.watermarkText.trim() ? letterhead.watermarkOpacity : Math.min(0.3, Math.max(0.05, template.watermarkOpacity))
    const colour = page.map((channel) => Math.round(channel * (1 - opacity) + 82 * opacity)) as [number, number, number]
    doc.setTextColor(...colour); doc.setFont(font, "bold"); doc.setFontSize(31)
    doc.text(watermark.slice(0, 48).toUpperCase(), PAGE_WIDTH / 2, PAGE_HEIGHT / 2, { align: "center", angle: 32 })
  }
}

/**
 * Draws the letterhead header and footer on the current page and returns the
 * y position (mm) where the letter content can start.
 */
export function drawLetterhead(doc: JsPdfDocument, { entity, template, letterhead, font = "helvetica" }: LetterheadDrawOptions) {
  const accent = rgb(letterheadAccent(template, letterhead))
  const ink = rgb(letterhead.textColor)
  const name = entity?.companyName || "Your Company Name"
  const address = (entity?.billingAddress || entity?.premisesAddress || "").replace(/\s*\n\s*/g, ", ")
  const contact = letterheadContactLine(letterhead)
  const registration = letterheadRegistrationLine(letterhead, entity)
  const right = letterhead.logoPosition === "right"
  const logoSize = letterhead.logoSize
  const nameSize = letterhead.nameSize
  let top = 18

  if (letterhead.style === "image" && letterhead.headerImageDataUrl) {
    const height = fullWidthImage(doc, letterhead.headerImageDataUrl, 0, 60)
    top = Math.max(height + 8, 18)
  } else if (letterhead.style === "banner") {
    const bandHeight = Math.max(34, logoSize + 16)
    doc.setFillColor(...accent)
    doc.rect(0, 0, PAGE_WIDTH, bandHeight, "F")
    const logoWidth = drawLogo(doc, template.logoDataUrl, right ? PAGE_WIDTH - MARGIN : MARGIN, (bandHeight - logoSize) / 2, logoSize, right)
    const x = !right && logoWidth ? MARGIN + logoWidth + 6 : MARGIN
    const textWidth = PAGE_WIDTH - MARGIN * 2 - (logoWidth ? logoWidth + 6 : 0)
    doc.setTextColor(255, 255, 255); doc.setFont(font, "bold"); doc.setFontSize(nameSize)
    doc.text(name, x, bandHeight / 2 - 3)
    doc.setFont(font, "normal"); doc.setFontSize(8.5)
    const lines = [address, contact].filter(Boolean).flatMap((line) => doc.splitTextToSize(line, textWidth) as string[]).slice(0, 3)
    if (lines.length) doc.text(lines, x, bandHeight / 2 + 3)
    top = bandHeight + 10
  } else if (letterhead.style === "centered") {
    let y = 14
    try {
      if (template.logoDataUrl) {
        const properties = doc.getImageProperties(template.logoDataUrl)
        const ratio = properties.width / properties.height
        const width = Math.min(logoSize * ratio, 70)
        doc.addImage(template.logoDataUrl, imageFormat(template.logoDataUrl), (PAGE_WIDTH - width) / 2, y, width, width / ratio)
        y += width / ratio + 6
      }
    } catch { /* keep the letterhead usable if the logo can't be decoded */ }
    doc.setTextColor(...ink); doc.setFont(font, "bold"); doc.setFontSize(nameSize)
    doc.text(name, PAGE_WIDTH / 2, y + 2, { align: "center" })
    y += 8
    doc.setFont(font, "normal"); doc.setFontSize(8.5); doc.setTextColor(90)
    for (const line of [address, contact].filter(Boolean)) {
      const wrapped = (doc.splitTextToSize(line, 160) as string[]).slice(0, 2)
      doc.text(wrapped, PAGE_WIDTH / 2, y, { align: "center" })
      y += wrapped.length * 4
    }
    y += 2
    doc.setDrawColor(...accent); doc.setLineWidth(0.6); doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y); doc.setLineWidth(0.2)
    top = y + 10
  } else if (letterhead.style === "split") {
    // Logo and name on one side, address and contact on the other.
    const logoWidth = drawLogo(doc, template.logoDataUrl, right ? PAGE_WIDTH - MARGIN : MARGIN, 14, logoSize, right)
    const nameX = right ? PAGE_WIDTH - MARGIN - (logoWidth ? logoWidth + 5 : 0) : MARGIN + (logoWidth ? logoWidth + 5 : 0)
    doc.setTextColor(...ink); doc.setFont(font, "bold"); doc.setFontSize(nameSize)
    const nameLines = (doc.splitTextToSize(name, 95 - (logoWidth ? logoWidth + 5 : 0)) as string[]).slice(0, 2)
    doc.text(nameLines, nameX, 14 + Math.min(logoSize, 18) / 2 + 2, { align: right ? "right" : "left" })
    doc.setFont(font, "normal"); doc.setFontSize(8.5); doc.setTextColor(90)
    const detailX = right ? MARGIN : PAGE_WIDTH - MARGIN
    let y = 17
    for (const line of [address, contact].filter(Boolean).flatMap((text) => (doc.splitTextToSize(text, 72) as string[]).slice(0, 3))) {
      doc.text(line, detailX, y, { align: right ? "left" : "right" })
      y += 4
    }
    y = Math.max(y, 14 + Math.max(logoSize, nameLines.length * 7)) + 3
    doc.setDrawColor(...accent); doc.setLineWidth(0.8); doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y); doc.setLineWidth(0.2)
    top = y + 10
  } else {
    // Classic (also used for "image" until a header image is uploaded).
    const logoWidth = drawLogo(doc, template.logoDataUrl, right ? PAGE_WIDTH - MARGIN : MARGIN, 14, logoSize, right)
    const x = right ? PAGE_WIDTH - MARGIN - (logoWidth ? logoWidth + 6 : 0) : logoWidth ? MARGIN + logoWidth + 6 : MARGIN
    const align = right ? "right" : "left"
    const width = PAGE_WIDTH - MARGIN * 2 - (logoWidth ? logoWidth + 6 : 0)
    doc.setTextColor(...ink); doc.setFont(font, "bold"); doc.setFontSize(nameSize)
    doc.text(name, x, 21, { align })
    doc.setFont(font, "normal"); doc.setFontSize(8.5); doc.setTextColor(90)
    let y = 26
    for (const line of [address, contact].filter(Boolean)) {
      const wrapped = (doc.splitTextToSize(line, width) as string[]).slice(0, 2)
      doc.text(wrapped, x, y, { align })
      y += wrapped.length * 4
    }
    y = Math.max(y, logoWidth ? 14 + logoSize : y) + 2
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
      doc.setFont(font, "normal"); doc.setFontSize(7.5); doc.setTextColor(110)
      footerLines.slice(0, 2).forEach((line, index) => doc.text((doc.splitTextToSize(line, 170) as string[])[0], PAGE_WIDTH / 2, 279 + index * 4, { align: "center" }))
    }
  }
  doc.setTextColor(...ink)
  return top
}

/** The font for letterhead pages: the letterhead's own, else the template's. */
export function letterheadFont(doc: JsPdfDocument, template: TemplateSettings, letterhead: LetterheadSettings) {
  return embedPdfFont(doc, letterhead.fontFamily || template.fontFamily, template.fontStyle)
}

/** A blank page on the company letterhead, ready to print or write on. */
export async function createLetterheadPdf({ entity, template, letterhead, canRemoveBranding = false }: { entity?: Company; template: TemplateSettings; letterhead: LetterheadSettings; canRemoveBranding?: boolean }) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true })
  const font = await letterheadFont(doc, template, letterhead)
  paintLetterheadPage(doc, { entity, template, letterhead, font })
  drawLetterhead(doc, { entity, template, letterhead, font })
  if (template.showChanaxBranding || !canRemoveBranding) {
    doc.setTextColor(148, 163, 184); doc.setFont(font, "normal"); doc.setFontSize(6.5)
    doc.text("Created by ChanaX", PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 4, { align: "right" })
  }
  return doc
}

export function letterheadFileName(entity?: Pick<Company, "companyName">) {
  return `${(entity?.companyName || "Company").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "Company"}_letterhead.pdf`
}
