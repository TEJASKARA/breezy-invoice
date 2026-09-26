import { trackAction } from "@/lib/usage-tracking"

type GeneratedPdf = {
  name: string
  data: Uint8Array
}

type WhatsAppPdfShareInput = {
  title: string
  message: string
  createFile: () => Promise<GeneratedPdf>
}

export type WhatsAppShareResult = "shared" | "opened" | "cancelled"

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.matchMedia("(pointer: coarse)").matches)
}

export async function sharePdfViaWhatsApp(input: WhatsAppPdfShareInput): Promise<WhatsAppShareResult> {
  const result = await shareViaWhatsApp(input)
  const document = /payslip/i.test(input.title) ? "payslip" : /quotation|proforma/i.test(input.title) ? "quotation" : /letter/i.test(input.title) ? "employee_letter" : "invoice"
  if (result !== "cancelled") trackAction("whatsapp_share", { document, result })
  return result
}

async function shareViaWhatsApp({ title, message, createFile }: WhatsAppPdfShareInput): Promise<WhatsAppShareResult> {
  const mobile = isMobileDevice()
  const shareUrl = `${mobile ? "https://wa.me/" : "https://web.whatsapp.com/send"}?text=${encodeURIComponent(message)}`

  if (navigator.share && navigator.canShare) {
    const generated = await createFile()
    const file = new File([Uint8Array.from(generated.data)], generated.name, { type: "application/pdf" })

    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title, text: message, files: [file] })
        return "shared"
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return "cancelled"
        // Some mobile browsers advertise file sharing but reject PDFs at runtime.
        // Fall back to opening WhatsApp with the prepared message only.
      }
    }
  }

  if (!mobile) {
    const whatsappWindow = window.open(shareUrl, "_blank")
    if (!whatsappWindow) throw new Error("Allow pop-ups for ChanaX to open WhatsApp Web.")
    whatsappWindow.opener = null
    return "opened"
  }

  window.location.href = shareUrl
  return "opened"
}
