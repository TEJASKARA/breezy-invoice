import { customerErrorMessage } from './customer-errors'
import { supabase } from './supabase'
import type { WorkspacePermission } from './workspace-access-service'

export type ClientInvitation = {
  id: string; client_name: string; email: string | null; phone: string | null
  status: 'pending' | 'registered' | 'accepted' | 'revoked' | 'expired'
  workspace_id: string | null; created_at: string; expires_at: string
}
export type ClientReadiness = {
  workspace_id: string; name: string
  status: 'onboarding_incomplete' | 'ready' | 'inactive' | 'limited_visibility'
  missing: string[]; last_activity: string | null; can_open: boolean
}
export type PartnerDashboard = { invitations: ClientInvitation[]; clients: ClientReadiness[] }
export type ClientInvitePreview = { client_name: string; firm_name: string; email: string | null; expires_at: string }

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('Your account connection is temporarily unavailable.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(customerErrorMessage(error))
  return data as T
}
export const loadPartnerDashboard = () => rpc<PartnerDashboard>('chanax_ca_partner_dashboard')
export const previewClientInvite = (token: string) => rpc<ClientInvitePreview | null>('chanax_preview_ca_client_invitation', { invitation_token: token })
export const registerClientInvite = (token: string) => rpc<void>('chanax_register_ca_client_invitation', { invitation_token: token })
export const acceptClientInvite = (token: string, workspaceId: string, permissions: WorkspacePermission[]) =>
  rpc<{ workspace_id: string }>('chanax_accept_ca_client_invitation', { invitation_token: token, target_workspace_id: workspaceId, target_permissions: permissions })
export const revokeClientInvite = (id: string) => rpc<void>('chanax_revoke_ca_client_invitation', { target_invitation_id: id })
export const disconnectCaClient = (workspaceId: string) => rpc<void>('chanax_disconnect_ca_client', { target_workspace_id: workspaceId })

export async function inviteNewClient(clientName: string, email: string, phone: string) {
  if (!supabase) throw new Error('Your account connection is temporarily unavailable.')
  const apiUrl = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
  if (!apiUrl) throw new Error('Client invitations are temporarily unavailable.')
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('Sign in again to invite a client.')
  const response = await fetch(`${apiUrl}/api/v1/ca-partners/client-invitations`, {
    method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: clientName.trim(), email: email.trim() || null, phone: phone.trim() || null }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(customerErrorMessage({ message: typeof payload.detail === 'string' ? payload.detail : '', status: response.status }, 'The client invitation could not be created.'))
  return payload as { id: string; invitation_url: string; email_sent: boolean; phone: string | null; message: string }
}
