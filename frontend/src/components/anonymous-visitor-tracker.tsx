import { useEffect } from "react"

const apiUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "")
const key = "chanax-anonymous-visitor-id"

/** Counts a browser once per day across the whole public or signed-in site. */
export function AnonymousVisitorTracker() {
  useEffect(() => {
    if (!apiUrl) return
    let visitorId = localStorage.getItem(key)
    if (!visitorId) { visitorId = crypto.randomUUID(); localStorage.setItem(key, visitorId) }
    void fetch(`${apiUrl}/api/v1/analytics/visit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitor_id: visitorId }) }).catch(() => undefined)
  }, [])
  return null
}
