/** Cloudflare Turnstile for sign-in. Off until VITE_TURNSTILE_SITE_KEY is set. */

// Optional chaining keeps this module importable in Node tests, where import.meta.env is undefined.
export const CAPTCHA_SITE_KEY: string = String(import.meta.env?.VITE_TURNSTILE_SITE_KEY ?? "").trim()
export const captchaEnabled = CAPTCHA_SITE_KEY.length > 0

/** Options spread into supabase.auth calls. Empty when there is no token, so behaviour is unchanged. */
export function captchaOptions(token: string | null | undefined): { captchaToken?: string } {
  const value = String(token ?? "").trim()
  return value ? { captchaToken: value } : {}
}

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
let loading: Promise<TurnstileApi> | null = null

export function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("No browser."))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error("Security check unavailable."))
    script.onerror = () => { loading = null; reject(new Error("Security check could not load.")) }
    document.head.appendChild(script)
  })
  return loading
}
