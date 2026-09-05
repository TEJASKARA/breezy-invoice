import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import { Coins, Mail, Search, ShieldCheck } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  findPlatformWorkspaces,
  grantPlatformCredits,
  loadPlatformAdminAccess,
  type PlatformWorkspace,
} from "@/lib/platform-admin-api"

export function PlatformAdminPage() {
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading")
  const [subscriberQuery, setSubscriberQuery] = useState("")
  const [searchResults, setSearchResults] = useState<PlatformWorkspace[]>([])
  const [workspace, setWorkspace] = useState<PlatformWorkspace | null>(null)
  const [creditAmount, setCreditAmount] = useState("")
  const [reason, setReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    let active = true
    void loadPlatformAdminAccess()
      .then((allowed) => { if (active) setAccess(allowed ? "allowed" : "denied") })
      .catch(() => { if (active) setAccess("denied") })
    return () => { active = false }
  }, [])

  async function findWorkspace() {
    if (!subscriberQuery.trim()) return
    setSearching(true)
    setError("")
    setSuccess("")
    setWorkspace(null)
    setSearchResults([])
    setConfirmed(false)
    try {
      const results = await findPlatformWorkspaces(subscriberQuery)
      setSearchResults(results)
      if (results.length === 1) setWorkspace(results[0])
      if (results.length === 0) setError("No workspace matches that email address or subscription code.")
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "The workspace could not be found.")
    } finally {
      setSearching(false)
    }
  }

  async function grantCredits() {
    const amount = Number(creditAmount)
    if (!workspace || !Number.isInteger(amount) || amount < 1 || !confirmed) return
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const result = await grantPlatformCredits(workspace.subscription_code, amount, reason)
      setSuccess(`${result.credits_added} document credits and ${result.quotation_credits_added} quotation credits were granted to ${workspace.name}.`)
      const refreshed = await findPlatformWorkspaces(workspace.subscription_code)
      setWorkspace(refreshed[0] || null)
      setSearchResults(refreshed)
      setCreditAmount("")
      setReason("")
      setConfirmed(false)
    } catch (grantError) {
      setError(grantError instanceof Error ? grantError.message : "The credits could not be granted.")
    } finally {
      setSaving(false)
    }
  }

  if (access === "loading") {
    return <div className="grid min-h-72 place-items-center text-sm text-muted-foreground">Checking platform-administrator access…</div>
  }
  if (access === "denied") return <Navigate to="/workspace" replace />

  const amount = Number(creditAmount)
  const canGrant = Boolean(
    workspace
    && Number.isInteger(amount)
    && amount >= 1
    && amount <= 100000
    && reason.trim().length >= 3
    && confirmed,
  )

  return <div className="space-y-6">
    <PageHeader
      eyebrow="Private platform controls"
      title="ChanaX administration"
      description="Find a subscriber by email address or subscription code and make an audited special-credit allocation. This area is restricted to approved platform administrators."
    />

    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}
    {success ? <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">{success}</div> : null}

    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Search className="size-4" />Find subscriber</CardTitle>
        <CardDescription>Enter the subscriber's email address or their subscription code.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void findWorkspace() }}>
          <div className="flex-1 space-y-2">
            <Label htmlFor="admin-subscriber-query">Email or subscription code</Label>
            <Input
              id="admin-subscriber-query"
              autoComplete="off"
              value={subscriberQuery}
              onChange={(event) => setSubscriberQuery(event.target.value)}
              placeholder="customer@company.com or subscription code"
            />
          </div>
          <Button className="self-end" disabled={searching || !subscriberQuery.trim()} type="submit">
            {searching ? "Searching…" : "Find workspace"}
          </Button>
        </form>
      </CardContent>
    </Card>

    {searchResults.length > 1 && !workspace ? <Card>
      <CardHeader>
        <CardTitle>Select a workspace</CardTitle>
        <CardDescription>This email has access to more than one workspace. Select the intended subscriber before granting credits.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {searchResults.map((result) => <button key={result.workspace_id} type="button" className="rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setWorkspace(result); setConfirmed(false) }}><span className="font-semibold">{result.name}</span><span className="mt-1 block font-mono text-xs text-muted-foreground">{result.subscription_code}</span>{result.matched_email ? <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="size-3.5" />{result.matched_email}</span> : null}</button>)}
      </CardContent>
    </Card> : null}

    {workspace ? <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{workspace.name}</CardTitle>
            <CardDescription className="mt-1 font-mono">{workspace.subscription_code}</CardDescription>
            {workspace.matched_email ? <CardDescription className="mt-1 flex items-center gap-1.5"><Mail className="size-3.5" />{workspace.matched_email}</CardDescription> : null}
          </div>
          <Badge variant={workspace.status === "active" ? "secondary" : "destructive"} className="capitalize">{workspace.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Coins className="size-4" />Document credits</div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{workspace.document_credits_remaining}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="size-4" />Quotation credits</div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{workspace.quotation_credits_remaining}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="admin-credit-amount">Credits to grant</Label>
            <Input id="admin-credit-amount" min="1" max="100000" step="1" type="number" value={creditAmount} onChange={(event) => { setCreditAmount(event.target.value); setConfirmed(false) }} placeholder="For example, 100" />
            <p className="text-xs text-muted-foreground">The same amount is added to document and quotation balances.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-credit-reason">Internal reason</Label>
            <textarea id="admin-credit-reason" value={reason} onChange={(event) => { setReason(event.target.value); setConfirmed(false) }} maxLength={500} className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30" placeholder="Why are these credits being granted?" />
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900/70 dark:bg-amber-950/30">
          <input className="mt-0.5 size-4" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>I confirm this allocation is for <strong>{workspace.name}</strong>. Credit grants are recorded in the audit log and are not automatically reversible.</span>
        </label>

        <Button disabled={!canGrant || saving} onClick={() => void grantCredits()}>
          {saving ? "Granting credits…" : `Grant ${Number.isInteger(amount) && amount > 0 ? amount : 0} + ${Number.isInteger(amount) && amount > 0 ? amount : 0} credits`}
        </Button>
      </CardContent>
    </Card> : null}
  </div>
}
