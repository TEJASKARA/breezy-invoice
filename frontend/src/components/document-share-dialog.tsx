import { useEffect, useState } from "react"
import { LoaderCircle, Mail, MessageCircle, Send, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { normalizeWhatsAppNumber } from "@/lib/whatsapp-number"

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function DocumentShareDialog({
  title,
  open,
  onClose,
  onEmail,
  onWhatsApp,
  onWhatsAppSend,
}: {
  title: string
  open: boolean
  onClose: () => void
  onEmail?: (email: string) => Promise<void>
  /** Opens WhatsApp on this device with a prepared message (the user attaches/sends it themselves). */
  onWhatsApp: () => Promise<void>
  /** Sends the PDF straight to the recipient's WhatsApp number. When omitted, only onWhatsApp is offered. */
  onWhatsAppSend?: (number: string) => Promise<void>
}) {
  const [mode, setMode] = useState<"choose" | "email" | "whatsapp">("choose")
  const [email, setEmail] = useState("")
  const [whatsAppNumber, setWhatsAppNumber] = useState("")
  const [pending, setPending] = useState<"email" | "whatsapp" | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setMode("choose")
    setEmail("")
    setWhatsAppNumber("")
    setPending(null)
    setError("")
  }, [open])

  if (!open) return null

  const emailDocument = async () => {
    if (!onEmail) return
    const recipient = email.trim().toLowerCase()
    if (!emailPattern.test(recipient)) {
      setError("Enter a valid recipient email address.")
      return
    }
    setPending("email")
    setError("")
    try { await onEmail(recipient) } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "The email could not be sent.")
      setPending(null)
    }
  }

  const sendWhatsApp = async () => {
    if (!onWhatsAppSend) return
    const recipient = normalizeWhatsAppNumber(whatsAppNumber)
    if (!recipient) {
      setError("Enter a valid WhatsApp number with its country code, for example +91 98765 43210.")
      return
    }
    setPending("whatsapp")
    setError("")
    try { await onWhatsAppSend(recipient) } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "The document could not be sent on WhatsApp.")
      setPending(null)
    }
  }

  const shareWhatsApp = async () => {
    setPending("whatsapp")
    setError("")
    try { await onWhatsApp() } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "WhatsApp could not be opened.")
      setPending(null)
    }
  }

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="document-share-title">
    <Card className="w-full max-w-md shadow-2xl">
      <CardHeader className="relative pr-14">
        <CardTitle id="document-share-title">Share {title}</CardTitle>
        <CardDescription>Choose how you want to send this document.</CardDescription>
        <Button className="absolute right-4 top-4" size="icon" variant="ghost" aria-label="Close share options" onClick={onClose}><X /></Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === "choose" ? <div className={`grid gap-3 ${onEmail ? "sm:grid-cols-2" : ""}`}>
          {onEmail ? <Button className="h-auto justify-start gap-3 p-4" variant="outline" disabled={pending !== null} onClick={() => setMode("email")}><Mail className="size-5" /><span className="text-left"><span className="block font-medium">Email</span><span className="block text-xs font-normal text-muted-foreground">Send the PDF attachment</span></span></Button> : null}
          <Button className="h-auto justify-start gap-3 p-4" variant="outline" disabled={pending !== null} onClick={() => { if (onWhatsAppSend) { setMode("whatsapp"); setError("") } else void shareWhatsApp() }}>{pending === "whatsapp" ? <LoaderCircle className="size-5 animate-spin" /> : <MessageCircle className="size-5" />}<span className="text-left"><span className="block font-medium">WhatsApp</span><span className="block text-xs font-normal text-muted-foreground">{onWhatsAppSend ? "Send the PDF to a number" : "Open app or WhatsApp Web"}</span></span></Button>
        </div> : mode === "whatsapp" ? <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="document-share-whatsapp">Recipient WhatsApp number</Label>
            <Input id="document-share-whatsapp" type="tel" inputMode="tel" autoComplete="off" autoFocus value={whatsAppNumber} onChange={(event) => { setWhatsAppNumber(event.target.value); setError("") }} placeholder="+91 98765 43210" onKeyDown={(event) => { if (event.key === "Enter") void sendWhatsApp() }} />
            <p className="text-xs text-muted-foreground">Include the country code. A 10-digit Indian mobile number is sent to +91 automatically. The PDF is delivered from the ChanaX WhatsApp number.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={pending !== null} onClick={() => { setMode("choose"); setError("") }}>Back</Button><Button disabled={pending !== null} onClick={() => void sendWhatsApp()}>{pending === "whatsapp" ? <LoaderCircle className="animate-spin" /> : <Send />}{pending === "whatsapp" ? "Sending PDF" : "Send PDF"}</Button></div>
          <button type="button" disabled={pending !== null} onClick={() => void shareWhatsApp()} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50">Send from my own WhatsApp instead</button>
        </div> : <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="document-share-email">Recipient email</Label><Input id="document-share-email" type="email" autoFocus value={email} onChange={(event) => { setEmail(event.target.value); setError("") }} placeholder="customer@company.com" onKeyDown={(event) => { if (event.key === "Enter") void emailDocument() }} /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={pending !== null} onClick={() => setMode("choose")}>Back</Button><Button disabled={pending !== null} onClick={() => void emailDocument()}>{pending === "email" ? <LoaderCircle className="animate-spin" /> : <Mail />}{pending === "email" ? "Sending PDF" : "Send PDF"}</Button></div>
        </div>}
        {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  </div>
}
