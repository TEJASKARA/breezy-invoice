import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useMvpStore, type Company } from "@/lib/mvp-store"
import { useWorkspaceAccess } from "@/lib/workspace-access"
import { entitySelectionKey, selectedWorkspaceEntity } from "@/lib/entity-selection-utils"

type EntitySelection = {
  selectedEntityId: string
  selectedEntity?: Company
  selectEntity: (id: string) => void
  managerMode: "add" | "manage" | null
  openEntityManager: (mode: "add" | "manage") => void
  closeEntityManager: () => void
  entityCreated: (name: string) => void
}
const EntitySelectionContext = createContext<EntitySelection | null>(null)

export function EntitySelectionProvider({ children }: { children: ReactNode }) {
  const { workspace, membership } = useWorkspaceAccess()
  return <WorkspaceEntitySelection key={`${workspace?.id}:${membership?.user_id}`} storageKey={entitySelectionKey(workspace?.id, membership?.user_id)}>{children}</WorkspaceEntitySelection>
}

function WorkspaceEntitySelection({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const { companies } = useMvpStore()
  const [savedId, setSavedId] = useState(() => { try { return storageKey ? localStorage.getItem(storageKey) || "" : "" } catch { return "" } })
  const [managerMode, setManagerMode] = useState<EntitySelection["managerMode"]>(null)
  const [createdName, setCreatedName] = useState("")
  const activeCompanies = useMemo(() => companies.filter((company) => !company.transferredAt), [companies])
  const selectedEntity = selectedWorkspaceEntity(companies, savedId)
  const selectedEntityId = selectedEntity?.id || ""
  useEffect(() => {
    if (!storageKey) return
    try { if (selectedEntityId) localStorage.setItem(storageKey, selectedEntityId); else localStorage.removeItem(storageKey) } catch { /* Selection still works when browser storage is unavailable. */ }
  }, [storageKey, selectedEntityId])
  useEffect(() => {
    const created = activeCompanies.find((company) => company.companyName.trim() === createdName)
    if (!createdName || !created) return
    setSavedId(created.id)
    setCreatedName("")
  }, [activeCompanies, createdName])
  const selectEntity = useCallback((id: string) => { if (companies.some((company) => company.id === id)) setSavedId(id) }, [companies])
  return <EntitySelectionContext.Provider value={{ selectedEntityId, selectedEntity, selectEntity, managerMode, openEntityManager: setManagerMode, closeEntityManager: () => setManagerMode(null), entityCreated: (name) => { setCreatedName(name); setManagerMode(null) } }}>{children}</EntitySelectionContext.Provider>
}

export function useEntitySelection() {
  const context = useContext(EntitySelectionContext)
  if (!context) throw new Error("Entity selection requires the workspace provider.")
  return context
}
