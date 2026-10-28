import { useState, type ReactNode } from "react"

import { PostSignupPhoneDialog } from "@/components/post-signup-phone-dialog"
import { useWorkspaceAccess } from "@/lib/workspace-access"

export function PostSignupPhoneGate({ children }: { children: ReactNode }) {
  const { user, loading } = useWorkspaceAccess()
  const [phonePending, setPhonePending] = useState(true)

  if (loading) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading your account…</div>

  return (
    <>
      <PostSignupPhoneDialog user={user} onPendingChange={setPhonePending} />
      {phonePending ? <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Finishing account setup…</div> : children}
    </>
  )
}
