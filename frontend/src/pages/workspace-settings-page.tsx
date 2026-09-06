import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Calculator, CalendarDays, Check, Clipboard, Coins, CreditCard, Crown, KeyRound, MailPlus, Save, ShieldCheck, Trash2, UserCog, Users } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useMvpStore } from "@/lib/mvp-store"
import { supabase } from "@/lib/supabase"
import {
  useWorkspaceAccess,
} from "@/lib/workspace-access"
import {
  loadWorkspacePeople,
  loadWorkspaceCaAdministration,
  decideCaAccessRequest,
  permissionOptions,
  permissionsForRole,
  revokeWorkspaceInvitation,
  updateWorkspaceMember,
  type WorkspaceInvitation,
  type WorkspaceMember,
  type WorkspacePermission,
  type WorkspaceRole,
  type CaAccessRequest,
  type WorkspaceAuditEntry,
} from "@/lib/workspace-access-service"
import { sendWorkspaceInvitation } from "@/lib/team-api"
import {
  createBillingOrder,
  loadBillingHistory,
  loadRazorpayCheckout,
  openRazorpayCheckout,
  verifyBillingPayment,
  type BillingPayment,
  type BillingPlanKey,
  type CustomPlanUsage,
} from "@/lib/billing-api"

type EditableRole = Exclude<WorkspaceRole, "owner">
const editableRoles: { value: EditableRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "hr", label: "HR" },
  { value: "accountant", label: "Accountant" },
  { value: "viewer", label: "Viewer" },
  { value: "custom", label: "Custom" },
]
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const previewPlans = [
  { key: "monthly" as const, name: "Monthly", price: "₹100", term: "1 month", credits: 240, bonus: 20, seats: 3, description: "A flexible monthly plan with 20% additional credits." },
  { key: "quarterly" as const, name: "Quarterly", price: "₹300", term: "3 months", credits: 750, bonus: 25, seats: 3, description: "Three months of access with 25% additional credits.", recommended: true },
  { key: "annual" as const, name: "Annual", price: "₹1,200", term: "12 months", credits: 3120, bonus: 30, seats: 3, description: "A full year with the highest 30% additional-credit allowance." },
]
const customDurations = [
  { key: "custom_monthly" as const, label: "Monthly · 20% extra", months: 1, bonus: 20 },
  { key: "custom_quarterly" as const, label: "Quarterly · 25% extra", months: 3, bonus: 25 },
  { key: "custom_annual" as const, label: "Annual · 30% extra", months: 12, bonus: 30 },
]

function currency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value)
}

function readableDate(value: string | null) {
  if (!value) return "Not set"
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value))
}

