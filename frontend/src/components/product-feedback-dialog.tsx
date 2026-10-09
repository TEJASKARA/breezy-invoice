import { customerErrorMessage } from "@/lib/customer-errors"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Bug, CheckCircle2, Lightbulb, MessageSquareText, Star, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { submitProductFeedback, type ProductFeedbackType } from "@/lib/product-feedback-service"

type ProductFeedbackDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string | null
  workspaceName: string | null
}

const feedbackTypes: Array<{ value: ProductFeedbackType; label: string; description: string; icon: typeof MessageSquareText }> = [
  { value: "general", label: "General feedback", description: "Tell us about your experience", icon: MessageSquareText },
  { value: "bug", label: "Report a bug", description: "Tell us what went wrong", icon: Bug },
  { value: "feature", label: "Request a feature", description: "Suggest something useful", icon: Lightbulb },
]

export function ProductFeedbackDialog({ open, onOpenChange, workspaceId, workspaceName }: ProductFeedbackDialogProps) {
  const [feedbackType, setFeedbackType] = useState<ProductFeedbackType>("general")
  const [rating, setRating] = useState<number | null>(null)
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [submitted, setSubmitted] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setError("")
      setSubmitted(false)
    }
    onOpenChange(nextOpen)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (message.trim().length < 5) {
      setError("Please enter at least 5 characters.")
      return
    }
    setSaving(true)
    setError("")
    try {
      await submitProductFeedback({ workspaceId, workspaceName, feedbackType, rating, message })
      setSubmitted(true)
      setMessage("")
      setRating(null)
      setFeedbackType("general")
    } catch (value) {
      setError(customerErrorMessage(value, "Your feedback could not be sent. Please try again."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby="product-feedback-description"
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-background p-6 shadow-2xl outline-none sm:p-8"
        >
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <MessageSquareText className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-xl font-semibold tracking-tight">Share feedback</DialogPrimitive.Title>
              <DialogPrimitive.Description id="product-feedback-description" className="mt-1 text-sm text-muted-foreground">
                Tell us how ChanaX is working for you, report a problem, or suggest a feature.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild><Button type="button" size="icon" variant="ghost" aria-label="Close feedback form"><X /></Button></DialogPrimitive.Close>
          </div>

          {submitted ? (
            <div className="mt-8 rounded-xl border bg-muted/30 p-6 text-center">
              <CheckCircle2 className="mx-auto size-9 text-emerald-600" />
              <p className="mt-3 font-semibold">Thank you for helping us improve ChanaX.</p>
              <p className="mt-1 text-sm text-muted-foreground">Your feedback has been received.</p>
              <Button className="mt-5" onClick={() => handleOpenChange(false)}>Done</Button>
            </div>
          ) : (
            <form className="mt-7 space-y-6" onSubmit={submit}>
              <fieldset>
                <legend className="text-sm font-medium">What would you like to share?</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {feedbackTypes.map(({ value, label, description, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={feedbackType === value}
                      onClick={() => setFeedbackType(value)}
                      className={cn(
                        "rounded-xl border p-3 text-left transition-colors",
                        feedbackType === value ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      <span className="mt-3 block text-sm font-medium">{label}</span>
                      <span className="mt-1 block text-xs leading-4 text-muted-foreground">{description}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-medium">How would you rate your experience? <span className="font-normal text-muted-foreground">Optional</span></legend>
                <div className="mt-2 flex gap-1" aria-label="Product rating">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} out of 5 stars`} aria-pressed={rating === value} className="rounded-md p-1.5 hover:bg-muted">
                      <Star className={cn("size-6", rating !== null && value <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/45")} />
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="product-feedback-message">Your message</Label>
                <textarea
                  id="product-feedback-message"
                  required
                  minLength={5}
                  maxLength={4000}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="flex min-h-32 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  placeholder={feedbackType === "bug" ? "What happened, and what were you trying to do?" : feedbackType === "feature" ? "What would you like ChanaX to help you do?" : "Tell us what worked well or what we can improve."}
                />
                <div className="flex justify-between text-xs text-muted-foreground"><span>Your signed-in email will be included.</span><span>{message.length}/4000</span></div>
              </div>

              {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p> : null}

              <div className="flex justify-end gap-2">
                <DialogPrimitive.Close asChild><Button type="button" variant="outline">Cancel</Button></DialogPrimitive.Close>
                <Button type="submit" disabled={saving}>{saving ? "Sending feedback..." : "Send feedback"}</Button>
              </div>
            </form>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
