import { customerErrorMessage } from "@/lib/customer-errors"
import { supabase } from "@/lib/supabase"

const apiUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "")

export type BillingPlanKey =
  | "monthly"
  | "quarterly"
  | "annual"
  | "custom_monthly"
  | "custom_quarterly"
  | "custom_annual"

export type CustomPlanUsage = {
  monthlyInvoices: number
  employees: number
}

export type BillingOrder = {
  order_id: string
  key_id: string
  amount: number
  base_amount_paise: number
  gst_amount_paise: number
  gst_rate_percent: number
  currency: "INR"
  plan_key: BillingPlanKey
  plan_name: string
  credits: number
  quotation_credits: number
  duration_months: number
  estimated_monthly_invoices: number | null
  estimated_employees: number | null
}

export type BillingPayment = {
  id: string
  plan_key: string
  amount_paise: number
  currency: string
  credits: number
  duration_months: number
  estimated_monthly_invoices: number | null
  estimated_employees: number | null
  status: string
  provider_order_id: string
  provider_payment_id: string | null
  paid_at: string | null
  created_at: string
}

type RazorpaySuccess = {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

type RazorpayOptions = {
  key: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  prefill?: { name?: string; email?: string }
  theme?: { color?: string }
  handler: (response: RazorpaySuccess) => void | Promise<void>
  modal?: { ondismiss?: () => void }
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void; on: (event: string, handler: (response: unknown) => void) => void }
  }
}

async function sessionToken() {
  if (!apiUrl) throw new Error("This service is temporarily unavailable. Please try again later.")
  if (!supabase) throw new Error("Your account connection is temporarily unavailable. Please try again later.")
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("Sign in again to manage billing.")
  return data.session.access_token
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await sessionToken()
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })
  let payload: unknown = null
  try { payload = await response.json() } catch { /* handled below */ }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? String((payload as { detail?: unknown }).detail || "")
      : ""
    throw new Error(customerErrorMessage({ message: detail, status: response.status }, "The billing request could not be completed."))
  }
  return payload as T
}

export async function createBillingOrder(workspaceId: string, planKey: BillingPlanKey, usage?: CustomPlanUsage) {
  return apiRequest<BillingOrder>("/api/v1/billing/orders", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      plan_key: planKey,
      monthly_invoices: usage?.monthlyInvoices,
      employees: usage?.employees,
    }),
  })
}

export async function verifyBillingPayment(workspaceId: string, payment: RazorpaySuccess) {
  return apiRequest<{ success: boolean; already_processed: boolean; credits_added: number; quotation_credits_added: number }>("/api/v1/billing/verify", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId, ...payment }),
  })
}

export async function loadBillingHistory(workspaceId: string) {
  const query = new URLSearchParams({ workspace_id: workspaceId })
  const result = await apiRequest<{ payments: BillingPayment[] }>(`/api/v1/billing/status?${query}`)
  return result.payments
}

let checkoutPromise: Promise<void> | null = null

export function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve()
  if (checkoutPromise) return checkoutPromise
  checkoutPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://checkout.razorpay.com/v1/checkout.js"
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      checkoutPromise = null
      reject(new Error("Razorpay Checkout could not be loaded. Check your connection and try again."))
    }
    document.head.appendChild(script)
  })
  return checkoutPromise
}

export function openRazorpayCheckout(options: RazorpayOptions) {
  if (!window.Razorpay) throw new Error("Razorpay Checkout is not available.")
  const checkout = new window.Razorpay(options)
  checkout.open()
}
