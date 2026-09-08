import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { supabase } from "@/lib/supabase"

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isSignUp, setIsSignUp] = useState(false)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [message, setMessage] = useState("")
  const [messageIsError, setMessageIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true)
        setMessageIsError(false)
        setMessage("Enter a new password for your account.")
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!supabase) { setMessageIsError(true); setMessage("Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to frontend/.env first."); return }
    if (isPasswordRecovery) {
      if (password.length < 6) { setMessageIsError(true); setMessage("Your new password must contain at least 6 characters."); return }
      if (password !== confirmPassword) { setMessageIsError(true); setMessage("The passwords do not match."); return }
      setBusy(true); setMessage("")
      const { error } = await supabase.auth.updateUser({ password })
      setBusy(false)
      setMessageIsError(Boolean(error))
      if (error) setMessage(error.message)
      else { setMessage("Password updated. You can now use your new password."); setIsPasswordRecovery(false); setConfirmPassword("") }
      return
    }
    setBusy(true); setMessage("")
    const result = isSignUp ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    setMessageIsError(Boolean(result.error))
    if (result.error) setMessage(result.error.message)
    else if (isSignUp && !result.data.session) setMessage("Check your email to confirm your account, then sign in.")
    else navigate("/")
  }
  async function resetPassword() {
    if (!supabase) { setMessageIsError(true); setMessage("Supabase is not configured."); return }
    if (!email.trim()) { setMessageIsError(true); setMessage("Enter your email address first."); return }
    setBusy(true); setMessage("")
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/login` })
    setBusy(false)
    setMessageIsError(Boolean(error))
    setMessage(error ? error.message : "Password reset instructions were sent to your email.")
  }
  async function google() { if (!supabase) { setMessageIsError(true); setMessage("Add Supabase keys to frontend/.env first."); return }; const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/` } }); if (error) { setMessageIsError(true); setMessage(error.message) } }
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
              <CardTitle className="text-xl">Welcome back</CardTitle>
              <CardDescription>Sign in to your ChanaX workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!isPasswordRecovery ? <Button type="button" variant="outline" className="w-full" onClick={google} disabled={busy}>
                <span className="text-base font-semibold text-blue-600">G</span>
                Continue with Google
              </Button> : null}
              {!isPasswordRecovery ? <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or continue with email</span>
                <Separator className="flex-1" />
              </div> : null}
              <form onSubmit={submit} className="space-y-5">
              {isPasswordRecovery ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Choose a new password for your ChanaX account.</p> : null}
              {!isPasswordRecovery ? (
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input id="email" required value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@cafirm.com" autoComplete="email" />
              </div>
              ) : null}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {!isSignUp && !isPasswordRecovery ? <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" disabled={busy} onClick={() => void resetPassword()}>
                    Forgot password?
                  </Button> : null}
                </div>
                <Input id="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={isSignUp || isPasswordRecovery ? "new-password" : "current-password"} />
              </div>
              {isPasswordRecovery ? <div className="space-y-2"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" required minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" /></div> : null}
              <Button className="w-full" disabled={busy}>
                {busy ? "Please wait…" : isPasswordRecovery ? "Update password" : isSignUp ? "Create account" : "Sign in"}
                <ArrowRight />
              </Button>
              {!isPasswordRecovery ? <Button type="button" variant="ghost" className="w-full" onClick={() => { setIsSignUp((value) => !value); setMessage(""); setMessageIsError(false) }}>{isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}</Button> : null}
              {message && <p role={messageIsError ? "alert" : "status"} className={messageIsError ? "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" : "rounded-lg bg-muted p-3 text-sm text-muted-foreground"}>{message}</p>}
              </form>
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
