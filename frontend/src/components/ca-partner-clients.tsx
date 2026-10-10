import { useCallback, useEffect, useState } from 'react'
import { Copy, RefreshCw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { customerErrorMessage } from '@/lib/customer-errors'
import { disconnectCaClient, inviteNewClient, loadPartnerDashboard, revokeClientInvite, type PartnerDashboard } from '@/lib/ca-partner-api'
import { useWorkspaceAccess } from '@/lib/workspace-access'

const statusLabels: Record<string, string> = {
  pending: 'Invited, awaiting signup', registered: 'Registered, awaiting approval', accepted: 'Accepted',
  revoked: 'Cancelled', expired: 'Expired', onboarding_incomplete: 'Onboarding incomplete',
  ready: 'Ready', inactive: 'Inactive', limited_visibility: 'Limited page access',
}
function displayDate(value: string) { return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(value)) }

export function CaPartnerClients({ openWorkspace }: { openWorkspace: (id: string) => Promise<void> }) {
  const { refresh } = useWorkspaceAccess()
  const [dashboard, setDashboard] = useState<PartnerDashboard>({ invitations: [], clients: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [filter, setFilter] = useState('all')
  const [share, setShare] = useState<{ url: string; phone: string | null } | null>(null)
  const reload = useCallback(async () => {
    setLoading(true)
    try { setDashboard(await loadPartnerDashboard()); setError('') }
    catch (value) { setError(customerErrorMessage(value, 'Client readiness could not be loaded.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void reload() }, [reload])

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    if (!email.trim() && !phone.trim()) { setError('Enter the client email or phone number.'); return }
    setBusy(true); setError(''); setNotice(''); setShare(null)
    try {
      const result = await inviteNewClient(name, email, phone)
      setShare({ url: result.invitation_url, phone: result.phone })
      setName(''); setEmail(''); setPhone('')
      await reload()
      setNotice(result.message)
    } catch (value) { setError(customerErrorMessage(value, 'The invitation could not be created.')) }
    finally { setBusy(false) }
  }
  async function disconnect(id: string, clientName: string) {
    if (!window.confirm(`Disconnect from ${clientName}? You will lose access. Their records, subscription and credits stay with the company. Reconnecting requires company approval.`)) return
    setBusy(true); setError('')
    try { await disconnectCaClient(id); await Promise.all([reload(), refresh()]); setNotice('Client disconnected. Company records were not deleted.') }
    catch (value) { setError(customerErrorMessage(value, 'The client could not be disconnected.')) }
    finally { setBusy(false) }
  }
  async function cancel(id: string) {
    if (!window.confirm('Cancel this invitation? Its private link will stop working.')) return
    setBusy(true)
    try { await revokeClientInvite(id); await reload(); setNotice('Invitation cancelled.') }
    catch (value) { setError(customerErrorMessage(value, 'The invitation could not be cancelled.')) }
    finally { setBusy(false) }
  }
  async function copyLink() {
    if (!share) return
    try { await navigator.clipboard.writeText(share.url); setNotice('Private invitation link copied. Share it only with this client.') }
    catch { setNotice('Copy the private invitation link from the field below.') }
  }
  const counts = [
    ['Invited', dashboard.invitations.filter(i => i.status === 'pending').length],
    ['Registered', dashboard.invitations.filter(i => i.status === 'registered').length],
    ['Onboarding', dashboard.clients.filter(c => c.status === 'onboarding_incomplete').length],
    ['Ready', dashboard.clients.filter(c => c.status === 'ready').length],
    ['Inactive', dashboard.clients.filter(c => c.status === 'inactive').length],
  ] as const
  const visible = dashboard.clients.filter(client => filter === 'all' || client.status === filter)
  return <section className="space-y-5" aria-label="CA partner clients">
    <Card><CardHeader><CardTitle>Invite a new client</CardTitle><CardDescription>Invite a business that has not joined ChanaX yet, or an existing owner. The client signs up and explicitly approves your page permissions.</CardDescription></CardHeader><CardContent>
      <form onSubmit={event => void invite(event)} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="new-client-name">Client or company name</Label><Input id="new-client-name" required maxLength={160} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="new-client-email">Client email</Label><Input id="new-client-email" type="email" maxLength={320} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} placeholder="owner@company.com" /></div>
        <div className="space-y-2"><Label htmlFor="new-client-phone">Phone with country code</Label><Input id="new-client-phone" type="tel" maxLength={30} value={phone} disabled={busy} onChange={event => setPhone(event.target.value)} placeholder="For example, +91 98765 43210" /></div>
        <p className="text-xs text-muted-foreground sm:col-span-2">Provide either or both. Email invitations are sent by ChanaX. Phone invitations provide a private link for you to share through WhatsApp; no automatic WhatsApp message is sent. Links expire in 14 days.</p>
        <Button className="sm:col-span-2 sm:justify-self-start" disabled={busy}><Send />{busy ? 'Please wait…' : 'Create client invitation'}</Button>
      </form>
      {share ? <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4"><Label htmlFor="client-invite-link">Private invitation link</Label><Input id="client-invite-link" readOnly value={share.url} /><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void copyLink()}><Copy />Copy link</Button><Button variant="outline" asChild><a href={`https://wa.me/${share.phone || ''}?text=${encodeURIComponent(`Your CA has invited you to ChanaX. Create an account or sign in, then review and approve the connection: ${share.url}`)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></Button></div><p className="text-xs text-muted-foreground">Share only with the intended owner. Phone links identify the recipient by possession of the private link, not by phone verification.</p></div> : null}
    </CardContent></Card>
    {notice ? <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{notice}</p> : null}
    {error ? <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p> : null}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{counts.map(([label, count]) => <Card key={label}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{loading ? '…' : count}</p></CardContent></Card>)}</div>
    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Client readiness</CardTitle><Button variant="outline" size="sm" disabled={busy || loading} onClick={() => void reload()}><RefreshCw />Refresh</Button></div><CardDescription>Readiness is assessed using the pages shared with you: company details, an entity and a first generated invoice, quotation, payslip or expense. Payroll is not mandatory. Inactive means access is disabled, the workspace is unavailable, or a ready client has no recorded client activity for 30 days.</CardDescription></CardHeader><CardContent className="space-y-4">
      <Label htmlFor="client-readiness-filter">Show clients</Label><select id="client-readiness-filter" className="h-10 w-full rounded-md border bg-background px-3 sm:max-w-xs" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All connected clients ({dashboard.clients.length})</option>{['onboarding_incomplete','ready','inactive','limited_visibility'].map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select>
      {loading ? <p role="status" className="text-sm text-muted-foreground">Loading client readiness…</p> : visible.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map(client => <div className="space-y-3 rounded-xl border p-4" key={client.workspace_id}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{client.name}</h3><Badge variant="outline">{statusLabels[client.status]}</Badge></div>
        {client.missing.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{client.missing.map(item => <li key={item}>{item}</li>)}</ul> : <p className="text-sm text-muted-foreground">{client.status === 'ready' ? 'Ready for accounting work.' : client.status === 'limited_visibility' ? 'Readiness cannot be fully assessed with your current page permissions.' : 'Review access and client activity with the owner.'}</p>}
        <p className="text-xs text-muted-foreground">Last client activity: {client.last_activity ? displayDate(client.last_activity) : 'Not recorded yet'}</p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !client.can_open} size="sm" onClick={() => void openWorkspace(client.workspace_id).catch(value => setError(customerErrorMessage(value, 'The client workspace could not be opened.')))}>Open workspace</Button>{client.can_open ? <Button disabled={busy} variant="outline" size="sm" onClick={() => void disconnect(client.workspace_id, client.name)}>Disconnect</Button> : null}</div>
      </div>)}</div> : <p className="py-5 text-sm text-muted-foreground">No clients match this view. Invite a client or request access to an existing company below.</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Client invitation history</CardTitle><CardDescription>Registered means the verified client has opened the invitation while signed in. It does not grant access; approval is still required.</CardDescription></CardHeader><CardContent className="space-y-3">{dashboard.invitations.length ? dashboard.invitations.map(invite => <div key={invite.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-medium">{invite.client_name}</p><p className="break-words text-sm text-muted-foreground">{invite.email || invite.phone}</p><p className="text-xs text-muted-foreground">Invited {displayDate(invite.created_at)} · Expires {displayDate(invite.expires_at)}</p></div><Badge variant="outline">{statusLabels[invite.status]}</Badge>{invite.status === 'pending' || invite.status === 'registered' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel(invite.id)}>Cancel invitation</Button> : null}</div>) : <p className="text-sm text-muted-foreground">No client invitations sent yet.</p>}</CardContent></Card>
  </section>
}
