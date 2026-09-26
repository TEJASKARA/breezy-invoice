import { supabase } from "@/lib/supabase"

/**
 * Private product analytics for the ChanaX developer admin.
 * Events are batched and written to breezy_usage_events, which subscribers can
 * insert into (their own rows only) but never read. Tracking never throws and
 * never blocks the UI.
 */
type UsageEventType = "page_view" | "action"
type QueuedEvent = {
  user_id: string
  workspace_id: string | null
  event_type: UsageEventType
  event_name: string
  metadata: Record<string, string | number | boolean | null>
}

const FLUSH_DELAY_MS = 5000
const MAX_BATCH = 25
const context: { userId: string | null; workspaceId: string | null } = { userId: null, workspaceId: null }
let queue: QueuedEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let disabled = false
let listenersAttached = false

export function setUsageContext(userId: string | null, workspaceId: string | null) {
  if (context.userId && context.userId !== userId) void flushUsage()
  context.userId = userId
  context.workspaceId = workspaceId
  attachListeners()
}

export function trackPageView(path: string) {
  enqueue("page_view", normalizePath(path), {})
}

export function trackAction(name: string, metadata: QueuedEvent["metadata"] = {}) {
  enqueue("action", name, metadata)
}

function normalizePath(path: string) {
  const clean = path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/"
  return clean.slice(0, 80)
}

function enqueue(eventType: UsageEventType, eventName: string, metadata: QueuedEvent["metadata"]) {
  if (disabled || !supabase || !context.userId || !eventName) return
  queue.push({
    user_id: context.userId,
    workspace_id: context.workspaceId,
    event_type: eventType,
    event_name: eventName.slice(0, 80),
    metadata,
  })
  if (queue.length >= MAX_BATCH) void flushUsage()
  else if (!timer) timer = setTimeout(() => void flushUsage(), FLUSH_DELAY_MS)
}

export async function flushUsage() {
  if (timer) { clearTimeout(timer); timer = null }
  if (!queue.length || !supabase || disabled) return
  const batch = queue
  queue = []
  try {
    const { error } = await supabase.from("breezy_usage_events").insert(batch)
    // Table not deployed yet: stop trying for this session instead of erroring on every page.
    if (error && ["42P01", "PGRST205", "42501"].includes(error.code)) disabled = true
  } catch {
    // Analytics must never affect the product.
  }
}

function attachListeners() {
  if (listenersAttached || typeof window === "undefined") return
  listenersAttached = true
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flushUsage() })
  window.addEventListener("pagehide", () => void flushUsage())
}
