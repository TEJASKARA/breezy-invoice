import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, LoaderCircle, Phone, Search, TriangleAlert, UserCog } from "lucide-react"

import { BusinessSetupForm } from "@/components/business-setup-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { customerErrorMessage } from "@/lib/customer-errors"
import { primaryCompanyFromSetup, type Setup } from "@/lib/mvp-store"
import { completeUserSetup, findSetupTarget, lookupSetupGstin, type CompleteSetupResult, type SetupTarget } from "@/lib/platform-admin-api"

const formatDate = (value: string | null) => value ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

function blockedReason(target: SetupTarget) {
  if (target.account_type === "ca") return "This user chose a CA account. CA accounts are set up from the CA portal, not here."
  if (target.account_type === "employee") return "This user chose an employee account. Employees join their company's workspace through an invitation."
  if (!target.workspace_id) return "This user does not own a workspace, so there is nothing to set up."
  if (target.workspace_status !== "active") return `This workspace is ${target.workspace_status}. Only active workspaces can be set up.`
  if (target.setup_completed) return "This account has already completed setup. Use the Credits tab if you want to add credits."
  return ""
}

/** Platform admin: complete onboarding for a user who agreed to it on a call. */
export function AdminUserSetup({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery)
  const [searching, setSearching] = useState(false)
  const [target, setTarget] = useState<SetupTarget | null>(null)
  const [error, setError] = useState("")
  const [consented, setConsented] = useState(false)
  const [notifyUser, setNotifyUser] = useState(true)
  const [result, setResult] = useState<CompleteSetupResult | null>(null)

  const search = useCallback(async (identifier: string) => {
    const trimmed = identifier.trim()
    if (trimmed.length < 3) {
      setError("Enter the user's email or subscription code.")
      return
    }
    setSearching(true)
    setError("")
    setTarget(null)
    setResult(null)
    setConsented(false)
    try {
      setTarget(await findSetupTarget(trimmed))
    } catch (caught) {
      setError(customerErrorMessage(caught, "The user could not be found."))
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (!initialQuery) return
    setQuery(initialQuery)
    void search(initialQuery)
  }, [initialQuery, search])

  async function submitSetup(setup: Setup) {
    if (!target?.workspace_id) throw new Error("Find the user first.")
    if (!consented) throw new Error("Confirm that the user agreed to this setup before saving.")
    const completed = await completeUserSetup({
      workspaceId: target.workspace_id,
      setup: { ...setup, accountType: "founder" },
      entity: primaryCompanyFromSetup({ ...setup, accountType: "founder" }),
      notifyUser,
    })
    setResult(completed)
    setTarget(await findSetupTarget(target.subscription_code || target.email || query))
  }

  const blocked = target ? blockedReason(target) : ""

  return <div className="space-y-5">
    <Card>
      <CardHeader>
        <CardTitle>Set up a user's account</CardTitle>
        <CardDescription>For users who signed up but did not finish setup. Find them by email or subscription code, confirm they agreed on the call, then fill in their business details.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void search(query) }}>
          <div className="flex-1 space-y-2">
            <Label htmlFor="setup-user-query" className="sr-only">Email or subscription code</Label>
            <Input id="setup-user-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="user@company.com or subscription code" autoComplete="off" />
          </div>
          <Button type="submit" disabled={searching}>{searching ? <LoaderCircle className="animate-spin" /> : <Search />}Find user</Button>
        </form>
        {error ? <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>

    {target ? <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="truncate">{target.full_name || target.email || "User"}</CardTitle>
          <CardDescription className="truncate">{target.email}</CardDescription>
        </div>
        <Badge variant={target.setup_completed ? "outline" : "secondary"}>{target.setup_completed ? "Setup complete" : "Setup pending"}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Phone</dt><dd className="mt-1 font-medium">{target.phone ? <a className="inline-flex items-center gap-1.5 hover:underline" href={`tel:${target.phone}`}><Phone className="size-3.5" />{target.phone}</a> : "Not provided"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Subscription code</dt><dd className="mt-1 font-mono font-medium">{target.subscription_code || "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Signed up</dt><dd className="mt-1 font-medium">{formatDate(target.signed_up_at)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Last sign-in</dt><dd className="mt-1 font-medium">{formatDate(target.last_sign_in_at)}</dd></div>
        </dl>
        {result ? <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{result.message}</p> : null}
        {blocked && !result ? <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{blocked}</p> : null}
        {!blocked ? <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span><span className="block text-sm font-medium">The user agreed on a call for ChanaX to set up their account</span><span className="block text-xs text-muted-foreground">Required. The setup is recorded against your admin account.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={notifyUser} onChange={(event) => setNotifyUser(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span><span className="block text-sm font-medium">Email the user when setup is done</span><span className="block text-xs text-muted-foreground">Sends "Your ChanaX account is ready" with a sign-in link to {target.email || "their email"}.</span></span>
          </label>
        </div> : null}
      </CardContent>
    </Card> : null}

    {target && !blocked && target.workspace_id ? <BusinessSetupForm
      key={target.workspace_id}
      accountType="founder"
      verifyGst={(gstin) => lookupSetupGstin(target.workspace_id as string, gstin)}
      onSubmit={submitSetup}
      title="Business details"
      description="Fill these in with the user on the call. GST details are fetched from WhiteBooks and the user receives the normal free credits for a verified GSTIN."
      submitLabel="Complete setup for this user"
      savingLabel="Setting up account…"
    /> : null}
    {!target ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><UserCog className="size-4" />Tip: open Usage analytics → Setup pending and click Set up next to a user.</p> : null}
  </div>
}
