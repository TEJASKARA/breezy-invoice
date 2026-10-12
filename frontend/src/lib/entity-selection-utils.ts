export function selectedWorkspaceEntity<T extends { id: string; transferredAt?: string }>(companies: T[], preferredId: string) {
  return companies.find((company) => company.id === preferredId)
    || companies.find((company) => !company.transferredAt)
    || companies[0]
}

export function entitySelectionKey(workspaceId?: string, userId?: string) {
  return workspaceId && userId ? `chanax.selected-entity:${workspaceId}:${userId}` : ""
}
