import { useEffect, useState } from "react"
import { ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabase"

type Props = { onVerified: () => void }
type Enrolment = { factorId: string; qrCode: string; secret: string }

/**
 * Second sign-in step for platform administrators: an authenticator-app code.
 * Enrols an app on first use, then asks for the 6-digit code each session.
 */
export function AdminMfaGate({ onVerified }: Props) {
  const [factorId, setFactorId] = useState("")
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    async function prepare() {
      if (!supabase) { setError("Sign-in is temporarily unavailable. Please try again later."); setLoading(false); return }
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (!active) return
      if (listError) { setError("Could not check your authenticator app. Please try again."); setLoading(false); return }
      const verified = data.totp[0]
      if (verified) { setFactorId(verified.id); setLoading(false); return }
      // An abandoned, half-finished enrolment would block a new one, so clear it first.
      for (const stale of data.all.filter((factor) => factor.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id })
      }
      const { data: created, error: enrolError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "ChanaX admin" })
      if (!active) return
      if (enrolError || !created) { setError("Could not start authenticator setup. Please try again."); setLoading(false); return }
      setFactorId(created.id)
      setEnrolment({ factorId: created.id, qrCode: created.totp.qr_code, secret: created.totp.secret })
      setLoading(false)
    }
    void prepare()
    return () => { active = false }
  }, [])

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !factorId) return
    if (!/^\d{6}$/.test(code)) { setError("Enter the 6-digit code from your authenticator app."); return }
    setBusy(true)
    setError("")
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (verifyError) { setCode(""); setError("That code is incorrect or has expired. Try the latest code."); return }
    onVerified()
  }

  return <div className="mx-auto max-w-md py-10">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />Confirm it's you</CardTitle>
        <CardDescription>
          {enrolment
            ? "Platform administration needs an authenticator app. Scan the code below with Google Authenticator, Microsoft Authenticator or similar, then enter the 6-digit code."
            : "Enter the 6-digit code from your authenticator app to open platform administration."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-sm text-muted-foreground">Preparing…</p> : <form className="space-y-4" onSubmit={(event) => void verify(event)}>
          {enrolment ? <div className="space-y-2">
            <img src={enrolment.qrCode} alt="Authenticator app QR code" className="mx-auto size-44 rounded-lg border bg-white p-2" />
            <p className="text-center text-xs text-muted-foreground">Can't scan? Enter this key in your app: <span className="select-all font-mono">{enrolment.secret}</span></p>
          </div> : null}
          <div className="space-y-2">
            <Label htmlFor="admin-mfa-code">6-digit code</Label>
            <Input id="admin-mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="123456" />
          </div>
          {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy || !factorId}>{busy ? "Checking…" : enrolment ? "Turn on and continue" : "Continue"}</Button>
        </form>}
        {!loading && !factorId && error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  </div>
}