function PermissionChecklist({ selected, onChange, disabled = false }: { selected: WorkspacePermission[]; onChange: (next: WorkspacePermission[]) => void; disabled?: boolean }) {
  function toggle(permission: WorkspacePermission) {
    onChange(selected.includes(permission) ? selected.filter((item) => item !== permission) : [...selected, permission])
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {permissionOptions.map(({ permission, label }) => (
        <label key={permission} className="flex items-start gap-2 rounded-lg border bg-background p-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-foreground" checked={selected.includes(permission)} disabled={disabled} onChange={() => toggle(permission)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}

export function WorkspaceSettingsPage() {
  const { setup, completeSetup } = useMvpStore()
  const { user, workspace, membership, subscription, creditAccount, can, refresh } = useWorkspaceAccess()
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([])
  const [caAccessRequests, setCaAccessRequests] = useState<CaAccessRequest[]>([])
  const [auditEntries, setAuditEntries] = useState<WorkspaceAuditEntry[]>([])
  const [firmName, setFirmName] = useState(setup?.firmName || workspace?.name || "")
  const [industry, setIndustry] = useState(setup?.industry || "")
  const [hasGstin, setHasGstin] = useState(setup?.hasGstin ?? Boolean(setup?.gstin?.trim()))
  const [gstin, setGstin] = useState(setup?.gstin || "")
  const [mailingAddress, setMailingAddress] = useState(setup?.mailingAddress || "")
  const [leavePeriod, setLeavePeriod] = useState<"monthly" | "yearly">(setup?.leavePolicy?.period || "monthly")
  const [leaveAllowanceDays, setLeaveAllowanceDays] = useState(setup?.leavePolicy?.allowanceDays ?? 1)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<EditableRole>("viewer")
  const [invitePermissions, setInvitePermissions] = useState<WorkspacePermission[]>(permissionsForRole("viewer"))
  const [editingMember, setEditingMember] = useState<WorkspaceMember | null>(null)
  const [reviewingCaRequest, setReviewingCaRequest] = useState<CaAccessRequest | null>(null)
  const [caApprovalPermissions, setCaApprovalPermissions] = useState<WorkspacePermission[]>([])
  const [editRole, setEditRole] = useState<EditableRole>("viewer")
  const [editPermissions, setEditPermissions] = useState<WorkspacePermission[]>([])
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [deletionStage, setDeletionStage] = useState<0 | 1 | 2>(0)
  const [deletionConfirmation, setDeletionConfirmation] = useState("")
  const [deletionRequest, setDeletionRequest] = useState<{ status: string; purge_after: string } | null>(null)
  const [billingPayments, setBillingPayments] = useState<BillingPayment[]>([])
  const [purchasingPlan, setPurchasingPlan] = useState<BillingPlanKey | null>(null)
  const [customMonthlyInvoices, setCustomMonthlyInvoices] = useState("")
  const [customEmployees, setCustomEmployees] = useState("")
  const [customPlanKey, setCustomPlanKey] = useState<"custom_monthly" | "custom_quarterly" | "custom_annual">("custom_monthly")

  const canManageTeam = can("team.manage")
  const canManageWorkspace = can("workspace.manage")
  const isOwner = membership?.role === "owner"
  const documentCreditsRemaining = creditAccount
    ? Math.max(0, creditAccount.free_credits_granted - creditAccount.free_credits_used) + creditAccount.monthly_credits_remaining + creditAccount.topup_credits_remaining
    : 10
  const quotationCreditsRemaining = creditAccount
    ? Math.max(0, (creditAccount.free_quotation_credits_granted ?? creditAccount.free_credits_granted) - (creditAccount.free_quotation_credits_used ?? 0))
      + (creditAccount.monthly_quotation_credits_remaining ?? creditAccount.monthly_credits_remaining)
      + (creditAccount.topup_quotation_credits_remaining ?? creditAccount.topup_credits_remaining)
    : 10
  const customInvoiceCount = Math.max(0, Math.floor(Number(customMonthlyInvoices) || 0))
  const customEmployeeCount = Math.max(0, Math.floor(Number(customEmployees) || 0))
  const customExpectedDocuments = customInvoiceCount + customEmployeeCount
  const customDuration = customDurations.find((duration) => duration.key === customPlanKey) || customDurations[0]
  const customMonths = customDuration.months
  const customBonusPercent = customDuration.bonus
  const customRawMonthlyPrice = customExpectedDocuments * 0.4
  const customMonthlyPrice = customExpectedDocuments > 0 ? Math.max(100, customRawMonthlyPrice) : 0
  const customTotalCredits = Math.ceil(customExpectedDocuments * customMonths * (1 + customBonusPercent / 100))
  const customTotalPrice = customMonthlyPrice * customMonths

  useEffect(() => {
    setFirmName(setup?.firmName || workspace?.name || "")
    setIndustry(setup?.industry || "")
    setHasGstin(setup?.hasGstin ?? Boolean(setup?.gstin?.trim()))
    setGstin(setup?.gstin || "")
    setMailingAddress(setup?.mailingAddress || "")
    setLeavePeriod(setup?.leavePolicy?.period || "monthly")
    setLeaveAllowanceDays(setup?.leavePolicy?.allowanceDays ?? 1)
  }, [setup, workspace?.id, workspace?.name])

  const loadPeople = useCallback(async () => {
    if (!workspace || !canManageTeam) return
    try {
      const people = await loadWorkspacePeople(workspace.id)
      setMembers(people.members)
      setInvitations(people.invitations)
      setError("")
    } catch (peopleError) {
      setError(peopleError instanceof Error ? peopleError.message : "Team access could not be loaded.")
    }
  }, [workspace, canManageTeam])

  const loadCaAdministration = useCallback(async () => {
    if (!workspace || !canManageTeam) return
    try {
      const result = await loadWorkspaceCaAdministration(workspace.id)
      setCaAccessRequests(result.requests)
      setAuditEntries(result.auditEntries)
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : "CA access activity could not be loaded.")
    }
  }, [workspace, canManageTeam])

  useEffect(() => { void loadPeople() }, [loadPeople])
  useEffect(() => { void loadCaAdministration() }, [loadCaAdministration])

  useEffect(() => {
    if (!workspace || !isOwner || !supabase) return
    void supabase.from("breezy_account_deletion_requests").select("status, purge_after").eq("workspace_id", workspace.id).eq("status", "pending").maybeSingle().then(({ data }) => setDeletionRequest(data))
  }, [workspace, isOwner])

  const refreshBillingHistory = useCallback(async () => {
    if (!workspace || !isOwner) return
    try {
      setBillingPayments(await loadBillingHistory(workspace.id))
    } catch {
      // The migration may not have been run yet. Checkout reports a clear
      // error if the owner attempts a purchase before billing is available.
      setBillingPayments([])
    }
  }, [workspace, isOwner])

  useEffect(() => { void refreshBillingHistory() }, [refreshBillingHistory])

  function showSuccess(message: string) { setNotice(message); setError("") }
  function showError(value: unknown) { setError(value instanceof Error ? value.message : "The change could not be saved."); setNotice("") }

  async function saveWorkspaceDetails(event: React.FormEvent) {
    event.preventDefault()
    if (!setup || !workspace) return
    const normalizedGstin = gstin.trim().toUpperCase()
    if (hasGstin && !gstinPattern.test(normalizedGstin)) {
      showError(new Error("Enter a valid 15-character GSTIN."))
      return
    }
    setSaving(true)
    try {
      if (isOwner && workspace.name !== firmName.trim()) {
        const { error: updateError } = await supabase!.from("breezy_workspaces").update({ name: firmName.trim() }).eq("id", workspace.id)
        if (updateError) throw new Error(updateError.message)
      }
      await completeSetup({ ...setup, firmName: firmName.trim(), industry: industry.trim(), hasGstin, gstin: hasGstin ? normalizedGstin : "", mailingAddress: mailingAddress.trim(), leavePolicy: { period: leavePeriod, allowanceDays: Math.max(0, leaveAllowanceDays) } })
      await refresh()
      showSuccess("Workspace details saved.")
    } catch (saveError) { showError(saveError) } finally { setSaving(false) }
  }

  async function sendInvitation(event: React.FormEvent) {
    event.preventDefault()
    if (!workspace) return
    setSaving(true)
    try {
      const result = await sendWorkspaceInvitation(workspace.id, inviteEmail, inviteRole, invitePermissions)
      setInviteEmail("")
      await loadPeople()
      showSuccess(result.message)
    } catch (inviteError) { showError(inviteError) } finally { setSaving(false) }
  }

  function beginEdit(member: WorkspaceMember) {
    if (member.role === "owner") return
    setEditingMember(member)
    setEditRole(member.role)
    setEditPermissions(member.permissions)
    setNotice("")
    setError("")
  }

  async function saveMember() {
    if (!workspace || !editingMember) return
    setSaving(true)
    try {
      await updateWorkspaceMember(workspace.id, editingMember.user_id, editRole, editPermissions, editingMember.status === "disabled" ? "disabled" : "active")
      setEditingMember(null)
      await loadPeople()
      showSuccess("Team member access updated.")
    } catch (memberError) { showError(memberError) } finally { setSaving(false) }
  }

  async function toggleMember(member: WorkspaceMember) {
    if (!workspace || member.role === "owner") return
    setSaving(true)
    try {
      await updateWorkspaceMember(workspace.id, member.user_id, member.role, member.permissions, member.status === "active" ? "disabled" : "active")
      await loadPeople()
      showSuccess(member.status === "active" ? "Team member access disabled." : "Team member access restored.")
    } catch (memberError) { showError(memberError) } finally { setSaving(false) }
  }

  async function revokeInvitation(invitationId: string) {
    if (!workspace) return
    try {
      await revokeWorkspaceInvitation(workspace.id, invitationId)
      await loadPeople()
      showSuccess("Pending invitation revoked.")
    } catch (invitationError) { showError(invitationError) }
  }

  function beginCaApproval(request: CaAccessRequest) {
    setReviewingCaRequest(request)
    setCaApprovalPermissions(request.requested_permissions)
    setNotice("")
    setError("")
  }

  async function reviewCaRequest(request: CaAccessRequest, approved: boolean, permissions = request.requested_permissions) {
    setSaving(true)
    try {
      await decideCaAccessRequest(request.id, approved, permissions)
      setReviewingCaRequest(null)
      await Promise.all([loadPeople(), loadCaAdministration()])
      showSuccess(approved ? `${request.requester_name} can now access this workspace.` : "CA access request rejected.")
    } catch (reviewError) { showError(reviewError) } finally { setSaving(false) }
  }

  async function copyCode() {
    if (!workspace) return
    try {
      await navigator.clipboard.writeText(workspace.subscription_code)
      showSuccess("Subscription code copied.")
    } catch (clipboardError) {
      showError(clipboardError instanceof Error ? clipboardError : new Error("The subscription code could not be copied. Select it and copy it manually."))
    }
  }

  async function purchasePlan(planKey: BillingPlanKey, usage?: CustomPlanUsage) {
    if (!workspace || !isOwner) return
    setPurchasingPlan(planKey)
    setNotice("")
    setError("")
    try {
      const [order] = await Promise.all([
        createBillingOrder(workspace.id, planKey, usage),
        loadRazorpayCheckout(),
      ])
      await new Promise<void>((resolve, reject) => {
        openRazorpayCheckout({
          key: order.key_id,
          amount: order.amount,
          currency: order.currency,
          name: "ChanaX",
          description: `${order.plan_name} · ${order.credits} document + ${order.quotation_credits} quotation credits`,
          order_id: order.order_id,
          prefill: {
            name: String(user?.user_metadata?.full_name || ""),
            email: user?.email || "",
          },
          theme: { color: "#0f172a" },
          handler: async (payment) => {
            try {
              const result = await verifyBillingPayment(workspace.id, payment)
              await Promise.all([refresh(), refreshBillingHistory()])
              showSuccess(result.already_processed
                ? "Payment was already confirmed. Your subscription is active."
                : `Payment confirmed. ${result.credits_added} document credits and ${result.quotation_credits_added} quotation credits were added.`)
              resolve()
            } catch (verificationError) {
              reject(verificationError)
            }
          },
          modal: {
            ondismiss: () => reject(new Error("Payment checkout was closed. No credits were added.")),
          },
        })
      })
    } catch (purchaseError) {
      showError(purchaseError)
    } finally {
      setPurchasingPlan(null)
    }
  }

  async function requestDeletion() {
    if (!workspace || deletionConfirmation !== "DELETE CHANAX ACCOUNT") return
    setSaving(true)
    try {
      const { data, error: requestError } = await supabase!.rpc("breezy_request_account_deletion", { target_workspace_id: workspace.id })
      if (requestError) throw new Error(requestError.message)
      setDeletionRequest(data as { status: string; purge_after: string })
      setDeletionStage(0)
      setDeletionConfirmation("")
      await supabase!.auth.signOut({ scope: "global" })
      window.location.assign("/login?deletion=requested")
    } catch (requestError) { showError(requestError) } finally { setSaving(false) }
  }

  async function cancelDeletion() {
    if (!workspace) return
    setSaving(true)
    try {
      const { error: cancelError } = await supabase!.rpc("breezy_cancel_account_deletion", { target_workspace_id: workspace.id })
      if (cancelError) throw new Error(cancelError.message)
      setDeletionRequest(null)
      await refresh()
      showSuccess("Account deletion cancelled. Workspace and team access have been restored.")
    } catch (cancelError) { showError(cancelError) } finally { setSaving(false) }
  }

  if (!workspace || !membership) return <p className="text-sm text-muted-foreground">Loading workspace settings…</p>

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Administration" title="Workspace settings" description="Manage your business profile, subscription identity, team roles and page access from one place." />

      {notice ? <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</div> : null}
      {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Crown className="size-4" />Workspace</CardTitle><CardDescription>Your shared ChanaX account.</CardDescription></CardHeader>
          <CardContent className="space-y-3"><p className="text-lg font-semibold">{workspace.name}</p><div className="flex gap-2"><Badge variant="outline">{membership.role}</Badge><Badge variant={workspace.status === "active" ? "secondary" : "destructive"}>{workspace.status}</Badge></div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4" />Subscription code</CardTitle><CardDescription>Use this only as an account reference—not as a password.</CardDescription></CardHeader>
          <CardContent><div className="flex items-center gap-2"><code className="flex-1 rounded-lg bg-muted px-3 py-2 text-sm font-semibold">{workspace.subscription_code}</code><Button variant="outline" size="icon" aria-label="Copy subscription code" onClick={() => void copyCode()}><Clipboard /></Button></div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" />Subscription</CardTitle><CardDescription>Billing and product access for this workspace.</CardDescription></CardHeader>
          <CardContent className="space-y-2"><div className="flex items-center justify-between"><span className="text-muted-foreground">Plan</span><span className="font-semibold capitalize">{subscription?.plan_key || "Free"}</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><Badge variant="outline" className="capitalize">{subscription?.status || "Active"}</Badge></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Document credits</span><span className="font-semibold">{documentCreditsRemaining}</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Quotation credits</span><span className="font-semibold">{quotationCreditsRemaining}</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Plan expires</span><span>{readableDate(subscription?.current_period_ends_at || subscription?.trial_ends_at || null)}</span></div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="size-4" />Build a custom plan</CardTitle><CardDescription>Tell us your expected monthly invoices and employees. Monthly plans include 20% extra credits, quarterly plans 25%, and annual plans 30%.</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="custom-monthly-invoices">Invoices generated each month</Label><Input id="custom-monthly-invoices" inputMode="numeric" min="0" step="1" type="number" value={customMonthlyInvoices} onChange={(event) => setCustomMonthlyInvoices(event.target.value)} placeholder="For example, 100" /></div>
            <div className="space-y-2"><Label htmlFor="custom-employees">Number of employees</Label><Input id="custom-employees" inputMode="numeric" min="0" step="1" type="number" value={customEmployees} onChange={(event) => setCustomEmployees(event.target.value)} placeholder="For example, 100" /><p className="text-xs text-muted-foreground">One monthly payslip credit per employee.</p></div>
            <div className="space-y-2"><Label htmlFor="custom-duration">Billing period</Label><select id="custom-duration" value={customPlanKey} onChange={(event) => setCustomPlanKey(event.target.value as typeof customPlanKey)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{customDurations.map((duration) => <option key={duration.key} value={duration.key}>{duration.label}</option>)}</select></div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-muted/30 p-4"><p className="text-xs font-medium text-muted-foreground">Monthly requirement</p><p className="mt-2 text-2xl font-semibold tabular-nums">{customExpectedDocuments}</p><p className="mt-1 text-xs text-muted-foreground">Invoices + employees</p></div>
            <div className="rounded-xl border bg-muted/30 p-4"><p className="text-xs font-medium text-muted-foreground">Document credits</p><p className="mt-2 text-2xl font-semibold tabular-nums">{customTotalCredits}</p><p className="mt-1 text-xs text-muted-foreground">Includes {customBonusPercent}% additional credits</p></div>
            <div className="rounded-xl border bg-muted/30 p-4"><p className="text-xs font-medium text-muted-foreground">Quotation credits</p><p className="mt-2 text-2xl font-semibold tabular-nums">{customTotalCredits}</p><p className="mt-1 text-xs text-muted-foreground">Separate quotation-only balance</p></div>
            <div className="rounded-xl border border-primary/40 bg-primary/5 p-4"><p className="text-xs font-medium text-muted-foreground">Total for {customMonths} {customMonths === 1 ? "month" : "months"}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{currency(customTotalPrice)}</p><p className="mt-1 text-xs text-muted-foreground">₹0.40 per expected document; minimum ₹100/month</p></div>
          </div>

          {customExpectedDocuments > 0 && customRawMonthlyPrice < 100 ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">Your calculated monthly usage price is {currency(customRawMonthlyPrice)}. The ₹100 monthly minimum applies.</p> : null}
          <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">Credits remain available until the end of the selected prepaid period.</p><Button disabled={!isOwner || purchasingPlan !== null || customExpectedDocuments < 1} onClick={() => void purchasePlan(customPlanKey, { monthlyInvoices: customInvoiceCount, employees: customEmployeeCount })}>{purchasingPlan === customPlanKey ? "Opening Razorpay…" : isOwner ? `Purchase custom plan · ${currency(customTotalPrice)}` : "Owner payment only"}</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="size-4" />Ready-made plans</CardTitle><CardDescription>Or choose a prepaid fixed plan through Razorpay. Only the workspace owner can make payments.</CardDescription></CardHeader>
        <CardContent><div className="grid gap-4 lg:grid-cols-3">{previewPlans.map((plan) => <div key={plan.name} className={`relative rounded-xl border p-5 ${plan.recommended ? "border-primary ring-1 ring-primary" : ""}`}>{plan.recommended ? <Badge className="absolute right-4 top-4">Recommended</Badge> : null}<h3 className="text-lg font-semibold">{plan.name}</h3><p className="mt-3 text-3xl font-bold">{plan.price}<span className="text-sm font-normal text-muted-foreground"> / {plan.term}</span></p><p className="mt-2 text-sm text-muted-foreground">{plan.description}</p><div className="mt-5 space-y-2 text-sm"><p className="flex items-center gap-2"><Coins className="size-4" /><strong>{plan.credits}</strong> document credits for invoices or payslips</p><p className="flex items-center gap-2"><Coins className="size-4" /><strong>{plan.credits}</strong> separate quotation credits</p><p className="flex items-center gap-2"><Check className="size-4" /><strong>{plan.bonus}%</strong> additional credits included</p><p className="flex items-center gap-2"><Users className="size-4" /><strong>{plan.seats}</strong> included accounts</p><p className="flex items-center gap-2"><Check className="size-4" />Quotation credits are only for proformas</p><p className="flex items-center gap-2"><Check className="size-4" />Attendance, expenses and exports</p></div><Button className="mt-5 w-full" variant={plan.recommended ? "default" : "outline"} disabled={!isOwner || purchasingPlan !== null} onClick={() => void purchasePlan(plan.key)}>{purchasingPlan === plan.key ? "Opening Razorpay…" : isOwner ? `Choose ${plan.name}` : "Owner payment only"}</Button></div>)}</div><div className="mt-4 space-y-1 text-xs text-muted-foreground"><p>Both paid credit balances expire at the end of the selected plan period. Quotation credits cannot be used for sales invoices or payslips.</p><p>Payments are processed by Razorpay. Credits are added only after secure server verification.</p><p>Additional team accounts will be available as a recurring monthly add-on after its price is finalised.</p></div></CardContent>
      </Card>

      {billingPayments.length ? <Card>
        <CardHeader><CardTitle>Payment history</CardTitle><CardDescription>Your latest Razorpay plan purchases.</CardDescription></CardHeader>
        <CardContent><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Plan</TableHead><TableHead>Document credits</TableHead><TableHead>Quotation credits</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{billingPayments.map((payment) => <TableRow key={payment.id}><TableCell>{readableDate(payment.paid_at || payment.created_at)}</TableCell><TableCell className="capitalize">{payment.plan_key.replace("_", "-")}</TableCell><TableCell>{payment.credits}</TableCell><TableCell>{payment.credits}</TableCell><TableCell>{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(payment.amount_paise / 100)}</TableCell><TableCell><Badge variant={payment.status === "paid" ? "secondary" : payment.status === "failed" ? "destructive" : "outline"} className="capitalize">{payment.status}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent>
      </Card> : null}

      <Card>
        <CardHeader><CardTitle>Business details</CardTitle><CardDescription>These details are shared across this workspace and used on generated documents.</CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={saveWorkspaceDetails}>
            <div className="space-y-2"><Label htmlFor="settings-firm-name">Firm or business name</Label><Input id="settings-firm-name" required value={firmName} disabled={!isOwner} onChange={(event) => setFirmName(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="settings-industry">Industry</Label><Input id="settings-industry" required disabled={!canManageWorkspace} value={industry} onChange={(event) => setIndustry(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="settings-gst-status">GST registration</Label><select id="settings-gst-status" disabled={!canManageWorkspace} value={hasGstin ? "yes" : "no"} onChange={(event) => { const next = event.target.value === "yes"; setHasGstin(next); if (!next) setGstin("") }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"><option value="yes">I have a GSTIN</option><option value="no">I do not have a GSTIN</option></select><p className="text-xs text-muted-foreground">Free document credits are accompanied by an equal, separate quotation-credit allowance. A verified GSTIN unlocks the full allowance in both balances.</p></div>
            {hasGstin ? <div className="space-y-2"><Label htmlFor="settings-gstin">GSTIN</Label><Input id="settings-gstin" required minLength={15} maxLength={15} disabled={!canManageWorkspace} value={gstin} onChange={(event) => setGstin(event.target.value.toUpperCase())} className="font-mono uppercase" placeholder="15-character GSTIN" /></div> : null}
            <div className="space-y-2 md:col-span-2"><Label htmlFor="settings-address">Mailing address</Label><textarea id="settings-address" required disabled={!canManageWorkspace} value={mailingAddress} onChange={(event) => setMailingAddress(event.target.value)} className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50" /></div>
            <section className="space-y-4 rounded-xl border bg-muted/20 p-4 md:col-span-2">
              <div className="flex items-start gap-3"><CalendarDays className="mt-0.5 size-5 text-muted-foreground" /><div><h3 className="font-medium">Employee leave policy</h3><p className="text-sm text-muted-foreground">This allowance applies to every employee and can be changed by a workspace administrator.</p></div></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="settings-leave-period">Calculate paid leave</Label><select id="settings-leave-period" disabled={!canManageWorkspace} value={leavePeriod} onChange={(event) => setLeavePeriod(event.target.value as "monthly" | "yearly")} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"><option value="monthly">Monthly allowance</option><option value="yearly">Yearly allowance</option></select></div>
                <div className="space-y-2"><Label htmlFor="settings-leave-days">Paid leave allowance</Label><Input id="settings-leave-days" disabled={!canManageWorkspace} type="number" min="0" step="0.5" value={leaveAllowanceDays} onChange={(event) => setLeaveAllowanceDays(Math.max(0, Number(event.target.value) || 0))} /><p className="text-xs text-muted-foreground">{leavePeriod === "monthly" ? "Days per employee each month." : "Days per employee each calendar year."}</p></div>
              </div>
              <p className="text-xs text-muted-foreground">Excess leave, unpaid leave and half-day loss are deducted using monthly gross salary ÷ calendar days.</p>
            </section>
            <div className="md:col-span-2 flex justify-end"><Button type="submit" disabled={saving || !canManageWorkspace}><Save />Save workspace settings</Button></div>
          </form>
        </CardContent>
      </Card>


      {isOwner ? <Card className="ring-red-200 dark:ring-red-900"><CardHeader><CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-300"><AlertTriangle className="size-4" />Account and data</CardTitle><CardDescription>Deletion has a 30-day recovery period. It affects this entire workspace and every team member.</CardDescription></CardHeader><CardContent>{deletionRequest ? <div className="flex flex-col gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center"><div className="flex-1"><p className="font-semibold">Deletion scheduled</p><p className="mt-1 text-sm">Permanent deletion is scheduled after {readableDate(deletionRequest.purge_after)}. Credits are frozen until this request is cancelled.</p></div><Button variant="outline" disabled={saving} onClick={() => void cancelDeletion()}>Cancel deletion</Button></div> : <div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="flex-1"><p className="font-medium">Delete this ChanaX account</p><p className="mt-1 text-sm text-muted-foreground">Access is disabled immediately. After 30 days, workspace data is deleted or anonymised and unused credits are permanently forfeited.</p><p className="mt-1 text-xs text-muted-foreground">Only records required for tax, fraud prevention, security or accounting may be retained. Encrypted backups expire on their normal rotation schedule.</p></div><Button variant="destructive" onClick={() => setDeletionStage(1)}><Trash2 />Delete account</Button></div>}</CardContent></Card> : null}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4" />Team and page access</CardTitle><CardDescription>{canManageTeam ? `This workspace includes ${(subscription?.included_seats ?? 3) + (subscription?.extra_seats ?? 0)} total accounts. ${members.filter((member) => ["active", "invited"].includes(member.status)).length + invitations.length} seat${members.filter((member) => ["active", "invited"].includes(member.status)).length + invitations.length === 1 ? " is" : "s are"} currently reserved.` : "Only the workspace owner or an admin can change team access."}</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {canManageTeam && caAccessRequests.length ? <section className="space-y-3 rounded-xl border bg-muted/20 p-4"><div><h3 className="font-semibold">CA access requests</h3><p className="text-sm text-muted-foreground">Approving a CA uses one team seat. Choose the exact pages they may use before granting access.</p></div>{caAccessRequests.map((request) => <div key={request.id} className="flex flex-col gap-3 rounded-lg border bg-background p-3 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><p className="font-medium">{request.requester_name}{request.ca_firm_name ? ` · ${request.ca_firm_name}` : ""}</p><p className="text-xs text-muted-foreground">{request.requester_email}</p>{request.message ? <p className="mt-2 text-sm">{request.message}</p> : null}<p className="mt-2 text-xs text-muted-foreground">Requested: {request.requested_permissions.map((permission) => permission.replace(".", " ")).join(", ")}</p></div><div className="flex gap-2"><Button variant="outline" disabled={saving} onClick={() => void reviewCaRequest(request, false)}>Reject</Button><Button disabled={saving} onClick={() => beginCaApproval(request)}><Check />Review & approve</Button></div></div>)}</section> : null}
          {canManageTeam ? (
            <form onSubmit={sendInvitation} className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center gap-2 font-medium"><MailPlus className="size-4" />Add a team member</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="invite-email">Email address</Label><Input id="invite-email" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="employee@company.com" /></div>
                <div className="space-y-2"><Label htmlFor="invite-role">Role</Label><select id="invite-role" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={inviteRole} onChange={(event) => { const role = event.target.value as EditableRole; setInviteRole(role); setInvitePermissions(permissionsForRole(role)) }}>{editableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></div>
              </div>
              {inviteRole === "admin" ? <p className="rounded-lg border bg-background p-3 text-sm">Admins can access and manage every ChanaX page.</p> : <PermissionChecklist selected={invitePermissions} onChange={setInvitePermissions} />}
              <div className="flex justify-end"><Button type="submit" disabled={saving}><MailPlus />Add access</Button></div>
            </form>
          ) : null}

          {canManageTeam ? (
            <Table>
              <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Joined</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>{members.map((member) => {
                const name = member.profile?.full_name || member.profile?.email || "Workspace member"
                const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
                return <TableRow key={member.id}><TableCell><div className="flex items-center gap-2"><Avatar className="size-8">{member.profile?.avatar_path ? <AvatarImage src={member.profile.avatar_path} alt={name} /> : null}<AvatarFallback>{initials}</AvatarFallback></Avatar><div><p className="font-medium">{name}</p><p className="text-xs text-muted-foreground">{member.profile?.email || (member.user_id === user?.id ? "You" : member.user_id)}</p></div></div></TableCell><TableCell className="capitalize">{member.role}</TableCell><TableCell><Badge variant={member.status === "active" ? "secondary" : "destructive"}>{member.status}</Badge></TableCell><TableCell>{readableDate(member.joined_at)}</TableCell><TableCell><div className="flex justify-end gap-2">{member.role === "owner" ? <Badge variant="outline"><Crown />Owner</Badge> : <><Button size="sm" variant="outline" onClick={() => beginEdit(member)}><UserCog />Edit access</Button><Button size="sm" variant={member.status === "active" ? "destructive" : "outline"} disabled={saving} onClick={() => void toggleMember(member)}>{member.status === "active" ? "Disable" : "Restore"}</Button></>}</div></TableCell></TableRow>
              })}</TableBody>
            </Table>
          ) : <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Your role is <strong className="capitalize text-foreground">{membership.role}</strong>. Contact the workspace owner to change your access.</div>}

          {invitations.length ? <div className="space-y-3"><h3 className="font-medium">Pending invitations</h3>{invitations.map((invitation) => <div key={invitation.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"><div className="flex-1"><p className="font-medium">{invitation.email}</p><p className="text-xs text-muted-foreground">{invitation.role} · expires {readableDate(invitation.expires_at)}</p></div><Button variant="outline" size="sm" onClick={() => void revokeInvitation(invitation.id)}>Revoke</Button></div>)}</div> : null}
        </CardContent>
      </Card>

      {canManageTeam ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" />CA access and activity log</CardTitle><CardDescription>The latest CA data changes and access decisions in this workspace. Records remain even if access is later revoked.</CardDescription></CardHeader><CardContent>{auditEntries.length ? <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Area</TableHead></TableRow></TableHeader><TableBody>{auditEntries.map((entry) => <TableRow key={entry.id}><TableCell>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.created_at))}</TableCell><TableCell>{entry.actor_email || "Former user"}{entry.actor_account_type ? <span className="ml-2 text-xs text-muted-foreground">({entry.actor_account_type})</span> : null}</TableCell><TableCell className="capitalize">{entry.action}</TableCell><TableCell>{entry.resource_type.replace(/^breezy_/, "").replaceAll("_", " ")}</TableCell></TableRow>)}</TableBody></Table> : <p className="py-8 text-center text-sm text-muted-foreground">No CA access or activity has been recorded for this workspace.</p>}</CardContent></Card> : null}

      {reviewingCaRequest ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Approve CA access"><Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto"><CardHeader><CardTitle>Approve CA access</CardTitle><CardDescription>Choose the pages {reviewingCaRequest.requester_name} may access. This approval uses one team seat.</CardDescription></CardHeader><CardContent className="space-y-4"><PermissionChecklist selected={caApprovalPermissions} onChange={setCaApprovalPermissions} /><div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => setReviewingCaRequest(null)}>Cancel</Button><Button disabled={saving || caApprovalPermissions.length === 0} onClick={() => void reviewCaRequest(reviewingCaRequest, true, caApprovalPermissions)}><Check />Grant access</Button></div></CardContent></Card></div> : null}

      {editingMember ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Edit team member access"><Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto"><CardHeader><CardTitle>Edit access</CardTitle><CardDescription>{editingMember.profile?.full_name || editingMember.profile?.email}</CardDescription></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label htmlFor="edit-member-role">Role</Label><select id="edit-member-role" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={editRole} onChange={(event) => { const role = event.target.value as EditableRole; setEditRole(role); setEditPermissions(permissionsForRole(role)) }}>{editableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></div>{editRole === "admin" ? <p className="rounded-lg border bg-muted/30 p-3 text-sm">Admins can access and manage every page.</p> : <PermissionChecklist selected={editPermissions} onChange={setEditPermissions} />}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditingMember(null)}>Cancel</Button><Button disabled={saving} onClick={() => void saveMember()}><Check />Save access</Button></div></CardContent></Card></div> : null}
      {deletionStage ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Confirm account deletion"><Card className="w-full max-w-xl"><CardHeader><CardTitle className="text-red-700">{deletionStage === 1 ? "First warning: workspace access will stop" : "Final warning: permanent deletion is scheduled"}</CardTitle><CardDescription>{deletionStage === 1 ? "Every team member will lose access immediately. Credits will be frozen and all documents will become unavailable." : "You have 30 days to cancel. After that, unused credits are lost and data is deleted or anonymised. Legally required records may be retained and encrypted backups expire on their normal schedule."}</CardDescription></CardHeader><CardContent className="space-y-4">{deletionStage === 2 ? <div className="space-y-2"><Label htmlFor="delete-confirmation">Type DELETE CHANAX ACCOUNT</Label><Input id="delete-confirmation" autoComplete="off" value={deletionConfirmation} onChange={(event) => setDeletionConfirmation(event.target.value)} /></div> : null}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setDeletionStage(0); setDeletionConfirmation("") }}>Cancel</Button>{deletionStage === 1 ? <Button variant="destructive" onClick={() => setDeletionStage(2)}>I understand, continue</Button> : <Button variant="destructive" disabled={saving || deletionConfirmation !== "DELETE CHANAX ACCOUNT"} onClick={() => void requestDeletion()}><Trash2 />Schedule deletion</Button>}</div></CardContent></Card></div> : null}
    </div>
  )
}
