import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, CheckCircle2, KeyRound, LoaderCircle, Mail, Phone, UserRound } from "lucide-react"
import { useNavigate } from "react-router-dom"
import type { User } from "@supabase/supabase-js"

import { BrandMark } from "@/components/brand-mark"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { customerErrorMessage } from "@/lib/customer-errors"
import { sendPhoneCode, verifyPhoneCode } from "@/lib/phone-verification-api"
import { supabase } from "@/lib/supabase"
import { normalizeWhatsAppNumber } from "@/lib/whatsapp-number"

type ProfileRow = { full_name: string | null; phone: string | null; phone_verified_at: string | null }
type Notice = { text: string; error?: boolean } | null

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null
  return <p role={notice.error ? "alert" : "status"} className={notice.error ? "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" : "rounded-lg bg-muted p-3 text-sm text-muted-foreground"}>{notice.text}</p>
}

function Missing({ label }: { label: string }) {
  return <Badge variant="secondary" className="text-amber-800 dark:text-amber-300">{label}</Badge>
}

/** The person's own account details. Separate from workspace settings and entities. */
export function ProfilePage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)

  const [fullName, setFullName] = useState("")
  const [nameBusy, setNameBusy] = useState(false)
  const [nameNotice, setNameNotice] = useState<Notice>(null)

  const [newEmail, setNewEmail] = useState("")
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailNotice, setEmailNotice] = useState<Notice>(null)

  const [newPhone, setNewPhone] = useState("")
  const [phoneDigits, setPhoneDigits] = useState("")
  const [phoneCode, setPhoneCode] = useState("")
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [phoneNotice, setPhoneNotice] = useState<Notice>(null)

  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null)

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return }
    const { data } = await supabase.auth.getUser()
    setUser(data.user)
    if (data.user) {
      const { data: row } = await supabase.from("profiles").select("full_name, phone, phone_verified_at").eq("id", data.user.id).maybeSingle()
      const loaded = (row as ProfileRow | null) ?? null
      setProfile(loaded)
      setFullName(String(loaded?.full_name || data.user.user_metadata.full_name || ""))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const verifiedPhone = profile?.phone_verified_at ? profile.phone : null
  const email = user?.email || ""
  const pendingEmail = (user as (User & { new_email?: string }) | null)?.new_email || ""
  const hasPassword = Boolean(user?.identities?.some((identity) => identity.provider === "email") || user?.user_metadata.password_set)

  async function saveName(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const name = fullName.trim()
    if (name.length < 2) return setNameNotice({ text: "Enter your full name.", error: true })
    setNameBusy(true)
    setNameNotice(null)
    const { error } = await supabase.auth.updateUser({ data: { full_name: name } })
    setNameBusy(false)
    setNameNotice(error ? { text: customerErrorMessage(error), error: true } : { text: "Name updated." })
    if (!error) void load()
  }

  async function changeEmail(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const value = newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return setEmailNotice({ text: "Enter a valid email address.", error: true })
    if (value === email.toLowerCase()) return setEmailNotice({ text: "That is already your email address.", error: true })
    setEmailBusy(true)
    setEmailNotice(null)
    const { error } = await supabase.auth.updateUser({ email: value }, { emailRedirectTo: `${window.location.origin}/profile` })
    setEmailBusy(false)
    if (error) return setEmailNotice({ text: customerErrorMessage(error), error: true })
    setNewEmail("")
    setEmailNotice({ text: email
      ? `We sent confirmation links to ${email} and ${value}. Your email changes after you confirm.`
      : `We sent a confirmation link to ${value}. Open it to add this email to your account.` })
    void load()
  }

  async function sendCode(event: React.FormEvent) {
    event.preventDefault()
    const digits = normalizeWhatsAppNumber(newPhone)
    if (!digits) return setPhoneNotice({ text: "Enter a valid mobile number with its country code, for example +91 98765 43210.", error: true })
    setPhoneBusy(true)
    setPhoneNotice(null)
    try {
      const result = await sendPhoneCode(digits)
      setPhoneDigits(digits)
      setPhoneCode("")
      setPhoneNotice({ text: result.message })
    } catch (error) {
      setPhoneNotice({ text: error instanceof Error ? error.message : "We couldn't send the code.", error: true })
    } finally {
      setPhoneBusy(false)
    }
  }

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault()
    if (!/^\d{6}$/.test(phoneCode)) return setPhoneNotice({ text: "Enter the 6-digit code from WhatsApp.", error: true })
    setPhoneBusy(true)
    setPhoneNotice(null)
    try {
      const result = await verifyPhoneCode(phoneDigits, phoneCode)
      setPhoneDigits("")
      setNewPhone("")
      setPhoneCode("")
      setPhoneNotice({ text: `${result.phone} is verified. You can now sign in with it.` })
      await supabase?.auth.refreshSession()
      void load()
    } catch (error) {
      setPhoneNotice({ text: error instanceof Error ? error.message : "That code could not be verified.", error: true })
    } finally {
      setPhoneBusy(false)
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    if (password.length < 6) return setPasswordNotice({ text: "Your password must contain at least 6 characters.", error: true })
    if (password !== confirmPassword) return setPasswordNotice({ text: "The passwords do not match.", error: true })
    setPasswordBusy(true)
    setPasswordNotice(null)
    const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } })
    setPasswordBusy(false)
    if (error) return setPasswordNotice({ text: customerErrorMessage(error), error: true })
    setPassword("")
    setConfirmPassword("")
    setPasswordNotice({ text: email ? `Password saved. You can sign in with ${email} and this password.` : "Password saved. Add an email above to sign in with it." })
    void load()
  }

  if (loading) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading your profile…</div>

  return <main className="min-h-svh bg-muted/30">
    <header className="border-b bg-background">
      <div className="mx-auto flex min-h-16 max-w-3xl items-center gap-3 px-5">
        <BrandMark />
        <Button variant="ghost" className="ml-auto" onClick={() => window.history.length > 1 ? navigate(-1) : navigate("/workspace")}><ArrowLeft />Back</Button>
      </div>
    </header>
    <div className="mx-auto max-w-3xl space-y-5 p-5 sm:p-8">
      <div>
        <p className="text-sm font-medium text-primary">Your account</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your personal sign-in details. Business details live in Workspace settings and your entities.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="size-4" />Name</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={saveName} className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Label htmlFor="profile-name" className="sr-only">Full name</Label>
              <Input id="profile-name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" autoComplete="name" />
              <Button disabled={nameBusy}>{nameBusy ? <LoaderCircle className="animate-spin" /> : null}Save</Button>
            </div>
            <NoticeLine notice={nameNotice} />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="size-4" />Email{!email ? <Missing label="Not added" /> : null}</CardTitle>
          <CardDescription>{email ? <>Signed in as <span className="font-medium text-foreground">{email}</span></> : "Add an email to receive invoices, receipts and account notices, and to sign in with a password."}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changeEmail} className="space-y-3">
            {pendingEmail ? <p className="text-sm text-muted-foreground">Waiting for you to confirm <span className="font-medium text-foreground">{pendingEmail}</span>.</p> : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Label htmlFor="profile-email" className="sr-only">{email ? "New email" : "Email"}</Label>
              <Input id="profile-email" type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder={email ? "New email address" : "you@company.com"} autoComplete="email" />
              <Button disabled={emailBusy}>{emailBusy ? <LoaderCircle className="animate-spin" /> : null}{email ? "Change email" : "Add email"}</Button>
            </div>
            <NoticeLine notice={emailNotice} />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Phone className="size-4" />Phone{verifiedPhone ? <Badge variant="outline" className="gap-1"><CheckCircle2 className="size-3" />Verified</Badge> : <Missing label="Not added" />}</CardTitle>
          <CardDescription>{verifiedPhone ? <>You can sign in with <span className="font-medium text-foreground">{verifiedPhone}</span>. We send codes on WhatsApp.</> : "Add your mobile number to sign in with a WhatsApp code."}</CardDescription>
        </CardHeader>
        <CardContent>
          {phoneDigits ? (
            <form onSubmit={confirmCode} className="space-y-3">
              <Label htmlFor="profile-phone-code">Code sent to +{phoneDigits}</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="profile-phone-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" className="font-mono tracking-[0.3em]" />
                <Button disabled={phoneBusy}>{phoneBusy ? <LoaderCircle className="animate-spin" /> : null}Verify</Button>
                <Button type="button" variant="ghost" disabled={phoneBusy} onClick={() => { setPhoneDigits(""); setPhoneCode(""); setPhoneNotice(null) }}>Cancel</Button>
              </div>
              <NoticeLine notice={phoneNotice} />
            </form>
          ) : (
            <form onSubmit={sendCode} className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Label htmlFor="profile-phone" className="sr-only">{verifiedPhone ? "New mobile number" : "Mobile number"}</Label>
                <Input id="profile-phone" type="tel" inputMode="tel" autoComplete="tel" value={newPhone} onChange={(event) => setNewPhone(event.target.value)} placeholder="+91 98765 43210" />
                <Button disabled={phoneBusy}>{phoneBusy ? <LoaderCircle className="animate-spin" /> : null}{verifiedPhone ? "Change number" : "Add number"}</Button>
              </div>
              <NoticeLine notice={phoneNotice} />
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" />Password{!hasPassword ? <Missing label="Not set" /> : null}</CardTitle>
          <CardDescription>{hasPassword ? "Change the password you use with your email." : "Set a password to also sign in with your email."}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePassword} className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input type="password" aria-label="New password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" autoComplete="new-password" />
              <Input type="password" aria-label="Confirm new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm password" autoComplete="new-password" />
              <Button disabled={passwordBusy}>{passwordBusy ? <LoaderCircle className="animate-spin" /> : null}{hasPassword ? "Change" : "Set password"}</Button>
            </div>
            <NoticeLine notice={passwordNotice} />
          </form>
        </CardContent>
      </Card>
    </div>
  </main>
}
