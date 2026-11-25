import { customerErrorMessage } from "@/lib/customer-errors"
import { supabase } from "@/lib/supabase"

const bucket = "expense-bills"

function storage() {
  if (!supabase) throw new Error("Your account connection is temporarily unavailable. Please try again later.")
  return supabase.storage.from(bucket)
}

const apiUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "")

function base64Bytes(bytes: Uint8Array) {
  let binary = ""
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

/**
 * Bills are checked on the server (real file type, scripts, damaged images) before they
 * are stored; the browser can no longer write to the bill storage directly.
 */
export async function uploadExpenseBill(workspaceId: string, file: File) {
  if (!apiUrl) throw new Error("This service is temporarily unavailable. Please try again later.")
  if (!supabase) throw new Error("Your account connection is temporarily unavailable. Please try again later.")
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("Sign in again before uploading a bill.")
  const response = await fetch(`${apiUrl}/api/v1/expense-bills`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      file_name: file.name,
      data_base64: base64Bytes(new Uint8Array(await file.arrayBuffer())),
    }),
  })
  let payload: { path?: string; file_name?: string; detail?: unknown } | null = null
  try { payload = await response.json() } catch { /* handled below */ }
  if (!response.ok || !payload?.path) {
    const detail = typeof payload?.detail === "string" ? payload.detail : ""
    throw new Error(response.status === 429 ? "Too many uploads. Please wait a minute and try again." : detail || "The bill could not be uploaded. Please try again.")
  }
  return { path: payload.path, fileName: payload.file_name || file.name }
}

export async function downloadExpenseBill(path: string, fileName: string) {
  const { data, error } = await storage().download(path)
  if (error) throw new Error(customerErrorMessage(error))
  const url = URL.createObjectURL(data)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName || "expense-bill"
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function getExpenseBillFile(path: string) {
  const { data, error } = await storage().download(path)
  if (error) throw new Error(customerErrorMessage(error))
  return new Uint8Array(await data.arrayBuffer())
}

export async function removeExpenseBill(path: string) {
  const { error } = await storage().remove([path])
  if (error) throw new Error(customerErrorMessage(error))
}
