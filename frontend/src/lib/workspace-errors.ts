import { customerErrorMessage } from "@/lib/customer-errors"

export function friendlyWorkspaceError(error: { code?: string; message: string }) {
  return customerErrorMessage(error, "We couldn't open your workspace. Please try again. If the problem continues, contact ChanaX support.")
}
