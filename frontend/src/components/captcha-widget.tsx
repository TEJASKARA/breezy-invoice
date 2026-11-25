import { useEffect, useRef } from "react"

import { CAPTCHA_SITE_KEY, captchaEnabled, loadTurnstile } from "@/lib/captcha"

type Props = {
  /** Called with a fresh token when the check passes, and with "" when it expires or fails. */
  onToken: (token: string) => void
  /** Change this number to ask for a new check (a token can only be used once). */
  resetKey: number
}

/** Cloudflare Turnstile check. Renders nothing when no site key is configured. */
export function CaptchaWidget({ onToken, resetKey }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | undefined>(undefined)
  const callback = useRef(onToken)
  callback.current = onToken

  useEffect(() => {
    if (!captchaEnabled || !box.current) return
    let cancelled = false
    void loadTurnstile().then((turnstile) => {
      if (cancelled || !box.current) return
      widgetId.current = turnstile.render(box.current, {
        sitekey: CAPTCHA_SITE_KEY,
        theme: "light",
        callback: (token: string) => callback.current(token),
        "expired-callback": () => callback.current(""),
        "error-callback": () => callback.current(""),
      })
    }).catch(() => callback.current(""))
    return () => {
      cancelled = true
      if (widgetId.current) window.turnstile?.remove(widgetId.current)
      widgetId.current = undefined
    }
  }, [])

  useEffect(() => {
    if (resetKey > 0 && widgetId.current) window.turnstile?.reset(widgetId.current)
  }, [resetKey])

  if (!captchaEnabled) return null
  return <div ref={box} className="flex justify-center" />
}
