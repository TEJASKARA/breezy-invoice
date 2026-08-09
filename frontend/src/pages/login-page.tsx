import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"

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
  const [isSignUp, setIsSignUp] = useState(false)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!supabase) { setMessage("Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to frontend/.env first."); return }
    setBusy(true); setMessage("")
    const result = isSignUp ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (result.error) setMessage(result.error.message)
    else if (isSignUp && !result.data.session) setMessage("Check your email to confirm your account, then sign in.")
    else navigate("/setup")
  }
  async function google() { if (!supabase) { setMessage("Add Supabase keys to frontend/.env first."); return }; const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/setup` } }); if (error) setMessage(error.message) }
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-10 page-grid" />
        <BrandMark className="relative [&>span:first-child]:bg-primary-foreground [&>span:first-child]:text-primary" />
        <div className="relative my-auto max-w-lg">
          <span className="mb-5 flex size-11 items-center justify-center rounded-xl bg-primary-foreground/10">
            <Sparkles className="size-5" />
          </span>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Accounting work,
            <br />
            without the busywork.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-primary-foreground/70">
            Generate invoices and payslips for every client entity, verify GST
            details, and prepare Tally-ready exports from one calm workspace.
          </p>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-primary-foreground/60">
          <ShieldCheck className="size-4" />
          Built for CA practices and their teams
        </div>
      </section>

      <section className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-md">
          <BrandMark className="mb-8 lg:hidden" />
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Welcome back</CardTitle>
              <CardDescription>Sign in to your BreezyInvoice workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Button type="button" variant="outline" className="w-full" onClick={google}>
                <span className="text-base font-semibold text-blue-600">G</span>
                Continue with Google
              </Button>
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or continue with email</span>
                <Separator className="flex-1" />
              </div>
              <form onSubmit={submit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input id="email" required value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@cafirm.com" autoComplete="email" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Button variant="link" size="sm" className="h-auto px-0 text-xs">
                    Forgot password?
                  </Button>
                </div>
                <Input id="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={isSignUp ? "new-password" : "current-password"} />
              </div>
              <Button className="w-full" disabled={busy}>
                {busy ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
                <ArrowRight />
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => { setIsSignUp((value) => !value); setMessage("") }}>{isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}</Button>
              {message && <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{message}</p>}
              </form>
            </CardContent>
          </Card>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            By continuing, you agree to the Terms of Service and Privacy Policy.
          </p>
        </div>
      </section>
    </main>
  )
}
