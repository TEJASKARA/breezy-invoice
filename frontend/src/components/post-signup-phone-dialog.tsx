import { useEffect, useState } from "react"
import { ArrowLeft, LoaderCircle, Phone, ShieldCheck } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import type { User } from "@supabase/supabase-js"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sendPhoneCode, verifyPhoneCode } from "@/lib/phone-verification-api"
import { supabase } from "@/lib/supabase"
import { normalizeWhatsAppNumber } from "@/lib/whatsapp-number"

const RESEND_SECONDS = 30

type PostSignupPhoneDialogProps = {
  user: User | null
  onPendingChange: (pending: boolean) => void
}

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

export function PostSignupPhoneDialog({ user, onPendingChange }: PostSignupPhoneDialogProps) {
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(true)
  const [step, setStep] = useState<"phone" | "code">("phone")
  const [phone, setPhone] = useState("")
  const [sentTo, setSentTo] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    let active = true

    async function checkPhoneRequirement() {
      setChecking(true)
      setOpen(false)
      setError("")
      if (!user || !supabase) {
        if (active) {
          setChecking(false)
          onPendingChange(false)
        }
        return
      }

      onPendingChange(true)
      const [eligibilityResult, profileResult] = await Promise.all([
        supabase.from("chanax_signup_survey_eligible_users").select("user_id").eq("user_id", user.id).maybeSingle(),
        supabase.from("profiles").select("phone, phone_verified_at").eq("id", user.id).maybeSingle(),
      ])

      if (!active) return
      setChecking(false)
      if (eligibilityResult.error || profileResult.error) {
        console.error("Unable to check post-signup phone status", eligibilityResult.error || profileResult.error)
        onPendingChange(false)
        return
      }

      const pending = Boolean(eligibilityResult.data) && !profileResult.data?.phone_verified_at
      if (pending && profileResult.data?.phone) setPhone(profileResult.data.phone)
      setOpen(pending)
      onPendingChange(pending)
    }

    void checkPhoneRequirement()
    return () => { active = false }
  }, [user, onPendingChange])

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn((seconds) => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  async function requestCode(target: string) {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const result = await sendPhoneCode(target)
      setSentTo(target)
      setCode("")
      setStep("code")
      setNotice(result.message)
      setResendIn(RESEND_SECONDS)
    } catch (sendError) {
      setError(message(sendError, "We couldn't send the code. Please try again."))
    } finally {
      setBusy(false)
    }
  }

  async function submitPhone(event: React.FormEvent) {
    event.preventDefault()
    const digits = normalizeWhatsAppNumber(phone)
    if (!digits) {
      setError("Enter a valid WhatsApp number with country code, for example +91 98765 43210.")
      return
    }
    await requestCode(digits)
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from WhatsApp.")
      return
    }
    setBusy(true)
    setError("")
    try {
      await verifyPhoneCode(sentTo, code)
      setOpen(false)
      onPendingChange(false)
    } catch (verifyError) {
      setError(message(verifyError, "That code could not be verified. Please try again."))
      setCode("")
    } finally {
      setBusy(false)
    }
  }

  if (checking || !user) return null

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby="post-signup-phone-description"
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-2xl outline-none"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            {step === "phone" ? <Phone className="size-5" aria-hidden="true" /> : <ShieldCheck className="size-5" aria-hidden="true" />}
          </span>
          <DialogPrimitive.Title className="mt-4 text-xl font-semibold tracking-tight">
            {step === "phone" ? "Verify your phone number" : "Enter the verification code"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description id="post-signup-phone-description" className="mt-2 text-sm leading-6 text-muted-foreground">
            {step === "phone"
              ? "Your email is confirmed. We'll send a 6-digit code to this number on WhatsApp to finish setting up your account."
              : <>We sent a 6-digit code to <span className="font-medium text-foreground">+{sentTo}</span> on WhatsApp. It expires in 10 minutes.</>}
          </DialogPrimitive.Description>

          {step === "phone" ? (
            <form className="mt-5 space-y-4" onSubmit={submitPhone}>
              <div className="space-y-2">
                <Label htmlFor="post-signup-phone">WhatsApp number</Label>
                <Input id="post-signup-phone" required autoFocus value={phone} onChange={(event) => { setPhone(event.target.value); setError("") }} type="tel" autoComplete="tel" placeholder="+91 98765 43210" />
                <p className="text-xs text-muted-foreground">Include your country code. A 10-digit Indian mobile number gets +91 automatically.</p>
              </div>
              {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
              <Button className="w-full" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="animate-spin" />Sending code…</> : "Send code on WhatsApp"}</Button>
            </form>
          ) : (
            <form className="mt-5 space-y-4" onSubmit={submitCode}>
              <div className="space-y-2">
                <Label htmlFor="post-signup-code">Verification code</Label>
                <Input
                  id="post-signup-code"
                  required
                  autoFocus
                  value={code}
                  onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError("") }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  className="text-center font-mono text-lg tracking-[0.5em]"
                />
              </div>
              {notice && !error ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
              {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
              <Button className="w-full" type="submit" disabled={busy || code.length !== 6}>{busy ? <><LoaderCircle className="animate-spin" />Verifying…</> : "Verify and continue"}</Button>
              <div className="flex items-center justify-between text-sm">
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setStep("phone"); setError(""); setNotice("") }}><ArrowLeft />Change number</Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy || resendIn > 0} onClick={() => void requestCode(sentTo)}>
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                </Button>
              </div>
            </form>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
