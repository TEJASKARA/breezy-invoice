import { useEffect, useRef } from "react"
import { useLocation } from "react-router-dom"

import { setUsageContext, trackPageView } from "@/lib/usage-tracking"
import { useWorkspaceAccess } from "@/lib/workspace-access"

/** Records one page view per page visit for the developer usage dashboard. Renders nothing. */
export function UsageTracker() {
  const { user, workspace, loading } = useWorkspaceAccess()
  const { pathname } = useLocation()
  const lastTracked = useRef("")
  const userId = user?.id ?? null
  const workspaceId = workspace?.id ?? null

  useEffect(() => {
    setUsageContext(userId, workspaceId)
  }, [userId, workspaceId])

  useEffect(() => {
    if (!userId || loading) return
    if (pathname.startsWith("/platform-admin")) return
    const key = `${userId}:${workspaceId}:${pathname}`
    if (lastTracked.current === key) return
    lastTracked.current = key
    setUsageContext(userId, workspaceId)
    trackPageView(pathname)
  }, [pathname, userId, workspaceId, loading])

  return null
}
