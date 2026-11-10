import { supabase } from "@/lib/supabase"

const apiUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "")

async function accountRequest<T>(path: string, body: unknown): Promise<T> {
  if (!apiUrl) throw new Error("Phone verification is temporarily unavailable. Please try again shortly.")
  if (!supabase) throw new Error("Phone verification is temporarily unavailable. Please try again shortly.")
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("Your session has expired. Please sign in again.")
  let response: Response
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("We couldn't connect to ChanaX. Check your internet connection and try again.")
  }
  let payload: { detail?: unknown; message?: string; phone?: string } = {}
  try { payload = await response.json() } catch { /* empty body */ }
  if (!response.ok) {
    const detail = Array.isArray(payload.detail)
      ? String((payload.detail[0] as { msg?: string } | undefined)?.msg || "").replace(/^Value error,\s*/i, "")
      : typeof payload.detail === "string" ? payload.detail : ""
    throw new Error(detail || "Something went wrong. Please try again.")
  }
  return payload as T
}

/** Sends a 6-digit code to the number on WhatsApp. */
export function sendPhoneCode(phone: string) {
  return accountRequest<{ message: string }>("/api/v1/account/phone/send-code", { phone })
}

/** Confirms the code; on success the profile phone is marked verified. */
export function verifyPhoneCode(phone: string, code: string) {
  return accountRequest<{ phone: string }>("/api/v1/account/phone/verify", { phone, code })
}

async function publicAccountRequest<T>(path: string, body: unknown): Promise<T> {
  if (!apiUrl) throw new Error("Phone sign-in is temporarily unavailable. Please sign in with your email.")
  let response: Response
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("We couldn't connect to ChanaX. Check your internet connection and try again.")
  }
  let payload: { detail?: unknown } & Record<string, unknown> = {}
  try { payload = await response.json() } catch { /* empty body */ }
  if (!response.ok) {
    const detail = Array.isArray(payload.detail)
      ? String((payload.detail[0] as { msg?: string } | undefined)?.msg || "").replace(/^Value error,\s*/i, "")
      : typeof payload.detail === "string" ? payload.detail : ""
    throw new Error(detail || "Something went wrong. Please try again.")
  }
  return payload as T
}

/** Signed out: WhatsApp a sign-in code to a phone number verified on a ChanaX account. */
export function sendPhoneLoginCode(phone: string) {
  return publicAccountRequest<{ message: string }>("/api/v1/account/phone-login/send-code", { phone })
}

/** Signed out: exchange the code for a one-time token, then start the session. */
export async function signInWithPhoneCode(phone: string, code: string) {
  if (!supabase) throw new Error("Sign-in is temporarily unavailable. Please try again later.")
  const { token_hash } = await publicAccountRequest<{ token_hash: string }>("/api/v1/account/phone-login/verify", { phone, code })
  const { error } = await supabase.auth.verifyOtp({ token_hash, type: "magiclink" })
  if (error) throw new Error("We couldn't sign you in. Please request a new code.")
}
