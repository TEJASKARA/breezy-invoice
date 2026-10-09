import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabase"
import { useWorkspaceAccess } from "@/lib/workspace-access"
import type { Company } from "@/lib/mvp-store"

type Transfer = {
  id: string; source_workspace_id: string; target_workspace_id: string
  company_name: string; move_history: boolean; status: string; expires_at: string
}
const warning = "Subscriptions, credit balances and team access do not move. Imported history uses no credits. Original workspace members lose access to moved records."

async function transferRpc(name: string, args: Record<string, unknown>) {
  if (!supabase) throw new Error("Your account connection is unavailable.")
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

export function EntityTransferRequests() {
  const { workspace, membership } = useWorkspaceAccess()
  const cache = useQueryClient()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const workspaceId = workspace?.id
  const owner = membership?.role === "owner"
  const { data: requests = [], error: loadError, refetch } = useQuery({
    queryKey: ["entity-transfers", workspaceId],
    enabled: Boolean(workspaceId && owner),
    retry: false,
    queryFn: async () => {
      if (!supabase || !workspaceId) return []
      const result = await supabase.from("breezy_entity_transfers").select("*")
        .or(`source_workspace_id.eq.${workspaceId},target_workspace_id.eq.${workspaceId}`)
        .in("status", ["pending", "accepted"]).order("created_at", { ascending: false }).limit(50)
      if (result.error) throw new Error(["PGRST205", "42P01"].includes(result.error.code) ? "Company transfers are unavailable. Apply the company-transfer database migration first." : result.error.message)
      return result.data as Transfer[]
    },
  })
  if (!owner || (!requests.length && !loadError)) return null
  async function resolve(request: Transfer, action: "accept" | "reject" | "cancel") {
    setBusy(true); setError("")
    try {
      if (action === "cancel") await transferRpc("breezy_cancel_entity_transfer", { transfer_id: request.id })
      else await transferRpc("breezy_review_entity_transfer", { transfer_id: request.id, approve_transfer: action === "accept" })
      if (action === "accept") {
        // Discard stale workspace data before any autosaver can write to the old ownership.
        window.location.reload()
        return
      }
      setConfirm(null)
      await cache.invalidateQueries({ queryKey: ["entity-transfers", workspaceId] })
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The transfer could not be completed.") }
    finally { setBusy(false) }
  }
  return <Card className="mb-6">
    <CardHeader><CardTitle>Company transfer requests</CardTitle><CardDescription>Only the receiving account owner can approve a move. Complete company setup after accepting.</CardDescription><Button variant="outline" size="sm" disabled={busy} onClick={() => void refetch()}>Refresh requests</Button></CardHeader>
    <CardContent className="space-y-4">
      {error || loadError ? <p role="alert" className="text-sm text-destructive">{error || loadError?.message}</p> : null}
      {requests.map((request) => {
        const incoming = request.target_workspace_id === workspaceId
        const completed = request.status === "accepted"
        const expired = new Date(request.expires_at).getTime() <= Date.now()
        return <section key={request.id} className="space-y-3 rounded-xl border p-4">
          <p className="font-semibold">{request.company_name} <span className="text-sm font-normal text-muted-foreground">{completed ? "Transfer completed" : incoming ? "Incoming" : "Awaiting destination approval"}</span></p>
          <p className="text-sm">{request.move_history ? "Move company and all history" : "Start fresh; leave read-only history in the original workspace"}</p>
          <p className="text-xs text-muted-foreground">{warning}</p>
          {!completed ? <p className="text-xs text-muted-foreground">{expired ? "Expired" : `Expires ${new Date(request.expires_at).toLocaleDateString()}`}</p> : null}
          {completed ? <Button variant="outline" onClick={() => window.location.reload()}>Refresh workspace data</Button> : incoming ? <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || expired} onClick={() => void resolve(request, "reject")}>Reject</Button>
            {confirm === request.id ? <>
              <p className="w-full text-sm">Confirm: receive this company into your account with the history choice shown above? Existing subscriptions and credits remain separate.</p>
              <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>Back</Button>
              <Button disabled={busy || expired} onClick={() => void resolve(request, "accept")}>{busy ? "Transferring…" : "Confirm and receive company"}</Button>
            </> : <Button disabled={busy || expired} onClick={() => setConfirm(request.id)}>Review and accept</Button>}
          </div> : <Button variant="outline" disabled={busy} onClick={() => void resolve(request, "cancel")}>Cancel request</Button>}
        </section>
      })}
    </CardContent>
  </Card>
}

export function EntityTransferForm({ company, onClose }: { company: Company; onClose: () => void }) {
  const { workspace } = useWorkspaceAccess()
  const cache = useQueryClient()
  const [destination, setDestination] = useState("")
  const [history, setHistory] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function requestTransfer() {
    if (!workspace) return
    setBusy(true); setError("")
    try {
      await transferRpc("breezy_request_entity_transfer", {
        target_workspace_id: workspace.id, target_entity_id: company.id,
        destination_reference: destination.trim(), transfer_history: history,
      })
      await cache.invalidateQueries({ queryKey: ["entity-transfers", workspace.id] })
      onClose()
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The transfer request could not be sent.") }
    finally { setBusy(false) }
  }
  return <Card>
    <CardHeader><CardTitle>Move {company.companyName} to a separate account</CardTitle><CardDescription>The receiving owner must have a registered company account with no active entities. They can accept during setup without registering this GSTIN again.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {confirm ? <div className="space-y-3 rounded-xl border p-4">
        <p>Move <strong>{company.companyName}</strong> to <strong>{destination}</strong>?</p>
        <p className="text-sm">{history ? "All company history and attachments will move after approval." : "Only company details, templates and numbering will move. Existing history will remain read-only here."}</p>
        <p className="text-sm text-muted-foreground">{warning} Nothing is deleted. Your primary registered company cannot be moved through this option.</p>
      </div> : <>
        <div className="space-y-2"><Label htmlFor="transfer-destination">Receiving owner email or subscription code</Label><Input id="transfer-destination" value={destination} onChange={(e) => setDestination(e.target.value)} /></div>
        <fieldset className="space-y-3"><legend className="mb-2 font-medium">What should happen to existing records?</legend>
          <label className="flex gap-3 rounded-xl border p-4"><input type="radio" name="transfer-history" checked={history} onChange={() => setHistory(true)} /><span><span className="block font-medium">Move company and all history</span><span className="text-sm text-muted-foreground">Customers, invoices, quotations, employees, attendance, payslips, letters, expenses and bill attachments.</span></span></label>
          <label className="flex gap-3 rounded-xl border p-4"><input type="radio" name="transfer-history" checked={!history} onChange={() => setHistory(false)} /><span><span className="block font-medium">Start fresh in the new account</span><span className="text-sm text-muted-foreground">Keep read-only history here. Move company details, templates and numbering only.</span></span></label>
        </fieldset>
        <p className="text-sm text-muted-foreground">{warning}</p>
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={confirm ? () => setConfirm(false) : onClose}>{confirm ? "Back" : "Cancel"}</Button>
        <Button disabled={busy || !destination.trim()} onClick={confirm ? () => void requestTransfer() : () => setConfirm(true)}>{busy ? "Requesting…" : confirm ? "Confirm and request approval" : "Review transfer"}</Button>
      </div>
    </CardContent>
  </Card>
}
