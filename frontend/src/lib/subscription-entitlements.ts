import type { WorkspaceSubscription } from "@/lib/workspace-access-service"

export function canRemoveChanaxBranding(subscription: WorkspaceSubscription | null | undefined) {
  return subscription?.status === "active" && subscription.plan_key !== "free"
}
