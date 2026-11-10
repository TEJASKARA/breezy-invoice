import { customerErrorMessage } from "@/lib/customer-errors"
import { ArrowLeft, ArrowRight, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { pendingCaInvitation } from "@/lib/ca-invitation-session"
import { supabase } from "@/lib/supabase"
import { normalizeWhatsAppNumber } from "@/lib/whatsapp-number"

type Step = "identify" | "email" | "phone-code" | "recovery"

const formatPhone = (digits: string) => digits.startsWith("91") && digits.length === 12
  ? `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  : `+${digits}`

/** One page for sign-in and sign-up, with email (password) or phone (WhatsApp code). */
export function LoginPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>("identify")
  const [identifier, setIdentifier] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [code, setCode] = useState("")
  const [isSignUp, setIsSignUp] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [message, setMessage] = useState("")
  const [messageIsError, setMessageIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  // Straight into the workspace: it opens setup automatically for new accounts.
  const destination = () => pendingCaInvitation() ? "/ca-invite" : "/workspace"

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setStep("recovery")
        setMessageIsError(false)
        setMessage("Enter a new password for your account.")
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  function show(text: string, isError = false) {
    setMessage(text)
    setMessageIsError(isError)
  }

  function back() {
    setStep("identify")
    setPassword("")
    setConfirmPassword("")
    setCode("")
    setIsSignUp(false)
    show("")
  }

  async function sendPhoneCode(digits: string) {
    if (!supabase) return show("Sign-in is temporarily unavailable. Please try again later.", true)
    setBusy(true)
    show("")
    // Creates the account on first use, so this is sign-up and sign-in in one.
    const { error } = await supabase.auth.signInWithOtp({ phone: `+${digits}` })
    setBusy(false)
    if (error) return show(customerErrorMessage(error, "We couldn't send the code. Please try again."), true)
    setPhone(digits)
    setCode("")
    setResendIn(30)
    setStep("phone-code")
    show(`We sent a 6-digit code to ${formatPhone(digits)} on WhatsApp.`)
  }

  async function continueWithIdentifier(event: React.FormEvent) {
    event.preventDefault()
    const value = identifier.trim()
    if (!value) return show("Enter your email address or phone number.", true)
    if (value.includes("@")) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return show("Enter a valid email address.", true)
      setEmail(value.toLowerCase())
      setStep("email")
      show("")
      return
    }
    const digits = normalizeWhatsAppNumber(value)
    if (!digits) return show("Enter a valid mobile number, for example 98765 43210, or an email address.", true)
    await sendPhoneCode(digits)
  }

  async function verifyPhoneCode(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return show("Sign-in is temporarily unavailable. Please try again later.", true)
    if (!/^\d{6}$/.test(code)) return show("Enter the 6-digit code from WhatsApp.", true)
    setBusy(true)
    show("")
    const { error } = await supabase.auth.verifyOtp({ phone: `+${phone}`, token: code, type: "sms" })
    setBusy(false)
    if (error) return show(customerErrorMessage(error, "That code is incorrect or has expired. Request a new code."), true)
    navigate(destination())
  }

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return show("Sign-in is temporarily unavailable. Please try again later.", true)
    if (password.length < 6) return show("Your password must contain at least 6 characters.", true)
    setBusy(true)
    show("")
    const result = isSignUp
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${destination()}` } })
      : await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (result.error) return show(customerErrorMessage(result.error), true)
    if (isSignUp && !result.data.session) return show("Check your email to confirm your account, then sign in.")
    navigate(destination())
  }

  async function updateRecoveredPassword(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return show("Your account connection is temporarily unavailable. Please try again later.", true)
    if (password.length < 6) return show("Your new password must contain at least 6 characters.", true)
    if (password !== confirmPassword) return show("The passwords do not match.", true)
    setBusy(true)
    show("")
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return show(customerErrorMessage(error), true)
    setPassword("")
    setConfirmPassword("")
    setStep("identify")
    show("Password updated. You can now sign in with your new password.")
  }

  async function resetPassword() {
    if (!supabase) return show("Your account connection is temporarily unavailable. Please try again later.", true)
    setBusy(true)
    show("")
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` })
    setBusy(false)
    show(error ? customerErrorMessage(error) : "Password reset instructions were sent to your email.", Boolean(error))
  }

  async function google() {
    if (!supabase) return show("Sign-in is temporarily unavailable. Please try again later.", true)
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}${destination()}` } })
    if (error) show(customerErrorMessage(error), true)
  }

  const heading = step === "recovery" ? "Choose a new password"
    : step === "email" ? (isSignUp ? "Create your account" : "Enter your password")
    : step === "phone-code" ? "Enter the WhatsApp code"
    : "Get started with your email or phone number"
  const subheading = step === "recovery" ? "Set a new password for your ChanaX account."
    : step === "identify" ? "Sign in or create your ChanaX account."
    : null

  return (
    <main className="public-light grid min-h-svh bg-white text-[#171717] lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-[#111111] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-10 page-grid" />
        <BrandMark tone="light" className="relative" />
        <div className="relative my-auto max-w-lg">
          <span className="mb-5 flex size-11 items-center justify-center rounded-xl bg-white/10">
            <Sparkles className="size-5" />
          </span>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Accounting work,
            <br />
            without the busywork.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-white/70">
            Generate invoices and payslips for every client entity, verify GST
            details, and prepare Tally-ready exports from one calm workspace.
          </p>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-white/60">
          <ShieldCheck className="size-4" />
          Built for CA practices and their teams
        </div>
      </section>

      <section className="flex items-center justify-center bg-white p-5 text-[#171717] sm:p-10">
        <div className="w-full max-w-md">
          <BrandMark tone="brand" className="mb-8 lg:hidden" />
          <Card>
            <CardHeader>
              {step === "email" || step === "phone-code" ? (
                <button type="button" onClick={back} disabled={busy} className="mb-2 inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="size-3.5" />Use a different email or number
                </button>
              ) : null}
              <CardTitle className="text-xl leading-snug">{heading}</CardTitle>
              {subheading ? <CardDescription>{subheading}</CardDescription> : null}
            </CardHeader>
            <CardContent className="space-y-5">
              {step === "identify" ? <>
                <form onSubmit={continueWithIdentifier} className="space-y-4" noValidate>
                  <div className="space-y-2">
                    <Label htmlFor="identifier" className="sr-only">Email address or phone number</Label>
                    <Input id="identifier" autoFocus value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Enter your email or phone number" autoComplete="username" inputMode="email" />
                  </div>
                  <Button className="w-full" disabled={busy}>
                    {busy ? <LoaderCircle className="animate-spin" /> : null}
                    {busy ? "Sending code…" : "Continue"}
                    {!busy ? <ArrowRight /> : null}
                  </Button>
                </form>
                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <Separator className="flex-1" />
                </div>
                <Button type="button" variant="outline" className="w-full" onClick={() => void google()} disabled={busy}>
                  <span className="text-base font-semibold text-blue-600">G</span>
                  Continue with Google
                </Button>
                <p className="text-xs text-muted-foreground">With a phone number, we send a code on WhatsApp. New numbers get a new account.</p>
              </> : null}

              {step === "email" ? (
                <form onSubmit={submitEmail} className="space-y-5">
                  <p className="rounded-lg bg-muted px-3 py-2 text-sm"><span className="text-muted-foreground">Email: </span><span className="font-medium">{email}</span></p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">{isSignUp ? "Create a password" : "Password"}</Label>
                      {!isSignUp ? <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" disabled={busy} onClick={() => void resetPassword()}>Forgot password?</Button> : null}
                    </div>
                    <Input id="password" autoFocus required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={isSignUp ? "new-password" : "current-password"} />
                  </div>
                  <Button className="w-full" disabled={busy}>
                    {busy ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
                    <ArrowRight />
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={() => { setIsSignUp((value) => !value); show("") }}>
                    {isSignUp ? "Already have an account? Sign in" : "New to ChanaX? Create an account"}
                  </Button>
                </form>
              ) : null}

              {step === "phone-code" ? (
                <form onSubmit={verifyPhoneCode} className="space-y-5">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="phone-code">6-digit code</Label>
                      <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" disabled={busy || resendIn > 0} onClick={() => void sendPhoneCode(phone)}>
                        {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                      </Button>
                    </div>
                    <Input id="phone-code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" className="font-mono tracking-[0.3em]" />
                  </div>
                  <Button className="w-full" disabled={busy}>
                    {busy ? <LoaderCircle className="animate-spin" /> : null}
                    {busy ? "Checking…" : "Continue"}
                    {!busy ? <ArrowRight /> : null}
                  </Button>
                </form>
              ) : null}

              {step === "recovery" ? (
                <form onSubmit={updateRecoveredPassword} className="space-y-5">
                  <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" /></div>
                  <div className="space-y-2"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" required minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" /></div>
                  <Button className="w-full" disabled={busy}>{busy ? "Please wait…" : "Update password"}<ArrowRight /></Button>
                </form>
              ) : null}

              {message ? <p role={messageIsError ? "alert" : "status"} className={messageIsError ? "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" : "rounded-lg bg-muted p-3 text-sm text-muted-foreground"}>{message}</p> : null}
            </CardContent>
          </Card>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            By continuing, you agree to the <Link to="/terms" className="underline underline-offset-4 hover:text-foreground">Terms &amp; Conditions</Link> and <Link to="/privacy" className="underline underline-offset-4 hover:text-foreground">Privacy Policy</Link>.
          </p>
        </div>
      </section>
    </main>
  )
}
