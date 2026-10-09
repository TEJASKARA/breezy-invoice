const defaultMessage = "We couldn't complete this action. Please try again. If it keeps happening, contact ChanaX support."
const technicalDetails = /supabase|schema|\bsql(?:state)?\b|pgrst\d*|breezy_\w+|\bpostgres(?:ql)?\b|\b(?:public|auth|storage)\.[a-z_]\w*|\b(?:foreign key|unique|exclusion|check|not-null) constraint\b|violates .*constraint|row.level security|\brls\b|permission denied for|relation .+ does not exist|column .+ does not exist|on conflict|prepared statement|transaction is aborted|syntax error|database|migration|\.env\b|vite_\w+|backend url|api[_ -]?key|client secret|access token|stack trace|traceback|cannot read properties|is not a function|unexpected token|\[object object\]|https?:\/\//i

import { reportUnexpectedError } from './error-reporting.ts'

export function customerErrorMessage(error: unknown, fallback = defaultMessage): string {
  const message = formatCustomerError(error, fallback)
  reportUnexpectedError(error, message)
  return message
}

/** Customer-facing copy only. Never render raw infrastructure errors. */
function formatCustomerError(error: unknown, fallback = defaultMessage): string {
  const safeFallback = technicalDetails.test(fallback) ? defaultMessage : fallback
  const value = error && typeof error === "object" ? error as { message?: unknown; code?: unknown } : null
  const message = typeof error === "string" ? error : typeof value?.message === "string" ? value.message : ""
  const code = typeof value?.code === "string" ? value.code : ""

  if (import.meta.env?.DEV && (technicalDetails.test(message) || code)) {
    console.error("[ChanaX] Action failed", { code, message })
  }
  // Translate common conditions; retain useful application validation messages.
  if (/gst(?:in| number).*(?:already|registered|existing)/i.test(message) && !technicalDetails.test(message)) {
    return "This GST number is already registered in ChanaX. Use the existing account or request access from its owner."
  }
  if (code === "23503" || /foreign key constraint/i.test(message)) {
    return "This record is linked to other records and can't be removed on its own. Review those links first."
  }
  if (code === "23505" && !/gst/i.test(message)) return "This record already exists. Check your existing records before adding it again."
  if (code === "42501" || /row.level security|permission denied for/i.test(message)) {
    return "You don't have permission to do this. Ask the workspace owner to review your access."
  }
  if (/invalid login credentials/i.test(message)) return "The email or password is incorrect. Please check and try again."
  if (/email not confirmed/i.test(message)) return "Please confirm your email address before signing in."
  if (/jwt|session.*expired|token.*expired/i.test(message)) return "Your session has expired. Please sign in again."
  if (/failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(message)) {
    return "We couldn't connect to ChanaX. Check your internet connection and try again."
  }
  if (technicalDetails.test(message) || /^PGRST/.test(code) || /^42/.test(code) || /^XX/.test(code)) return safeFallback
  if (code && /^\d{5}$/.test(code) && !["23505", "42501"].includes(code)) return safeFallback
  if (!message.trim() || message.length > 450) return safeFallback
  return message.trim()
}
