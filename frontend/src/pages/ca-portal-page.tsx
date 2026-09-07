import { useCallback, useEffect, useState } from "react"
import { Building2, CheckCircle2, Clock3, LogOut, Plus, Send, XCircle } from "lucide-react"
import { Navigate, useNavigate } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabase"
import { useWorkspaceAccess } from "@/lib/workspace-access"
import {
  cancelCaClientAccessRequest,
  createMyFirmWorkspace,
  loadMyCaAccessRequests,
  requestCaClientAccess,
  type CaAccessRequest,
} from "@/lib/workspace-access-service"

function readableDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

export function CaPortalPage() {
  const navigate = useNavigate()
  const { userProfile, workspaceOptions, switchWorkspace, loading } = useWorkspaceAccess()
  const [companyReference, setCompanyReference] = useState("")
  const [message, setMessage] = useState("")
  const [firmWorkspaceName, setFirmWorkspaceName] = useState("")
  const [requests, setRequests] = useState<CaAccessRequest[]>([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const loadRequests = useCallback(async () => {
    try { setRequests(await loadMyCaAccessRequests()) }
    catch (value) { setError(value instanceof Error ? value.message : "Access requests could not be loaded.") }
  }, [])

  useEffect(() => { if (userProfile?.account_type === "ca") void loadRequests() }, [userProfile, loadRequests])

  useEffect(() => {
    if (!firmWorkspaceName && userProfile?.ca_firm_name) setFirmWorkspaceName(userProfile.ca_firm_name)
  }, [firmWorkspaceName, userProfile])

  const ownWorkspace = workspaceOptions.find((option) => option.workspace.owner_user_id === userProfile?.id || option.membership.role === "owner")
  const clientWorkspaces = workspaceOptions.filter((option) => option.workspace.id !== ownWorkspace?.workspace.id)

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault()
    if (!companyReference.trim()) return
    setSaving(true); setNotice(""); setError("")
    try {
      await requestCaClientAccess(companyReference.trim(), message.trim())
      setCompanyReference(""); setMessage("")
      await loadRequests()
      setNotice("Access request sent. The company owner must approve it before the workspace appears here.")
    } catch (value) {
      setError(value instanceof Error ? value.message : "The access request could not be sent.")
    } finally { setSaving(false) }
  }

  async function cancelRequest(requestId: string) {
    setSaving(true); setNotice(""); setError("")
    try {
      await cancelCaClientAccessRequest(requestId)
      await loadRequests()
      setNotice("Access request cancelled.")
    } catch (value) {
      setError(value instanceof Error ? value.message : "The request could not be cancelled.")
    } finally { setSaving(false) }
  }

  async function openWorkspace(workspaceId: string) {
    await switchWorkspace(workspaceId)
    window.location.assign("/workspace")
  }

  async function createFirmWorkspace(event: React.FormEvent) {
    event.preventDefault()
    if (!firmWorkspaceName.trim()) return
    setSaving(true); setNotice(""); setError("")
    try {
      const result = await createMyFirmWorkspace(firmWorkspaceName.trim())
      await switchWorkspace(result.workspaceId)
      window.location.assign(result.created ? "/setup" : "/workspace")
    } catch (value) {
      setError(value instanceof Error ? value.message : "Your firm workspace could not be created.")
    } finally { setSaving(false) }
  }

  async function signOut() {
    await supabase?.auth.signOut()
    navigate("/login")
  }

  if (loading) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading your CA portal…</div>
  if (userProfile?.account_type !== "ca") return <Navigate to="/setup" replace />

  return (
    <main className="min-h-svh bg-muted/30">
      <header className="border-b bg-background"><div className="mx-auto flex h-16 max-w-7xl items-center px-5"><BrandMark /><div className="ml-auto flex items-center gap-3"><Badge variant="outline">CA portal</Badge><Button variant="ghost" onClick={() => void signOut()}><LogOut />Sign out</Button></div></div></header>
      <div className="mx-auto max-w-7xl space-y-7 p-5 sm:p-8">
        <div><p className="text-sm font-medium text-primary">{userProfile.ca_firm_name}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">CA workspace hub</h1><p className="mt-2 text-muted-foreground">Manage your own firm separately and open every client company that has granted you access.</p></div>

        {notice ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">{notice}</p> : null}
        {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p> : null}

        <section className="space-y-3">
          <div><h2 className="text-xl font-semibold">My firm workspace</h2><p className="text-sm text-muted-foreground">Use this only for your own firm’s invoices, payroll and records. It has its own subscription and credit balances.</p></div>
          {ownWorkspace ? <Card className="max-w-2xl"><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-5" />{ownWorkspace.workspace.name}<Badge variant="secondary">My firm</Badge></CardTitle><CardDescription>You own this workspace. Client subscriptions and credits are never used here.</CardDescription></CardHeader><CardContent><Button onClick={() => void openWorkspace(ownWorkspace.workspace.id)}>Open my workspace</Button></CardContent></Card> : <Card className="max-w-2xl border-dashed"><CardHeader><CardTitle>Create a workspace for your firm</CardTitle><CardDescription>This is optional. Create it only if your CA practice needs to issue its own invoices or manage its own employees. You can review plans before purchasing.</CardDescription></CardHeader><CardContent><form className="flex flex-col gap-3 sm:flex-row" onSubmit={createFirmWorkspace}><div className="flex-1 space-y-2"><Label htmlFor="firm-workspace-name">Firm or practice name</Label><Input id="firm-workspace-name" required maxLength={160} value={firmWorkspaceName} onChange={(event) => setFirmWorkspaceName(event.target.value)} placeholder="Your CA practice name" /></div><Button className="sm:self-end" type="submit" disabled={saving}><Plus />Create my workspace</Button></form></CardContent></Card>}
        </section>

        <section className="space-y-3">
          <div><h2 className="text-xl font-semibold">Client workspaces</h2><p className="text-sm text-muted-foreground">Each client owns its subscription, credits, data and the permissions granted to you.</p></div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clientWorkspaces.map((option) => <Card key={option.workspace.id}><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-5" />{option.workspace.name}</CardTitle><CardDescription>Access granted as {option.membership.role}. The company’s page permissions apply.</CardDescription></CardHeader><CardContent><Button className="w-full" onClick={() => void openWorkspace(option.workspace.id)}>Open client workspace</Button></CardContent></Card>)}
          {!clientWorkspaces.length ? <Card className="border-dashed md:col-span-2"><CardContent className="flex min-h-48 flex-col items-center justify-center p-8 text-center"><Building2 className="mb-3 size-8 text-muted-foreground" /><p className="font-semibold">No client access yet</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Ask a client to invite your ChanaX email, or send a secure request using their owner email or subscription code.</p></CardContent></Card> : null}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Card><CardHeader><CardTitle>Request client access</CardTitle><CardDescription>The company owner must approve the request. Approval uses one of the company’s included or paid team seats.</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={submitRequest}><div className="space-y-2"><Label htmlFor="company-reference">Company owner email or subscription code</Label><Input id="company-reference" required value={companyReference} onChange={(event) => setCompanyReference(event.target.value)} placeholder="owner@company.com or subscription code" /></div><div className="space-y-2"><Label htmlFor="request-message">Message (optional)</Label><textarea id="request-message" maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Explain which accounting work you will manage." /></div><Button type="submit" disabled={saving}><Send />Send access request</Button></form></CardContent></Card>

          <Card><CardHeader><CardTitle>Access requests</CardTitle><CardDescription>Your most recent client approval requests.</CardDescription></CardHeader><CardContent className="space-y-3">{requests.length ? requests.map((request) => <div key={request.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate font-medium">{request.workspace?.name || "Client workspace"}</p><p className="text-xs text-muted-foreground">Requested {readableDate(request.created_at)}</p></div><Badge variant={request.status === "approved" ? "secondary" : request.status === "rejected" ? "destructive" : "outline"}>{request.status === "approved" ? <CheckCircle2 /> : request.status === "rejected" ? <XCircle /> : <Clock3 />}{request.status}</Badge>{request.status === "pending" ? <Button size="sm" variant="outline" disabled={saving} onClick={() => void cancelRequest(request.id)}>Cancel</Button> : null}</div>) : <p className="py-10 text-center text-sm text-muted-foreground">No requests sent yet.</p>}</CardContent></Card>
        </div>
      </div>
    </main>
  )
}
