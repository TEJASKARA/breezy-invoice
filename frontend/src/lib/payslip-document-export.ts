import type { Company, Payslip, TemplateSettings } from "@/lib/mvp-store"
import { payslipPageBreaks } from "@/lib/payslip-page-breaks"
import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url"
import geistLatinExt from "@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2?url"

let embeddedFonts: Promise<string> | undefined
function exportFonts() {
  const faces = [
    { url: geistLatin, range: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
    { url: geistLatinExt, range: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ]
  return embeddedFonts ??= Promise.all(faces.map(async ({ url, range }) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error("The document font could not be loaded. Please try again.")
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return `@font-face{font-family:'Geist Variable';font-style:normal;font-weight:100 900;unicode-range:${range};src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2');}`
  })).then((rules) => rules.join("\n")).catch((error) => {
    embeddedFonts = undefined
    throw error
  })
}

type Input = { payslip: Payslip; entity?: Company; template: TemplateSettings; canRemoveBranding?: boolean }

/** Export the same fixed-width document used in PayslipPreview. */
export async function exportPayslipDocument(input: Input) {
  const [{ jsPDF }, { default: html2canvas }, React, { createRoot }, { flushSync }, { PayslipPreview }] = await Promise.all([
    import("jspdf"), import("html2canvas"), import("react"), import("react-dom/client"), import("react-dom"), import("@/components/payslip-preview"),
  ])
  const host = document.createElement("div")
  host.setAttribute("aria-hidden", "true")
  host.inert = true
  Object.assign(host.style, { position: "fixed", top: "0", left: "-10000px", width: "820px", pointerEvents: "none" })
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(React.createElement(PayslipPreview, input)))
    await document.fonts.ready
    const article = host.querySelector<HTMLElement>("[data-payslip-document]")
    if (!article) throw new Error("The payslip document could not be prepared.")
    await Promise.all(Array.from(article.querySelectorAll("img"), (image) => image.decode()))
    const bounds = article.getBoundingClientRect()
    const fonts = input.template.fontStyle === "sans" ? await exportFonts() : ""
    const blocks = Array.from(article.querySelectorAll("[data-pdf-keep-together]"), (element) => {
      const rect = element.getBoundingClientRect()
      return { top: rect.top - bounds.top, bottom: rect.bottom - bounds.top }
    })
    const pages = payslipPageBreaks(bounds.height, bounds.width * 297 / 210, blocks)
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
    doc.setProperties({ title: `Salary payslip: ${input.payslip.employeeName} (${input.payslip.month})`, subject: "Salary payslip", creator: "ChanaX" })
    const scale = Math.min(2, Math.sqrt(8_000_000 / (bounds.width * bounds.height)))
    const documentCanvas = await html2canvas(article, {
        scale,
        x: 0, y: 0, width: bounds.width, height: bounds.height,
        windowWidth: 1280, windowHeight: 900, scrollX: 0, scrollY: 0,
        backgroundColor: input.template.pageColor, logging: false, useCORS: true,
        foreignObjectRendering: true,
        onclone: (clone, element) => {
          if (element.parentElement) element.parentElement.style.left = "0"
          element.style.margin = "0"
          element.style.width = `${bounds.width}px`
          element.style.height = `${bounds.height}px`
          if (fonts) {
            const style = clone.createElement("style")
            style.textContent = fonts
            element.appendChild(style)
          }
          // Tailwind's OKLCH palette is valid browser CSS but unsupported by
          // html2canvas's parser. Normalize only the cloned export, not the UI.
          const probe = clone.createElement("canvas")
          probe.width = probe.height = 1
          const context = probe.getContext("2d")!
          const cache = new Map<string, string>()
          const rgb = (value: string) => {
            if (cache.has(value)) return cache.get(value)!
            context.clearRect(0, 0, 1, 1)
            context.fillStyle = value
            context.fillRect(0, 0, 1, 1)
            const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data
            const result = `rgba(${r}, ${g}, ${b}, ${alpha / 255})`
            cache.set(value, result)
            return result
          }
          for (const node of [clone.documentElement, clone.body, element, ...element.querySelectorAll<HTMLElement>("*")]) {
            const computed = clone.defaultView!.getComputedStyle(node)
            for (const property of ["color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "text-decoration-color"]) {
              node.style.setProperty(property, rgb(computed.getPropertyValue(property)), "important")
            }
            node.style.boxShadow = "none"
          }
        },
      })
    for (const [index, page] of pages.entries()) {
      const canvas = document.createElement("canvas")
      canvas.width = documentCanvas.width
      canvas.height = Math.ceil(page.height * scale)
      canvas.getContext("2d")!.drawImage(documentCanvas, 0, page.top * scale, documentCanvas.width, page.height * scale, 0, 0, canvas.width, canvas.height)
      if (index) doc.addPage()
      doc.addImage(canvas, "PNG", 0, 0, 210, page.height * 210 / bounds.width, undefined, "FAST")
      canvas.width = canvas.height = 0
    }
    documentCanvas.width = documentCanvas.height = 0
    return doc
  } finally {
    root.unmount()
    host.remove()
  }
}
