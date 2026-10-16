/** A saved selection wins; otherwise prefer the user's owner membership. */
export function selectWorkspaceMembership<T extends { workspace_id: string; role: string }>(memberships: T[], preferred?: string | null): T | undefined {
  return memberships.find((item) => item.workspace_id === preferred)
    || memberships.find((item) => item.role === "owner")
    || memberships.at(-1)
}

/** Ignore responses from requests superseded by a switch, refresh or sign-out. */
export function createWorkspaceLoadGuard() {
  let sequence = 0
  return { begin: () => { const current = ++sequence; return () => current === sequence }, invalidate: () => { sequence += 1 } }
}
