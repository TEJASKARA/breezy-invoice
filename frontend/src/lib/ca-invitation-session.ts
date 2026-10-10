const storageKey = 'chanax-ca-client-invitation'
export function validInvitationToken(value: string | null): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/.test(value))
}
export function rememberCaInvitation(token: string): void {
  if (!validInvitationToken(token)) return
  try { sessionStorage.setItem(storageKey, token) } catch { /* URL fragment still works. */ }
}
export function pendingCaInvitation(): string | null {
  try {
    const token = sessionStorage.getItem(storageKey)
    return validInvitationToken(token) ? token : null
  } catch { return null }
}
export function clearCaInvitation(): void {
  try { sessionStorage.removeItem(storageKey) } catch { /* Storage unavailable. */ }
}
