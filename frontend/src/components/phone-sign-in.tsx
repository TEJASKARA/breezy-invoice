import { useEffect, useState } from "react"
import { ArrowRight, LoaderCircle, MessageCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sendPhoneLoginCode, signInWithPhoneCode } from "@/lib/phone-verification-api"

/** Sign in with a phone number verified on the account: WhatsApp code, then session. */
export function PhoneSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState<"send" | "verify" | null>(null)
  const [message, setMessage] = useState("")
  const [isError, setIsError] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  async function sendCode() {
    if (phone.replace(/\D/g, "").length < 10) {
      setIsError(true)
      setMessage("Enter your mobile number, for example 98765 43210.")
      return
    }
    setBusy("send")
    setMessage("")
    try {
      const result = await sendPhoneLoginCode(phone)
      setCodeSent(true)
      setCode("")
      setResendIn(30)
      setIsError(false)
      setMessage(result.message)
    } catch (error) {
      setIsError(true)
      setMessage(error instanceof Error ? error.message : "We couldn't send the code. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    if (!codeSent) { void sendCode(); return }
    if (!/^\d{6}$/.test(code)) {
      setIsError(true)
      setMessage("Enter the 6-digit code from WhatsApp.")
      return
    }
    setBusy("verify")
    setMessage("")
    try {
      await signInWithPhoneCode(phone, code)
      onSignedIn()
    } catch (error) {
      setIsError(true)
      setMessage(error instanceof Error ? error.message : "We couldn't sign you in. Please try again.")
      setBusy(null)
    }
  }

  return <form onSubmit={verify} className="space-y-5">
    <div className="space-y-2">
      <Label htmlFor="login-phone">Mobile number</Label>
      <Input id="login-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} disabled={codeSent || busy !== null} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" />
      {codeSent ? <button type="button" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" disabled={busy !== null} onClick={() => { setCodeSent(false); setCode(""); setMessage("") }}>Change number</button> : <p className="text-xs text-muted-foreground">Use the number you verified on your ChanaX account. We'll send a code on WhatsApp.</p>}
    </div>
    {codeSent ? <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="login-code">6-digit code</Label>
        <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" disabled={busy !== null || resendIn > 0} onClick={() => void sendCode()}>{resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}</Button>
      </div>
      <Input id="login-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" className="font-mono tracking-[0.3em]" />
    </div> : null}
    <Button className="w-full" disabled={busy !== null}>
      {busy ? <LoaderCircle className="animate-spin" /> : codeSent ? null : <MessageCircle />}
      {busy === "send" ? "Sending code…" : busy === "verify" ? "Signing in…" : codeSent ? "Sign in" : "Send code on WhatsApp"}
      {!busy && codeSent ? <ArrowRight /> : null}
    </Button>
    {message ? <p role={isError ? "alert" : "status"} className={isError ? "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" : "rounded-lg bg-muted p-3 text-sm text-muted-foreground"}>{message}</p> : null}
  </form>
}
