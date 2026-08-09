import { type ReactNode, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { ThemeContext, type ResolvedTheme, type Theme } from "@/lib/theme"

const storageKey = "breezyaccounts-theme"

function storedTheme(): Theme {
  const saved = localStorage.getItem(storageKey)
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system"
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(storedTheme)
  const [preferredTheme, setPreferredTheme] = useState<ResolvedTheme>(systemTheme)
  const resolvedTheme = theme === "system" ? preferredTheme : theme

  useEffect(() => {
    if (theme !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const updateSystemTheme = (event: MediaQueryListEvent) => setPreferredTheme(event.matches ? "dark" : "light")
    setPreferredTheme(media.matches ? "dark" : "light")
    media.addEventListener("change", updateSystemTheme)
    return () => media.removeEventListener("change", updateSystemTheme)
  }, [theme])

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark")
    document.documentElement.style.colorScheme = resolvedTheme
    localStorage.setItem(storageKey, theme)
  }, [resolvedTheme, theme])

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
