import { useEffect, useState } from "react"
import { Sparkles } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import type { User } from "@supabase/supabase-js"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { customerErrorMessage } from "@/lib/customer-errors"
import { supabase } from "@/lib/supabase"

const discoverySources = [
  ["google_search", "Google search"],
  ["social_media", "Social media"],
  ["friend_or_colleague", "Friend or colleague"],
  ["accountant_or_ca", "Accountant / CA"],
  ["advertisement", "Advertisement"],
  ["other", "Other"],
] as const

const intendedUseOptions = [
  ["invoices_and_quotations", "Invoices & quotations"],
  ["payroll_and_payslips", "Payroll & payslips"],
  ["expenses_and_attendance", "Expenses & attendance"],
  ["multiple_business_entities", "Multiple entities"],
  ["everything", "Everything"],
] as const

const businessTypes = [
  ["freelancer_or_consultant", "Freelancer / consultant"],
  ["small_business", "Small business"],
  ["company", "Company"],
  ["accountant_or_ca_firm", "Accountant / CA firm"],
  ["other", "Other"],
] as const

const teamSizes = [
  ["just_me", "Just me"],
  ["2_5", "2–5 people"],
  ["6_20", "6–20 people"],
  ["21_50", "21–50 people"],
  ["more_than_50", "More than 50 people"],
] as const

function normalisePhone(phone: string) {
  return phone.trim().replace(/[()\s-]/g, "")
}

type SignupSurveyDialogProps = {
  user: User | null
  onPendingChange: (pending: boolean) => void
}

export function SignupSurveyDialog({ user, onPendingChange }: SignupSurveyDialogProps) {
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [discoverySource, setDiscoverySource] = useState("")
  const [phone, setPhone] = useState("")
  const [intendedUses, setIntendedUses] = useState<string[]>([])
  const [businessType, setBusinessType] = useState("")
  const [teamSize, setTeamSize] = useState("")

  useEffect(() => {
    let active = true

    async function checkForResponse() {
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
      const { data: eligibility, error: eligibilityError } = await supabase
        .from("chanax_signup_survey_eligible_users")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle()

      if (!active) return
      if (eligibilityError || !eligibility) {
        if (eligibilityError) console.error("Unable to check signup survey eligibility", eligibilityError)
        setChecking(false)
        onPendingChange(false)
        return
      }

      const { data, error: responseError } = await supabase
        .from("chanax_signup_survey_responses")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle()

      if (!active) return
      setChecking(false)
      if (responseError) {
        console.error("Unable to check signup survey status", responseError)
        onPendingChange(false)
        return
      }
      const pending = !data
      setOpen(pending)
      onPendingChange(pending)
    }

    void checkForResponse()
    return () => { active = false }
  }, [user, onPendingChange])

  function toggleIntendedUse(value: string) {
    setIntendedUses((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value])
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const cleanedPhone = normalisePhone(phone)
    if (!discoverySource || !businessType || intendedUses.length === 0) {
      setError("Please answer the required questions to continue.")
      return
    }
    if (cleanedPhone && !/^\+?[1-9]\d{7,14}$/.test(cleanedPhone)) {
      setError("Enter a valid phone number with country code, for example +919876543210.")
      return
    }
    if (!supabase) {
      setError("The survey is temporarily unavailable. Please try again shortly.")
      return
    }

    setSaving(true)
    setError("")
    const { error: submitError } = await supabase.rpc("chanax_submit_signup_survey", {
      p_discovery_source: discoverySource,
      p_phone: cleanedPhone || null,
      p_intended_uses: intendedUses,
      p_business_type: businessType,
      p_team_size: teamSize || null,
    })
    setSaving(false)
    if (submitError) {
      setError(customerErrorMessage(submitError))
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
          aria-describedby="signup-survey-description"
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-background p-5 shadow-2xl outline-none sm:p-7"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <div className="mb-5 flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <div>
              <DialogPrimitive.Title className="text-xl font-semibold tracking-tight">A few quick questions</DialogPrimitive.Title>
              <DialogPrimitive.Description id="signup-survey-description" className="mt-1 text-sm text-muted-foreground">
                Help us understand how to make ChanaX more useful for you. This is a one-time setup step.
              </DialogPrimitive.Description>
            </div>
          </div>

          <form className="space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="signup-survey-source">How did you hear about ChanaX? <span className="text-destructive">*</span></Label>
              <select id="signup-survey-source" required value={discoverySource} onChange={(event) => setDiscoverySource(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm">
                <option value="" disabled>Select an option</option>
                {discoverySources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-survey-phone">Phone number <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="signup-survey-phone" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">What do you plan to use ChanaX for? <span className="text-destructive">*</span></legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {intendedUseOptions.map(([value, label]) => (
                  <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50">
                    <input type="checkbox" checked={intendedUses.includes(value)} onChange={() => toggleIntendedUse(value)} className="size-4 accent-primary" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="signup-survey-business">Which best describes you? <span className="text-destructive">*</span></Label>
              <select id="signup-survey-business" required value={businessType} onChange={(event) => setBusinessType(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm">
                <option value="" disabled>Select an option</option>
                {businessTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-survey-team">Team size <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <select id="signup-survey-team" value={teamSize} onChange={(event) => setTeamSize(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm">
                <option value="">Prefer not to say</option>
                {teamSizes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>

            {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end border-t pt-4">
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Continue to ChanaX"}</Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
