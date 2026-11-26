/**
 * Guest mode: the free tools on the home page run the real ChanaX pages with
 * everything kept in this browser. Guests get one free PDF download; later
 * downloads ask them to sign up (free), and their data moves into the new
 * workspace. Guest PDFs carry a small "Made with ChanaX" footer.
 *
 * The limit is counted in the browser (a soft limit) and each download is
 * also recorded on the server against a hashed browser id.
 */

export const GUEST_STATE_KEY = "chanax-guest-workspace"
export const GUEST_FREE_DOWNLOADS = 1
export const GUEST_PDF_FOOTER = "Made with ChanaX - free at chanax.in"
/** Fired when a guest has used their free download and tries another. */
export const GUEST_LIMIT_EVENT = "chanax:guest-download-limit"
/** Fired after a guest download is allowed. */
export const GUEST_DOWNLOAD_EVENT = "chanax:guest-download"

const DOWNLOADS_KEY = "chanax-guest-downloads"
const VISITOR_KEY = "chanax-anonymous-visitor-id"
const apiUrl = String(import.meta.env?.VITE_API_URL || "").replace(/\/$/, "")

let guest = false
let currentTool = "free-tools"

export function setGuestMode(enabled: boolean, tool?: string) {
  guest = enabled
  if (tool) currentTool = tool.replace(/[^a-z_-]/g, "").slice(0, 40) || "free-tools"
}

export function isGuestMode() {
  return guest
}

function storage() {
  try { return window.localStorage } catch { return null }
}

export function guestDownloadsUsed() {
  const value = Number(storage()?.getItem(DOWNLOADS_KEY) || 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function guestDownloadsLeft() {
  return Math.max(0, GUEST_FREE_DOWNLOADS - guestDownloadsUsed())
}

export function hasGuestData() {
  return Boolean(storage()?.getItem(GUEST_STATE_KEY))
}

function recordOnServer(tool: string) {
  if (!apiUrl) return
  const store = storage()
  let visitorId = store?.getItem(VISITOR_KEY) || ""
  if (!visitorId) { visitorId = crypto.randomUUID(); store?.setItem(VISITOR_KEY, visitorId) }
  void fetch(`${apiUrl}/api/v1/analytics/guest-download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor_id: visitorId, tool }),
    keepalive: true,
  }).catch(() => undefined)
}

/** Allows a guest download if one is left; otherwise asks the guest to sign up. Signed-in users always pass. */
export function claimGuestDownload() {
  if (!guest) return true
  const used = guestDownloadsUsed()
  if (used >= GUEST_FREE_DOWNLOADS) {
    window.dispatchEvent(new CustomEvent(GUEST_LIMIT_EVENT))
    return false
  }
  storage()?.setItem(DOWNLOADS_KEY, String(used + 1))
  recordOnServer(currentTool)
  window.dispatchEvent(new CustomEvent(GUEST_DOWNLOAD_EVENT))
  return true
}

type PdfDocument = {
  output: (...args: unknown[]) => unknown
  save: (...args: unknown[]) => unknown
  getNumberOfPages: () => number
  setPage: (page: number) => unknown
  setFont: (font: string, style: string) => unknown
  setFontSize: (size: number) => unknown
  setTextColor: (r: number, g: number, b: number) => unknown
  text: (text: string, x: number, y: number, options?: Record<string, unknown>) => unknown
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } }
}

const stamped = new WeakSet<object>()

/** Adds the guest footer to every page, once per document. */
export function stampGuestFooter(doc: PdfDocument) {
  if (!guest || stamped.has(doc)) return
  stamped.add(doc)
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    const width = doc.internal.pageSize.getWidth()
    const height = doc.internal.pageSize.getHeight()
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(GUEST_PDF_FOOTER, width / 2, height - 3, { align: "center" })
  }
  doc.setPage(pages)
}

let installed = false

/**
 * Hooks every PDF made with jsPDF: in guest mode, downloads (save) use the
 * free allowance and every output carries the guest footer. Signed-in use is
 * unaffected.
 */
export async function installGuestPdfGuard() {
  if (installed) return
  installed = true
  const { jsPDF } = await import("jspdf")
  const api = jsPDF.API as unknown as { events: unknown[] }
  api.events.push(["initialized", function (this: PdfDocument) { guardDocument(this) }])
}

/** Wraps one PDF's output/save with the guest footer and download allowance. */
function guardDocument(doc: PdfDocument) {
    const output = doc.output.bind(doc)
    const save = doc.save.bind(doc)
    doc.output = (...args: unknown[]) => { stampGuestFooter(doc); return output(...args) }
    doc.save = (...args: unknown[]) => {
      if (!claimGuestDownload()) return doc
      stampGuestFooter(doc)
      return save(...args)
    }
}

const guestPaths: Record<string, string> = {
  "/invoices": "/free/invoice",
  "/proformas": "/free/quotation",
  "/employees/letters": "/free/offer-letter",
  "/settings/templates": "/free/invoice-design",
  "/settings/letterhead": "/free/letterhead",
}

/** In the free tools, app links point to the matching free tool instead of a sign-in page. */
export function appPath(path: string) {
  return guest ? guestPaths[path] || path : path
}
