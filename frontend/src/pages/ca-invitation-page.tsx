import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { acceptClientInvite, previewClientInvite, registerClientInvite, type ClientInvitePreview } from '@/lib/ca-partner-api'
import { clearCaInvitation, pendingCaInvitation, rememberCaInvitation, validInvitationToken } from '@/lib/ca-invitation-session'
import { customerErrorMessage } from '@/lib/customer-errors'
import { permissionOptions, permissionsForRole, type WorkspacePermission } from '@/lib/workspace-access-service'
import { useWorkspaceAccess } from '@/lib/workspace-access'
import { supabase } from '@/lib/supabase'

export function CaInvitationPage() {
  const navigate = useNavigate()
  const { user, loading, workspaceOptions, refresh, switchWorkspace } = useWorkspaceAccess()
  const [token] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.hash.slice(1)).get('token')
    if (validInvitationToken(fromUrl)) { rememberCaInvitation(fromUrl); return fromUrl }
    return pendingCaInvitation()
  })
  const [preview, setPreview] = useState<ClientInvitePreview | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [selectedWorkspace, setSelectedWorkspace] = useState('')
  const [permissions, setPermissions] = useState<WorkspacePermission[]>(permissionsForRole('accountant'))
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const owned = workspaceOptions.filter(option => option.workspace.owner_user_id === user?.id && option.workspace.status === 'active')
  const workspaceId = selectedWorkspace || owned[0]?.workspace.id || ''

  useEffect(() => {
    let alive = true
    if (!token) { setChecking(false); return }
    void previewClientInvite(token).then(value => {
      if (alive) setPreview(value)
    }).catch(value => { if (alive) setError(customerErrorMessage(value, 'The invitation could not be loaded.')) })
      .finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [token])
  useEffect(() => {
    if (user?.email_confirmed_at && token && preview) void registerClientInvite(token).catch(() => {})
  }, [user?.email_confirmed_at, user?.id, token, preview])

  async function approve() {
    if (!token || !workspaceId || !confirmed) return
    setSaving(true); setError('')
    try {
      await acceptClientInvite(token, workspaceId, permissions)
      clearCaInvitation()
      await refresh()
      await switchWorkspace(workspaceId)
      navigate('/workspace', { replace: true })
    } catch (value) { setError(customerErrorMessage(value, 'The CA connection could not be approved.')) }
    finally { setSaving(false) }
  }
  function skip() { clearCaInvitation(); navigate(user ? '/setup' : '/login', { replace: true }) }
  const wrongEmail = Boolean(preview?.email && user?.email && preview.email.toLowerCase() !== user.email.toLowerCase())
  if (checking || loading) return <div className="grid min-h-svh place-items-center">Loading your invitation…</div>
  return <main className="min-h-svh bg-muted/30 p-5 sm:p-10"><Card className="mx-auto max-w-2xl">
    <CardHeader><BrandMark className="mb-5" /><CardTitle>{preview ? `Invitation from ${preview.firm_name}` : 'Client invitation unavailable'}</CardTitle>
      <CardDescription>{preview ? `For ${preview.client_name}. You decide whether to connect your company to this CA.` : 'The link may have expired, been accepted or been cancelled. Ask your CA for a new invitation.'}</CardDescription>
    </CardHeader><CardContent className="space-y-5">
      {error ? <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p> : null}
      {preview ? <>
        <p className="rounded-lg border bg-muted/30 p-4 text-sm">Your company owns its subscription, credits and records. Your CA receives no access until you approve. They use one of your two included additional-user seats. You can change permissions or disable access in Workspace settings.</p>
        {!user ? <><p className="text-sm">Create a business account or sign in{preview.email ? ` using ${preview.email}` : ''}. Confirm your email, then return here to approve the connection.</p><Button asChild><Link to="/login?ca_invite=1">Create account or sign in</Link></Button></> : <>
          <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
          {wrongEmail || !user.email_confirmed_at ? <p className="text-sm text-destructive">{wrongEmail ? 'Use the email address this invitation was sent to.' : 'Confirm your email before approving this invitation.'}</p> : null}
          {wrongEmail ? <Button variant="outline" onClick={() => void supabase?.auth.signOut().then(() => navigate('/login?ca_invite=1'))}>Switch account</Button> : null}
          <div className="space-y-2"><Label htmlFor="invite-workspace">Your company workspace</Label><select id="invite-workspace" className="h-10 w-full rounded-md border bg-background px-3" value={workspaceId} disabled={saving} onChange={event => setSelectedWorkspace(event.target.value)}>
            {!owned.length ? <option value="">No owned active workspace available</option> : owned.map(option => <option key={option.workspace.id} value={option.workspace.id}>{option.workspace.name}</option>)}
          </select></div>
          {!owned.length ? <p className="text-sm">Only a workspace owner can approve. <Link className="underline" to="/setup">Set up your business first</Link>, then reopen the invitation.</p> : null}
          <fieldset disabled={saving} className="space-y-3"><legend className="mb-2 font-medium">Pages your CA can access</legend><div className="grid gap-2 sm:grid-cols-2">{permissionOptions.map(option => <label key={option.permission} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={permissions.includes(option.permission)} onChange={event => setPermissions(current => event.target.checked ? [...current, option.permission] : current.filter(item => item !== option.permission))} />{option.label}</label>)}</div></fieldset>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={saving} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />I am the company owner and approve this CA’s access with the selected permissions.</label>
          <Button disabled={saving || !confirmed || !workspaceId || wrongEmail || !user.email_confirmed_at} onClick={() => void approve()}>{saving ? 'Approving…' : 'Approve CA connection'}</Button>
        </>}
      </> : null}
      <Button variant="ghost" disabled={saving} onClick={skip}>Skip for now</Button>
    </CardContent></Card></main>
}
