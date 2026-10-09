import { customerErrorMessage } from "@/lib/customer-errors"
import { supabase } from "@/lib/supabase"
import { trackAction } from "@/lib/usage-tracking"
import { normalizeWhatsAppNumber } from "@/lib/whatsapp-number"

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
  if (!apiUrl) throw new Error("This service is temporarily unavailable. Please try again later.")
  if (!supabase) throw new Error("Your account connection is temporarily unavailable. Please try again later.")
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
  if (!response.ok) throw new Error(customerErrorMessage(payload.detail, "The employee letter email could not be sent."))
  trackAction("email_sent", { document: "employee_letter" })
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
  if (!apiUrl) throw new Error("This service is temporarily unavailable. Please try again later.")
  if (!supabase) throw new Error("Your account connection is temporarily unavailable. Please try again later.")
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
  if (!response.ok) throw new Error(customerErrorMessage(payload.detail, "The document email could not be sent."))
  trackAction("email_sent", { document: input.documentType })
  return payload.message || `The document was emailed to ${input.toEmail}.`
}

/** Sends the PDF to the recipient's WhatsApp through the ChanaX WhatsApp number (backend → n8n). */
export async function sendDocumentWhatsApp(input: {
  workspaceId: string
  documentId: string
  toNumber: string
  documentType: "invoice" | "quotation" | "payslip" | "employee_letter"
  documentNumber: string
  message: string
  senderCompanyName?: string
  recipientCompanyName?: string
  filename: string
  pdf: Uint8Array
}) {
  if (!apiUrl) throw new Error("This service is temporarily unavailable. Please try again later.")
  if (!supabase) throw new Error("Your account connection is temporarily unavailable. Please try again later.")
  const recipient = normalizeWhatsAppNumber(input.toNumber)
  if (!recipient) throw new Error("Enter a valid WhatsApp number with its country code.")
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("Sign in again before sending this document.")
  let response: Response
  try {
    response = await fetch(`${apiUrl}/api/v1/documents/document-whatsapp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        document_id: input.documentId,
        to_number: recipient,
        document_type: input.documentType,
        document_number: input.documentNumber,
        message: input.message,
        sender_company_name: input.senderCompanyName || "",
        recipient_company_name: input.recipientCompanyName || "",
        filename: input.filename,
        pdf_base64: base64Bytes(input.pdf),
      }),
    })
  } catch {
    throw new Error("We couldn't confirm the WhatsApp send because the connection was interrupted. Check whether it arrived before trying again.")
  }
  let payload: { success?: boolean; detail?: string | { msg?: string }[]; error?: string; message?: string } = {}
  try { payload = await response.json() as typeof payload } catch { /* Empty provider response. */ }
  if (!response.ok || payload.success === false) {
    const detail = Array.isArray(payload.detail)
      ? String(payload.detail[0]?.msg || "").replace(/^Value error,\s*/i, "")
      : payload.detail
    throw new Error(customerErrorMessage(detail || payload.error || (payload.success === false ? payload.message : undefined), "The document could not be sent on WhatsApp. Please try again."))
  }
  if (!payload.message) throw new Error("We couldn't confirm whether WhatsApp accepted this message. Check whether it arrived before trying again.")
  trackAction("whatsapp_sent", { document: input.documentType })
  return payload.message
}
