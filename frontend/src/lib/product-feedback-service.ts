import { customerErrorMessage } from "@/lib/customer-errors"
import { supabase } from "@/lib/supabase"

export type ProductFeedbackType = "general" | "bug" | "feature"

type ProductFeedbackInput = {
  workspaceId: string | null
  workspaceName: string | null
  feedbackType: ProductFeedbackType
  rating: number | null
  message: string
}

export async function submitProductFeedback(input: ProductFeedbackInput) {
  if (!supabase) throw new Error("Your account connection is temporarily unavailable. Please try again later.")
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error("Sign in again before sending feedback.")

  const { error } = await supabase.from("breezy_product_feedback").insert({
    user_id: userData.user.id,
    user_email: userData.user.email || null,
    workspace_id: input.workspaceId,
    workspace_name: input.workspaceName,
    feedback_type: input.feedbackType,
    rating: input.rating,
    message: input.message.trim(),
    page_path: window.location.pathname,
    browser_details: window.navigator.userAgent.slice(0, 500),
  })
  if (error) throw new Error(customerErrorMessage(error))
}
