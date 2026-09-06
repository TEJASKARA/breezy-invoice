import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { User } from "@supabase/supabase-js"

import { supabase } from "@/lib/supabase"
import {
  allowsWorkspacePermission,
  loadWorkspaceAccess,
  type Workspace,
  type WorkspaceMembership,
  type WorkspacePermission,
  type WorkspaceSubscription,
  type WorkspaceCreditAccount,
  type WorkspaceOption,
  type UserWorkspaceProfile,
} from "@/lib/workspace-access-service"

type WorkspaceAccessState = {
  user: User | null
  workspace: Workspace | null
  membership: WorkspaceMembership | null
  subscription: WorkspaceSubscription | null
  creditAccount: WorkspaceCreditAccount | null
  workspaceOptions: WorkspaceOption[]
  userProfile: UserWorkspaceProfile | null
  loading: boolean
  error: string | null
  can: (permission: WorkspacePermission) => boolean
  refresh: () => Promise<void>
  switchWorkspace: (workspaceId: string) => Promise<void>
}

const WorkspaceAccessContext = createContext<WorkspaceAccessState | null>(null)

export function WorkspaceAccessProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [membership, setMembership] = useState<WorkspaceMembership | null>(null)
  const [subscription, setSubscription] = useState<WorkspaceSubscription | null>(null)
  const [creditAccount, setCreditAccount] = useState<WorkspaceCreditAccount | null>(null)
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([])
  const [userProfile, setUserProfile] = useState<UserWorkspaceProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const hydrate = useCallback(async (nextUser: User | null, preferredWorkspaceId?: string | null) => {
    setUser(nextUser)
    if (!nextUser) {
      setWorkspace(null)
      setMembership(null)
      setSubscription(null)
      setCreditAccount(null)
      setWorkspaceOptions([])
      setUserProfile(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const storageKey = `chanax-active-workspace:${nextUser.id}`
      const preferred = preferredWorkspaceId ?? window.localStorage.getItem(storageKey)
      const next = await loadWorkspaceAccess(nextUser, preferred)
      setWorkspace(next.workspace)
      setMembership(next.membership)
      setSubscription(next.subscription)
      setCreditAccount(next.creditAccount)
      setWorkspaceOptions(next.workspaceOptions)
      setUserProfile(next.userProfile)
      if (next.workspace?.id) window.localStorage.setItem(storageKey, next.workspace.id)
      setError(null)
    } catch (accessError) {
      setError(accessError instanceof Error ? accessError.message : "Workspace access could not be loaded.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!supabase) { setLoading(false); setError("Supabase is not configured."); return }
    void supabase.auth.getUser().then(({ data }) => hydrate(data.user))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => void hydrate(session?.user ?? null))
    })
    return () => data.subscription.unsubscribe()
  }, [hydrate])

  const refresh = useCallback(async () => { await hydrate(user) }, [hydrate, user])
  const switchWorkspace = useCallback(async (workspaceId: string) => {
    if (!user) return
    await hydrate(user, workspaceId)
  }, [hydrate, user])
  const value = useMemo<WorkspaceAccessState>(() => ({
    user,
    workspace,
    membership,
    subscription,
    creditAccount,
    workspaceOptions,
    userProfile,
    loading,
    error,
    can: (permission) => allowsWorkspacePermission(membership, permission),
    refresh,
    switchWorkspace,
  }), [user, workspace, membership, subscription, creditAccount, workspaceOptions, userProfile, loading, error, refresh, switchWorkspace])

  return <WorkspaceAccessContext.Provider value={value}>{children}</WorkspaceAccessContext.Provider>
}

export function useWorkspaceAccess() {
  const value = useContext(WorkspaceAccessContext)
  if (!value) throw new Error("useWorkspaceAccess must be used inside WorkspaceAccessProvider")
  return value
}
