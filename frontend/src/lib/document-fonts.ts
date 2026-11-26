import type { jsPDF as JsPdfDocument } from "jspdf"

/** Fonts users can pick for invoices, quotations, letters and letterheads. */
export type DocumentFontCategory = "Sans serif" | "Serif" | "Monospace"
export type DocumentFont = { id: string; name: string; category: DocumentFontCategory; css: string }

const sans = (id: string, name: string): DocumentFont => ({ id, name, category: "Sans serif", css: `"ChanaX ${name}", ui-sans-serif, system-ui, sans-serif` })
const serif = (id: string, name: string): DocumentFont => ({ id, name, category: "Serif", css: `"ChanaX ${name}", ui-serif, Georgia, serif` })
const mono = (id: string, name: string): DocumentFont => ({ id, name, category: "Monospace", css: `"ChanaX ${name}", ui-monospace, monospace` })

/** Bundled in /public/fonts as <id>-regular.ttf and <id>-bold.ttf. */
export const documentFonts: DocumentFont[] = [
  sans("inter", "Inter"),
  sans("roboto", "Roboto"),
  sans("open-sans", "Open Sans"),
  sans("lato", "Lato"),
  sans("montserrat", "Montserrat"),
  sans("poppins", "Poppins"),
  sans("nunito-sans", "Nunito Sans"),
  sans("source-sans-3", "Source Sans 3"),
  sans("work-sans", "Work Sans"),
  sans("dm-sans", "DM Sans"),
  sans("manrope", "Manrope"),
  sans("raleway", "Raleway"),
  sans("noto-sans", "Noto Sans"),
  sans("fira-sans", "Fira Sans"),
  sans("oswald", "Oswald"),
  serif("merriweather", "Merriweather"),
  serif("playfair-display", "Playfair Display"),
  serif("lora", "Lora"),
  serif("libre-baskerville", "Libre Baskerville"),
  serif("noto-serif", "Noto Serif"),
  serif("eb-garamond", "EB Garamond"),
  serif("pt-serif", "PT Serif"),
  mono("jetbrains-mono", "JetBrains Mono"),
  mono("ibm-plex-mono", "IBM Plex Mono"),
  mono("roboto-mono", "Roboto Mono"),
]

/** The three original built-in PDF fonts, kept for templates saved before the font library. */
export type BuiltInFontStyle = "sans" | "serif" | "mono"

export function findDocumentFont(id: string | null | undefined) {
  return id ? documentFonts.find((font) => font.id === id) : undefined
}

export function builtInPdfFont(style: BuiltInFontStyle | undefined) {
  if (style === "serif") return "times"
  if (style === "mono") return "courier"
  return "helvetica"
}

/** CSS font-family for the on-screen preview. */
export function documentFontCss(id: string | null | undefined, fallback: BuiltInFontStyle = "sans") {
  const font = findDocumentFont(id)
  if (font) return font.css
  if (fallback === "serif") return "ui-serif, Georgia, 'Times New Roman', serif"
  if (fallback === "mono") return "ui-monospace, 'Courier New', monospace"
  return "ui-sans-serif, system-ui, Helvetica, Arial, sans-serif"
}

const fileCache = new Map<string, Promise<string | null>>()

function fontFileBase64(path: string) {
  let cached = fileCache.get(path)
  if (!cached) {
    cached = (async () => {
      if (typeof window === "undefined" || typeof fetch === "undefined") return null
      try {
        const response = await fetch(path)
        if (!response.ok) return null
        const bytes = new Uint8Array(await response.arrayBuffer())
        let binary = ""
        for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
        return btoa(binary)
      } catch {
        return null
      }
    })()
    fileCache.set(path, cached)
    void cached.then((value) => { if (!value) fileCache.delete(path) })
  }
  return cached
}

/**
 * Embeds the chosen font (regular and bold) in the PDF and returns the font
 * name to pass to doc.setFont. Falls back to the built-in PDF fonts when no
 * library font is chosen or its files can't be loaded.
 */
export async function embedPdfFont(doc: JsPdfDocument, fontId: string | null | undefined, fallback: BuiltInFontStyle = "sans") {
  const font = findDocumentFont(fontId)
  if (!font) return builtInPdfFont(fallback)
  const [regular, bold] = await Promise.all([fontFileBase64(`/fonts/${font.id}-regular.ttf`), fontFileBase64(`/fonts/${font.id}-bold.ttf`)])
  if (!regular || !bold) return builtInPdfFont(fallback)
  try {
    doc.addFileToVFS(`${font.id}-regular.ttf`, regular)
    doc.addFont(`${font.id}-regular.ttf`, font.id, "normal")
    doc.addFileToVFS(`${font.id}-bold.ttf`, bold)
    doc.addFont(`${font.id}-bold.ttf`, font.id, "bold")
    return font.id
  } catch {
    return builtInPdfFont(fallback)
  }
}

const loadedCss = new Set<string>()

/** Makes a library font available to the on-screen preview (loaded once per page). */
export function loadDocumentFontCss(id: string | null | undefined) {
  const font = findDocumentFont(id)
  if (!font || loadedCss.has(font.id) || typeof document === "undefined") return
  loadedCss.add(font.id)
  const style = document.createElement("style")
  style.dataset.documentFont = font.id
  style.textContent = `@font-face{font-family:"ChanaX ${font.name}";src:url(/fonts/${font.id}-regular.ttf) format("truetype");font-weight:400;font-display:swap}`
    + `@font-face{font-family:"ChanaX ${font.name}";src:url(/fonts/${font.id}-bold.ttf) format("truetype");font-weight:600 800;font-display:swap}`
  document.head.appendChild(style)
}
