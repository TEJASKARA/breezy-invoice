import { useEffect, useState } from "react"
import { Phone } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import type { User } from "@supabase/supabase-js"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { customerErrorMessage } from "@/lib/customer-errors"
import { supabase } from "@/lib/supabase"

function normalisePhone(phone: string) {
  return phone.trim().replace(/[()\s-]/g, "")
}

type PostSignupPhoneDialogProps = {
  user: User | null
  onPendingChange: (pending: boolean) => void
}

export function PostSignupPhoneDialog({ user, onPendingChange }: PostSignupPhoneDialogProps) {
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [phone, setPhone] = useState("")
  const [error, setError] = useState("")

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
        supabase.from("profiles").select("phone").eq("id", user.id).maybeSingle(),
      ])

      if (!active) return
      setChecking(false)
      if (eligibilityResult.error || profileResult.error) {
        console.error("Unable to check post-signup phone status", eligibilityResult.error || profileResult.error)
        onPendingChange(false)
        return
      }

      const pending = Boolean(eligibilityResult.data) && !profileResult.data?.phone
      setOpen(pending)
      onPendingChange(pending)
    }

    void checkPhoneRequirement()
    return () => { active = false }
  }, [user, onPendingChange])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const cleanedPhone = normalisePhone(phone)
    if (!/^\+?[1-9]\d{7,14}$/.test(cleanedPhone)) {
      setError("Enter a valid phone number with country code, for example +919876543210.")
      return
    }
    if (!supabase) {
      setError("Phone collection is temporarily unavailable. Please try again shortly.")
      return
    }

    setSaving(true)
    setError("")
    const { error: updateError } = await supabase.auth.updateUser({ data: { phone: cleanedPhone } })
    setSaving(false)
    if (updateError) {
      setError(customerErrorMessage(updateError))
      return
    }
    setOpen(false)
    onPendingChange(false)
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
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Phone className="size-5" aria-hidden="true" /></span>
          <DialogPrimitive.Title className="mt-4 text-xl font-semibold tracking-tight">Add your phone number</DialogPrimitive.Title>
          <DialogPrimitive.Description id="post-signup-phone-description" className="mt-2 text-sm leading-6 text-muted-foreground">
            Your email is confirmed. Add a phone number to complete account setup before creating your workspace.
          </DialogPrimitive.Description>

          <form className="mt-5 space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="post-signup-phone">Phone number</Label>
              <Input id="post-signup-phone" required autoFocus value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" autoComplete="tel" placeholder="+91 98765 43210" />
              <p className="text-xs text-muted-foreground">Include your country code. Phone verification will be added later.</p>
            </div>
            {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" type="submit" disabled={saving}>{saving ? "Saving…" : "Continue to workspace setup"}</Button>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
