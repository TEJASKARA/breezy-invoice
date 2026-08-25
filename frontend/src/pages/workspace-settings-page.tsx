import { useCallback, useEffect, useState } from "react"
import { CalendarDays, Check, Clipboard, Crown, KeyRound, MailPlus, Save, ShieldCheck, UserCog, Users } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useMvpStore } from "@/lib/mvp-store"
import { supabase } from "@/lib/supabase"
import {
  useWorkspaceAccess,
} from "@/lib/workspace-access"
import {
  inviteWorkspaceUser,
  loadWorkspacePeople,
  permissionOptions,
  permissionsForRole,
  revokeWorkspaceInvitation,
  updateWorkspaceMember,
  type WorkspaceInvitation,
  type WorkspaceMember,
  type WorkspacePermission,
  type WorkspaceRole,
} from "@/lib/workspace-access-service"

type EditableRole = Exclude<WorkspaceRole, "owner">
const editableRoles: { value: EditableRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "hr", label: "HR" },
  { value: "accountant", label: "Accountant" },
  { value: "viewer", label: "Viewer" },
  { value: "custom", label: "Custom" },
]

function readableDate(value: string | null) {
  if (!value) return "Not set"
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value))
}

function PermissionChecklist({ selected, onChange, disabled = false }: { selected: WorkspacePermission[]; onChange: (next: WorkspacePermission[]) => void; disabled?: boolean }) {
  function toggle(permission: WorkspacePermission) {
    onChange(selected.includes(permission) ? selected.filter((item) => item !== permission) : [...selected, permission])
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {permissionOptions.map(({ permission, label }) => (
        <label key={permission} className="flex items-start gap-2 rounded-lg border bg-background p-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-foreground" checked={selected.includes(permission)} disabled={disabled} onChange={() => toggle(permission)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}

export function WorkspaceSettingsPage() {
  const { setup, completeSetup } = useMvpStore()
  const { user, workspace, membership, subscription, can, refresh } = useWorkspaceAccess()
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([])
  const [firmName, setFirmName] = useState(setup?.firmName || workspace?.name || "")
  const [industry, setIndustry] = useState(setup?.industry || "")
  const [gstin, setGstin] = useState(setup?.gstin || "")
  const [mailingAddress, setMailingAddress] = useState(setup?.mailingAddress || "")
  const [leavePeriod, setLeavePeriod] = useState<"monthly" | "yearly">(setup?.leavePolicy?.period || "monthly")
  const [leaveAllowanceDays, setLeaveAllowanceDays] = useState(setup?.leavePolicy?.allowanceDays ?? 1)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<EditableRole>("viewer")
  const [invitePermissions, setInvitePermissions] = useState<WorkspacePermission[]>(permissionsForRole("viewer"))
  const [editingMember, setEditingMember] = useState<WorkspaceMember | null>(null)
  const [editRole, setEditRole] = useState<EditableRole>("viewer")
  const [editPermissions, setEditPermissions] = useState<WorkspacePermission[]>([])
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const canManageTeam = can("team.manage")
  const canManageWorkspace = can("workspace.manage")
  const isOwner = membership?.role === "owner"

  useEffect(() => {
    setFirmName(setup?.firmName || workspace?.name || "")
    setIndustry(setup?.industry || "")
    setGstin(setup?.gstin || "")
    setMailingAddress(setup?.mailingAddress || "")
    setLeavePeriod(setup?.leavePolicy?.period || "monthly")
    setLeaveAllowanceDays(setup?.leavePolicy?.allowanceDays ?? 1)
  }, [setup, workspace?.id, workspace?.name])

  const loadPeople = useCallback(async () => {
    if (!workspace || !canManageTeam) return
    try {
      const people = await loadWorkspacePeople(workspace.id)
      setMembers(people.members)
      setInvitations(people.invitations)
      setError("")
    } catch (peopleError) {
      setError(peopleError instanceof Error ? peopleError.message : "Team access could not be loaded.")
    }
  }, [workspace, canManageTeam])

  useEffect(() => { void loadPeople() }, [loadPeople])

  function showSuccess(message: string) { setNotice(message); setError("") }
  function showError(value: unknown) { setError(value instanceof Error ? value.message : "The change could not be saved."); setNotice("") }

  async function saveWorkspaceDetails(event: React.FormEvent) {
    event.preventDefault()
    if (!setup || !workspace) return
    setSaving(true)
    try {
      if (isOwner && workspace.name !== firmName.trim()) {
        const { error: updateError } = await supabase!.from("breezy_workspaces").update({ name: firmName.trim() }).eq("id", workspace.id)
        if (updateError) throw new Error(updateError.message)
      }
      await completeSetup({ ...setup, firmName: firmName.trim(), industry: industry.trim(), gstin: gstin.trim().toUpperCase(), mailingAddress: mailingAddress.trim(), leavePolicy: { period: leavePeriod, allowanceDays: Math.max(0, leaveAllowanceDays) } })
      await refresh()
      showSuccess("Workspace details saved.")
    } catch (saveError) { showError(saveError) } finally { setSaving(false) }
  }

  async function sendInvitation(event: React.FormEvent) {
    event.preventDefault()
    if (!workspace) return
    setSaving(true)
    try {
      await inviteWorkspaceUser(workspace.id, inviteEmail, inviteRole, invitePermissions)
      setInviteEmail("")
      await loadPeople()
      showSuccess("Access was added. Existing BreezyInvoice users can use it immediately; new users receive access when they sign up with this email.")
    } catch (inviteError) { showError(inviteError) } finally { setSaving(false) }
  }

  function beginEdit(member: WorkspaceMember) {
    if (member.role === "owner") return
    setEditingMember(member)
    setEditRole(member.role)
    setEditPermissions(member.permissions)
    setNotice("")
    setError("")
  }

  async function saveMember() {
    if (!workspace || !editingMember) return
    setSaving(true)
    try {
      await updateWorkspaceMember(workspace.id, editingMember.user_id, editRole, editPermissions, editingMember.status === "disabled" ? "disabled" : "active")
      setEditingMember(null)
      await loadPeople()
      showSuccess("Team member access updated.")
    } catch (memberError) { showError(memberError) } finally { setSaving(false) }
  }

  async function toggleMember(member: WorkspaceMember) {
    if (!workspace || member.role === "owner") return
    setSaving(true)
    try {
      await updateWorkspaceMember(workspace.id, member.user_id, member.role, member.permissions, member.status === "active" ? "disabled" : "active")
      await loadPeople()
      showSuccess(member.status === "active" ? "Team member access disabled." : "Team member access restored.")
    } catch (memberError) { showError(memberError) } finally { setSaving(false) }
  }

  async function revokeInvitation(invitationId: string) {
    if (!workspace) return
    try {
      await revokeWorkspaceInvitation(workspace.id, invitationId)
      await loadPeople()
      showSuccess("Pending invitation revoked.")
    } catch (invitationError) { showError(invitationError) }
  }

  async function copyCode() {
    if (!workspace) return
    try {
      await navigator.clipboard.writeText(workspace.subscription_code)
      showSuccess("Subscription code copied.")
    } catch (clipboardError) {
      showError(clipboardError instanceof Error ? clipboardError : new Error("The subscription code could not be copied. Select it and copy it manually."))
    }
  }

  if (!workspace || !membership) return <p className="text-sm text-muted-foreground">Loading workspace settings…</p>

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Administration" title="Workspace settings" description="Manage your business profile, subscription identity, team roles and page access from one place." />

      {notice ? <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</div> : null}
      {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Crown className="size-4" />Workspace</CardTitle><CardDescription>Your shared BreezyInvoice account.</CardDescription></CardHeader>
          <CardContent className="space-y-3"><p className="text-lg font-semibold">{workspace.name}</p><div className="flex gap-2"><Badge variant="outline">{membership.role}</Badge><Badge variant={workspace.status === "active" ? "secondary" : "destructive"}>{workspace.status}</Badge></div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4" />Subscription code</CardTitle><CardDescription>Use this only as an account reference—not as a password.</CardDescription></CardHeader>
          <CardContent><div className="flex items-center gap-2"><code className="flex-1 rounded-lg bg-muted px-3 py-2 text-sm font-semibold">{workspace.subscription_code}</code><Button variant="outline" size="icon" aria-label="Copy subscription code" onClick={() => void copyCode()}><Clipboard /></Button></div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" />Subscription</CardTitle><CardDescription>Billing and product access for this workspace.</CardDescription></CardHeader>
          <CardContent className="space-y-2"><div className="flex items-center justify-between"><span className="text-muted-foreground">Plan</span><span className="font-semibold capitalize">{subscription?.plan_key || "Free"}</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><Badge variant="outline" className="capitalize">{subscription?.status || "Active"}</Badge></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Trial ends</span><span>{readableDate(subscription?.trial_ends_at || null)}</span></div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Business details</CardTitle><CardDescription>These details are shared across this workspace and used on generated documents.</CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={saveWorkspaceDetails}>
            <div className="space-y-2"><Label htmlFor="settings-firm-name">Firm or business name</Label><Input id="settings-firm-name" required value={firmName} disabled={!isOwner} onChange={(event) => setFirmName(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="settings-industry">Industry</Label><Input id="settings-industry" required disabled={!canManageWorkspace} value={industry} onChange={(event) => setIndustry(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="settings-gstin">GSTIN</Label><Input id="settings-gstin" required minLength={15} maxLength={15} disabled={!canManageWorkspace} value={gstin} onChange={(event) => setGstin(event.target.value.toUpperCase())} className="font-mono uppercase" /></div>
            <div className="space-y-2 md:col-span-2"><Label htmlFor="settings-address">Mailing address</Label><textarea id="settings-address" required disabled={!canManageWorkspace} value={mailingAddress} onChange={(event) => setMailingAddress(event.target.value)} className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50" /></div>
            <section className="space-y-4 rounded-xl border bg-muted/20 p-4 md:col-span-2">
              <div className="flex items-start gap-3"><CalendarDays className="mt-0.5 size-5 text-muted-foreground" /><div><h3 className="font-medium">Employee leave policy</h3><p className="text-sm text-muted-foreground">This allowance applies to every employee and can be changed by a workspace administrator.</p></div></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="settings-leave-period">Calculate paid leave</Label><select id="settings-leave-period" disabled={!canManageWorkspace} value={leavePeriod} onChange={(event) => setLeavePeriod(event.target.value as "monthly" | "yearly")} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"><option value="monthly">Monthly allowance</option><option value="yearly">Yearly allowance</option></select></div>
                <div className="space-y-2"><Label htmlFor="settings-leave-days">Paid leave allowance</Label><Input id="settings-leave-days" disabled={!canManageWorkspace} type="number" min="0" step="0.5" value={leaveAllowanceDays} onChange={(event) => setLeaveAllowanceDays(Math.max(0, Number(event.target.value) || 0))} /><p className="text-xs text-muted-foreground">{leavePeriod === "monthly" ? "Days per employee each month." : "Days per employee each calendar year."}</p></div>
              </div>
              <p className="text-xs text-muted-foreground">Excess leave, unpaid leave and half-day loss are deducted using monthly gross salary ÷ calendar days.</p>
            </section>
            <div className="md:col-span-2 flex justify-end"><Button type="submit" disabled={saving || !canManageWorkspace}><Save />Save workspace settings</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4" />Team and page access</CardTitle><CardDescription>{canManageTeam ? "Add emails, assign a role, and choose exactly which pages each person can use." : "Only the workspace owner or an admin can change team access."}</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {canManageTeam ? (
            <form onSubmit={sendInvitation} className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center gap-2 font-medium"><MailPlus className="size-4" />Add a team member</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="invite-email">Email address</Label><Input id="invite-email" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="employee@company.com" /></div>
                <div className="space-y-2"><Label htmlFor="invite-role">Role</Label><select id="invite-role" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={inviteRole} onChange={(event) => { const role = event.target.value as EditableRole; setInviteRole(role); setInvitePermissions(permissionsForRole(role)) }}>{editableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></div>
              </div>
              {inviteRole === "admin" ? <p className="rounded-lg border bg-background p-3 text-sm">Admins can access and manage every BreezyInvoice page.</p> : <PermissionChecklist selected={invitePermissions} onChange={setInvitePermissions} />}
              <div className="flex justify-end"><Button type="submit" disabled={saving}><MailPlus />Add access</Button></div>
            </form>
          ) : null}

          {canManageTeam ? (
            <Table>
              <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Joined</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>{members.map((member) => {
                const name = member.profile?.full_name || member.profile?.email || "Workspace member"
                const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
                return <TableRow key={member.id}><TableCell><div className="flex items-center gap-2"><Avatar className="size-8">{member.profile?.avatar_path ? <AvatarImage src={member.profile.avatar_path} alt={name} /> : null}<AvatarFallback>{initials}</AvatarFallback></Avatar><div><p className="font-medium">{name}</p><p className="text-xs text-muted-foreground">{member.profile?.email || (member.user_id === user?.id ? "You" : member.user_id)}</p></div></div></TableCell><TableCell className="capitalize">{member.role}</TableCell><TableCell><Badge variant={member.status === "active" ? "secondary" : "destructive"}>{member.status}</Badge></TableCell><TableCell>{readableDate(member.joined_at)}</TableCell><TableCell><div className="flex justify-end gap-2">{member.role === "owner" ? <Badge variant="outline"><Crown />Owner</Badge> : <><Button size="sm" variant="outline" onClick={() => beginEdit(member)}><UserCog />Edit access</Button><Button size="sm" variant={member.status === "active" ? "destructive" : "outline"} disabled={saving} onClick={() => void toggleMember(member)}>{member.status === "active" ? "Disable" : "Restore"}</Button></>}</div></TableCell></TableRow>
              })}</TableBody>
            </Table>
          ) : <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Your role is <strong className="capitalize text-foreground">{membership.role}</strong>. Contact the workspace owner to change your access.</div>}

          {invitations.length ? <div className="space-y-3"><h3 className="font-medium">Pending invitations</h3>{invitations.map((invitation) => <div key={invitation.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"><div className="flex-1"><p className="font-medium">{invitation.email}</p><p className="text-xs text-muted-foreground">{invitation.role} · expires {readableDate(invitation.expires_at)}</p></div><Button variant="outline" size="sm" onClick={() => void revokeInvitation(invitation.id)}>Revoke</Button></div>)}</div> : null}
        </CardContent>
      </Card>

      {editingMember ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Edit team member access"><Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto"><CardHeader><CardTitle>Edit access</CardTitle><CardDescription>{editingMember.profile?.full_name || editingMember.profile?.email}</CardDescription></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label htmlFor="edit-member-role">Role</Label><select id="edit-member-role" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={editRole} onChange={(event) => { const role = event.target.value as EditableRole; setEditRole(role); setEditPermissions(permissionsForRole(role)) }}>{editableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></div>{editRole === "admin" ? <p className="rounded-lg border bg-muted/30 p-3 text-sm">Admins can access and manage every page.</p> : <PermissionChecklist selected={editPermissions} onChange={setEditPermissions} />}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditingMember(null)}>Cancel</Button><Button disabled={saving} onClick={() => void saveMember()}><Check />Save access</Button></div></CardContent></Card></div> : null}
    </div>
  )
}
