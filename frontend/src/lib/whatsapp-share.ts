type GeneratedPdf = {
  name: string
  data: Uint8Array
}

type WhatsAppPdfShareInput = {
  title: string
  message: string
  createFile: () => Promise<GeneratedPdf>
}

export type WhatsAppShareResult = "shared" | "downloaded-and-opened" | "cancelled"

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.matchMedia("(pointer: coarse)").matches)
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file)
  const link = document.createElement("a")
  link.href = url
  link.download = file.name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export async function sharePdfViaWhatsApp({ title, message, createFile }: WhatsAppPdfShareInput): Promise<WhatsAppShareResult> {
  const mobile = isMobileDevice()
  const whatsappWindow = mobile ? null : window.open("about:blank", "_blank")

  try {
    const generated = await createFile()
    const file = new File([Uint8Array.from(generated.data)], generated.name, { type: "application/pdf" })

    if (mobile && navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ title, text: message, files: [file] })
        return "shared"
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return "cancelled"
        // Some mobile browsers advertise file sharing but reject PDFs at runtime.
        // Fall back to downloading the PDF and opening WhatsApp with the message.
      }
    }

    downloadFile(file)
    const shareUrl = `${mobile ? "https://wa.me/" : "https://web.whatsapp.com/send"}?text=${encodeURIComponent(message)}`
    if (whatsappWindow) {
      whatsappWindow.location.replace(shareUrl)
    } else {
      window.location.href = shareUrl
    }
    return "downloaded-and-opened"
  } catch (error) {
    whatsappWindow?.close()
    throw error
  }
}
