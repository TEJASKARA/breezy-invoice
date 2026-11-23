import { customerErrorMessage } from "@/lib/customer-errors"
import { setErrorWorkspace } from "@/lib/error-reporting"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { User } from "@supabase/supabase-js"

import { supabase } from "@/lib/supabase"
import { createWelcomeRequester } from "@/lib/welcome-email"
import { createWorkspaceLoadGuard } from "@/lib/workspace-context"
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
const requestWelcome = createWelcomeRequester(String(import.meta.env.VITE_API_URL || ""), {
  getSession: async () => {
    if (!supabase) return null
    const { data } = await supabase.auth.getSession()
    return data.session
  },
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
})

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
  const loadGuard = useRef(createWorkspaceLoadGuard())
  const identity = useRef<string | null>(null)
  const loadedWorkspaceId = useRef<string | null>(null)

  const hydrate = useCallback(async (nextUser: User | null, preferredWorkspaceId?: string | null) => {
    const isCurrent = loadGuard.current.begin()
    if (identity.current !== (nextUser?.id ?? null)) {
      identity.current = nextUser?.id ?? null
      setWorkspace(null); setMembership(null); setSubscription(null)
      setCreditAccount(null); setWorkspaceOptions([]); setUserProfile(null)
      loadedWorkspaceId.current = null
    }
    setUser(nextUser)
    if (!nextUser) {
      setErrorWorkspace(null)
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
    // A refresh after saving (same user, same workspace) updates credits and
    // access in the background. Showing the loading screen here would unmount
    // the page the user is working on and look like a full page reload.
    const background = Boolean(loadedWorkspaceId.current) && (!preferredWorkspaceId || preferredWorkspaceId === loadedWorkspaceId.current)
    if (!background) setLoading(true)
    try {
      const storageKey = `chanax-active-workspace:${nextUser.id}`
      let preferred = preferredWorkspaceId
      if (!preferred) { try { preferred = window.localStorage.getItem(storageKey) || undefined } catch { /* Use the deterministic default when storage is unavailable. */ } }
      setErrorWorkspace(preferred ?? null)
      const next = await loadWorkspaceAccess(nextUser, preferred)
      if (!isCurrent()) return
      setErrorWorkspace(next.workspace?.id ?? null)
      setWorkspace(next.workspace)
      setMembership(next.membership)
      setSubscription(next.subscription)
      setCreditAccount(next.creditAccount)
      setWorkspaceOptions(next.workspaceOptions)
      setUserProfile(next.userProfile)
      loadedWorkspaceId.current = next.workspace?.id ?? null
      if (next.workspace?.id) { try { window.localStorage.setItem(storageKey, next.workspace.id) } catch { /* The selected workspace remains valid in memory. */ } }
      setError(null)
    } catch (accessError) {
      if (!isCurrent() || background) return
      setError(customerErrorMessage(accessError, "Workspace access could not be loaded."))
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!supabase) { setLoading(false); setError("Your account connection is temporarily unavailable. Please try again later."); return }
    // The stored session is read locally (no network round trip); every data
    // request is still checked by the database's row-level security.
    void supabase.auth.getSession().then(({ data }) => hydrate(data.session?.user ?? null))
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Token refreshes commonly occur when the browser regains focus. They do
      // not change workspace access, and rehydrating here unmounts the page.
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return
      queueMicrotask(() => void hydrate(session?.user ?? null))
    })
    return () => { loadGuard.current.invalidate(); data.subscription.unsubscribe() }
  }, [hydrate])

  const refresh = useCallback(async () => { await hydrate(user) }, [hydrate, user])
  useEffect(() => {
    if (!loading && !error && user?.email_confirmed_at) void requestWelcome(user.id)
  }, [loading, error, user?.id, user?.email_confirmed_at])
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

const guestWorkspace: Workspace = { id: "guest", owner_user_id: "guest", name: "Free tools", subscription_code: "", status: "active", created_at: new Date(0).toISOString() }
const guestMembership: WorkspaceMembership = { id: "guest", workspace_id: "guest", user_id: "guest", role: "owner", permissions: [], status: "active", joined_at: null }

/** Free tools (not signed in): full access to a workspace that lives only in this browser. */
export function GuestWorkspaceAccessProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<WorkspaceAccessState>(() => ({
    user: null,
    workspace: guestWorkspace,
    membership: guestMembership,
    subscription: null,
    creditAccount: null,
    workspaceOptions: [],
    userProfile: null,
    loading: false,
    error: null,
    can: () => true,
    refresh: async () => undefined,
    switchWorkspace: async () => undefined,
  }), [])
  return <WorkspaceAccessContext.Provider value={value}>{children}</WorkspaceAccessContext.Provider>
}

export function useWorkspaceAccess() {
  const value = useContext(WorkspaceAccessContext)
  if (!value) throw new Error("useWorkspaceAccess must be used inside WorkspaceAccessProvider")
  return value
}
