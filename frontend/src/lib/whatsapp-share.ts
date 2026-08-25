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

export async function sharePdfViaWhatsApp({ title, message, createFile }: WhatsAppPdfShareInput): Promise<WhatsAppShareResult> {
  const mobile = isMobileDevice()
  const shareUrl = `${mobile ? "https://wa.me/" : "https://web.whatsapp.com/send"}?text=${encodeURIComponent(message)}`

  if (!mobile) {
    const whatsappWindow = window.open(shareUrl, "_blank")
    if (!whatsappWindow) throw new Error("Allow pop-ups for ChanaX to open WhatsApp Web.")
    whatsappWindow.opener = null
    return "opened"
  }

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

  window.location.href = shareUrl
  return "opened"
}
