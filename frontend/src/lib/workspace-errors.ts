export function friendlyWorkspaceError(error: { code?: string; message: string }) {
  const missingWorkspaceFunction = error.code === "PGRST202" || error.message.includes("breezy_ensure_my_workspace")
  const missingInvitationDependency = error.message.includes("breezy_accept_pending_invitations")

  if (missingWorkspaceFunction || missingInvitationDependency) {
    return "Your workspace needs a small database update. Please ask the BreezyInvoice administrator to run the latest workspace recovery migration."
  }

  return error.message
}
