type ErrorReport = {
  target_workspace_id: string | null
  customer_message: string
  diagnostic: string
  error_code: string
  page_path: string
}
let workspaceId: string | null = null
let sink: ((report: ErrorReport) => Promise<void>) | null = null
const recent = new Map<string, number>()
export function setErrorWorkspace(id: string | null) { workspaceId = id }
export function configureErrorReporting(handler: (report: ErrorReport) => Promise<void>) { sink = handler }
export function redactDiagnostic(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, '[URL]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[email]')
    .replace(/\beyJ[A-Za-z0-9_.-]+/g, '[token]')
    .replace(/((?:password|secret|token|api[_ -]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 1500)
}
export function isUnexpectedError(error: unknown): boolean {
  const value = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown; status?: number } : null
  const message = typeof error === 'string' ? error : String(value?.message || '')
  const code = String(value?.code || '')
  if (['23503', '23505', '23502', '23514', '42501', 'P0001'].includes(code)) return false
  if (/invalid login|email not confirmed|session.*expired|jwt.*expired|foreign key constraint|row.level security|permission denied|already registered|already exists/i.test(message)) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  return (value?.status ?? 0) >= 500 || /^(PGRST|42|XX|08)/.test(code)
    || error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError
    || /schema cache|supabase|database error|syntax error|cannot read properties|is not a function|failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(message)
}
export function reportUnexpectedError(error: unknown, customerMessage: string): void {
  if (!sink || !isUnexpectedError(error)) return
  const value = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown; status?: unknown } : null
  const diagnostic = redactDiagnostic(typeof error === 'string' ? error : String(value?.message || 'Unexpected runtime error'))
  const code = String(value?.code || value?.status || '').slice(0, 40)
  const path = typeof window === 'undefined' ? '' : window.location.pathname
  const key = JSON.stringify([workspaceId, diagnostic, code, path])
  const now = Date.now()
  for (const [id, time] of recent) if (now - time > 60_000) recent.delete(id)
  if (recent.has(key)) return
  recent.set(key, now)
  const handler = sink
  void Promise.resolve().then(() => handler({
    target_workspace_id: workspaceId, customer_message: redactDiagnostic(customerMessage),
    diagnostic, error_code: code, page_path: path.slice(0, 300),
  })).catch(() => {})
}
