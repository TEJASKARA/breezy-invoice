import { supabase } from "@/lib/supabase"

const apiUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "")

function base64Bytes(bytes: Uint8Array) {
  let binary = ""
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function sendEmployeeLetterEmail(input: {
  workspaceId: string
  letterId: string
  toEmail: string
  employeeName: string
  subject: string
  message: string
  filename: string
  pdf: Uint8Array
}) {
  if (!apiUrl) throw new Error("The ChanaX backend URL has not been configured.")
  if (!supabase) throw new Error("Supabase is not configured.")
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("Sign in again before emailing an employee letter.")
  const response = await fetch(`${apiUrl}/api/v1/documents/employee-letter-email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      letter_id: input.letterId,
      to_email: input.toEmail,
      employee_name: input.employeeName,
      subject: input.subject,
      message: input.message,
      filename: input.filename,
      pdf_base64: base64Bytes(input.pdf),
    }),
  })
  let payload: { detail?: string; message?: string } = {}
  try { payload = await response.json() as typeof payload } catch { /* Empty provider response. */ }
  if (!response.ok) throw new Error(payload.detail || "The employee letter email could not be sent.")
  return payload.message || `The letter was emailed to ${input.toEmail}.`
}

export async function sendDocumentEmail(input: {
  workspaceId: string
  documentId: string
  toEmail: string
  documentType: "invoice" | "quotation"
  documentNumber: string
  subject: string
  message: string
  filename: string
  pdf: Uint8Array
}) {
  if (!apiUrl) throw new Error("The ChanaX backend URL has not been configured.")
  if (!supabase) throw new Error("Supabase is not configured.")
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("Sign in again before emailing this document.")
  const response = await fetch(`${apiUrl}/api/v1/documents/document-email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      document_id: input.documentId,
      to_email: input.toEmail,
      document_type: input.documentType,
      document_number: input.documentNumber,
      subject: input.subject,
      message: input.message,
      filename: input.filename,
      pdf_base64: base64Bytes(input.pdf),
    }),
  })
  let payload: { detail?: string; message?: string } = {}
  try { payload = await response.json() as typeof payload } catch { /* Empty provider response. */ }
  if (!response.ok) throw new Error(payload.detail || "The document email could not be sent.")
  return payload.message || `The document was emailed to ${input.toEmail}.`
}
