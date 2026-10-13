type Session = { access_token: string; user: { id: string } }
type Dependencies = {
  getSession: () => Promise<Session | null>
  fetch: typeof fetch
  now: () => number
}

/** Session-level throttling only; server-side claims enforce one email per user. */
export function createWelcomeRequester(apiUrl: string, dependencies: Dependencies) {
  const attempts = new Map<string, number>()
  return async (userId: string) => {
    if (!apiUrl || !userId) return
    const previous = attempts.get(userId)
    if (previous !== undefined && dependencies.now() - previous < 10 * 60_000) return
    attempts.set(userId, dependencies.now())
    try {
      const session = await dependencies.getSession()
      if (!session || session.user.id !== userId) return
      await dependencies.fetch(`${apiUrl.replace(/\/$/, "")}/api/v1/account/welcome`, {
        method: "POST", headers: { Authorization: `Bearer ${session.access_token}` },
      })
    } catch {
      // Welcome delivery never changes the successful signup/sign-in experience.
    }
  }
}
