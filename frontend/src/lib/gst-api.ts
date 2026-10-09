import { customerErrorMessage } from "@/lib/customer-errors"
import { supabase } from "@/lib/supabase"
import { trackAction } from "@/lib/usage-tracking"

const apiUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "")

export type GstVerification = {
  gstin: string
  pan: string
  provider: "whitebooks"
  cached: boolean
  workspace_verified: boolean
  legal_name: string
  trade_name: string
  registration_status: string
  billing_address: string
  premises_address: string
  data: Record<string, unknown>
}

export async function verifyGstin(gstin: string, workspaceId: string): Promise<GstVerification> {
  if (!apiUrl) throw new Error("This service is temporarily unavailable. Please try again later.")
  if (!supabase) throw new Error("Your account connection is temporarily unavailable. Please try again later.")
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("Sign in again to verify this GSTIN.")
  const query = new URLSearchParams({ gstin: gstin.trim().toUpperCase(), workspace_id: workspaceId })
  const response = await fetch(`${apiUrl}/api/v1/gst/verify?${query}`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? String((payload as { detail?: unknown }).detail || "")
      : ""
    throw new Error(customerErrorMessage(detail, "GSTIN verification could not be completed."))
  }
  trackAction("gstin_verified")
  return payload as GstVerification
}
