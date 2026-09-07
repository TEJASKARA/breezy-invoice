import {
  AlertTriangle,
  Building2,
  CalendarCheck2,
  Check,
  ChevronDown,
  FileText,
  FileSignature,
  FilePlus2,
  FileOutput,
  CircleHelp,
  Coins,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Monitor,
  Moon,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Sun,
  Users,
  WalletCards,
} from "lucide-react"
import { NavLink, Outlet, useNavigate } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { FirstLoginTour } from "@/components/first-login-tour"
import { ProductFeedbackDialog } from "@/components/product-feedback-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { useAuthUser } from "@/lib/use-auth-user"
import { useMvpStore } from "@/lib/mvp-store"
import { getSetupProgress } from "@/lib/setup-progress"
import { type Theme, useTheme } from "@/lib/theme"
import { useWorkspaceAccess } from "@/lib/workspace-access"
import type { WorkspacePermission } from "@/lib/workspace-access-service"
import { loadPlatformAdminAccess } from "@/lib/platform-admin-api"
import { useEffect, useState } from "react"

const PRODUCT_TOUR_VERSION = 1

const navigation = [
  { label: "Overview", href: "/workspace", icon: LayoutDashboard, end: true, permission: null },
  { label: "Entities", href: "/entities", icon: Building2, permission: "entities.read" },
  { label: "Invoices", href: "/invoices", icon: ReceiptText, permission: "invoices.read" },
  { label: "Quotations", href: "/proformas", icon: FilePlus2, permission: "invoices.read" },
  { label: "Employees", href: "/employees", icon: Users, permission: "payslips.read" },
  { label: "Employee letters", href: "/employees/letters", icon: FileSignature, permission: "payslips.read" },
  { label: "Attendance", href: "/attendance", icon: CalendarCheck2, permission: "payslips.read" },
  { label: "Expenses", href: "/expenses", icon: WalletCards, permission: "expenses.read" },
  { label: "Data Export", href: "/tally-export", icon: FileOutput, permission: "data_export.read" },
  { label: "Templates", href: "/settings/templates", icon: FileText, permission: "templates.read" },
]

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const { can } = useWorkspaceAccess()
  const visibleNavigation = navigation.filter((item) => !item.permission || can(item.permission as WorkspacePermission))
  return (
    <nav className="space-y-1" aria-label="Main navigation">
      {visibleNavigation.map(({ label, href, icon: Icon, end }) => (
        <NavLink
          key={href}
          to={href}
          end={end}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
              mobile && "py-2.5"
            )
          }
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export function AppShell() {
  const navigate = useNavigate()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { user } = useAuthUser()
  const { workspace, membership, creditAccount, workspaceOptions, userProfile, can, refresh, switchWorkspace } = useWorkspaceAccess()
  const [tourOpen, setTourOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const { setup, companies, invoices, proformas, payslips, syncError } = useMvpStore()
  const fullName = String(user?.user_metadata.full_name || user?.user_metadata.name || user?.email?.split("@")[0] || "User")
  const avatarUrl = String(user?.user_metadata.avatar_url || user?.user_metadata.picture || "")
  const initials = fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
  const setupProgress = getSetupProgress({ hasLogin: Boolean(user), setup, companies, invoices, payslips })
  const showSetupProgress = setupProgress.completed < setupProgress.total
  const ThemeIcon = theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun
  const creditsRemaining = creditAccount
    ? Math.max(0, creditAccount.free_credits_granted - creditAccount.free_credits_used)
      + creditAccount.monthly_credits_remaining
      + creditAccount.topup_credits_remaining
    : Math.max(0, 10 - invoices.length - payslips.length)
  const quotationCreditsRemaining = creditAccount
    ? Math.max(0, (creditAccount.free_quotation_credits_granted ?? creditAccount.free_credits_granted) - (creditAccount.free_quotation_credits_used ?? 0))
      + (creditAccount.monthly_quotation_credits_remaining ?? creditAccount.monthly_credits_remaining)
      + (creditAccount.topup_quotation_credits_remaining ?? creditAccount.topup_credits_remaining)
    : Math.max(0, 10 - proformas.length)
  useEffect(() => {
    if (!user) return
    const storageKey = `breezyinvoice-product-tour:${user.id}`
    const savedVersion = Number(user.user_metadata.product_tour_version || 0)
    const locallyCompleted = window.localStorage.getItem(storageKey) === String(PRODUCT_TOUR_VERSION)
    if (savedVersion < PRODUCT_TOUR_VERSION && !locallyCompleted) setTourOpen(true)
  }, [user])
  useEffect(() => {
    if (!user) { setIsPlatformAdmin(false); return }
    let active = true
    void loadPlatformAdminAccess()
      .then((allowed) => { if (active) setIsPlatformAdmin(allowed) })
      .catch(() => { if (active) setIsPlatformAdmin(false) })
    return () => { active = false }
  }, [user])

  async function completeProductTour() {
    if (user) {
      window.localStorage.setItem(`breezyinvoice-product-tour:${user.id}`, String(PRODUCT_TOUR_VERSION))
      await supabase?.auth.updateUser({
        data: { ...user.user_metadata, product_tour_version: PRODUCT_TOUR_VERSION },
      })
    }
    setTourOpen(false)
  }
  async function signOut() { await supabase?.auth.signOut(); navigate("/login") }
  if (workspace?.status === "suspended") return <SuspendedWorkspaceScreen workspaceId={workspace.id} workspaceName={workspace.name} onRestored={() => void refresh()} />
  return (
    <div className="min-h-svh bg-muted/30">
      <FirstLoginTour
        open={tourOpen}
        fullName={fullName}
        can={can}
        onComplete={completeProductTour}
      />
      <ProductFeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        workspaceId={workspace?.id || null}
        workspaceName={workspace?.name || setup?.firmName || null}
      />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-background lg:flex lg:flex-col">
        <div className="flex h-16 items-center px-5">
          <BrandMark />
        </div>
        <Separator />
        <div className="flex-1 px-3 py-5">
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Workspace
          </p>
          <Navigation />
        </div>
        {showSetupProgress ? (
          <div className="border-t p-4">
            <div className="rounded-xl bg-muted/70 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-background">
                  <Settings2 className="size-4 text-muted-foreground" />
                </span>
                <div>
                  <p className="text-xs font-medium">Setup progress</p>
                  <p className="text-[11px] text-muted-foreground">
                    {setupProgress.completed} of {setupProgress.total} completed
                  </p>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-background">
                <div className="h-full rounded-full bg-primary" style={{ width: `${setupProgress.percentage}%` }} />
              </div>
            </div>
          </div>
        ) : null}
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader className="text-left">
                <SheetTitle>
                  <BrandMark />
                </SheetTitle>
              </SheetHeader>
              <div className="px-4">
                <Navigation mobile />
              </div>
            </SheetContent>
          </Sheet>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              className="h-9 gap-2 px-2.5 sm:px-3"
              title={`${creditsRemaining} document credits remaining for invoices and payslips`}
              aria-label={`${creditsRemaining} document credits remaining for invoices and payslips. Open workspace settings.`}
              onClick={() => navigate("/settings/workspace")}
            >
              <Coins className="size-4" />
              <span className="font-semibold tabular-nums">{creditsRemaining}</span>
              <span className="hidden text-muted-foreground sm:inline">document</span>
            </Button>
            <Button
              variant="outline"
              className="h-9 gap-2 px-2.5 sm:px-3"
              title={`${quotationCreditsRemaining} quotation credits remaining for proformas`}
              aria-label={`${quotationCreditsRemaining} quotation credits remaining for proformas. Open workspace settings.`}
              onClick={() => navigate("/settings/workspace")}
            >
              <FilePlus2 className="size-4" />
              <span className="font-semibold tabular-nums">{quotationCreditsRemaining}</span>
              <span className="hidden text-muted-foreground sm:inline">quotation</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Theme: ${theme}`}>
                  <ThemeIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Appearance</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {([
                  { value: "system", label: "System", icon: Monitor },
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                ] as const).map(({ value, label, icon: Icon }) => (
                  <DropdownMenuItem key={value} onClick={() => setTheme(value as Theme)}>
                    <Icon />
                    {label}
                    <Check className={cn("ml-auto", theme === value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 gap-2 px-2">
                  <Avatar className="size-7">
                    {avatarUrl && <AvatarImage src={avatarUrl} alt={fullName} />}
                    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-40 truncate text-xs font-medium leading-none">{workspace?.name || setup?.firmName || fullName}</span>
                    <span className="mt-1 block text-[11px] leading-none text-muted-foreground">
                      <span className="capitalize">{membership?.role || "Member"}</span>
                    </span>
                  </span>
                  <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel><span className="block">{fullName}</span><span className="mt-1 block max-w-52 truncate text-xs font-normal text-muted-foreground">{user?.email}</span></DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTourOpen(true)}>
                  <CircleHelp />
                  Product tour
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/settings/workspace")}>
                  <Settings2 />
                  Workspace settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFeedbackOpen(true)}>
                  <MessageSquareText />
                  Feedback
                </DropdownMenuItem>
                {userProfile?.account_type === "ca" ? <DropdownMenuItem onClick={() => navigate("/ca")}>
                  <Building2 />
                  CA workspace hub
                </DropdownMenuItem> : null}
                {isPlatformAdmin ? <DropdownMenuItem onClick={() => navigate("/platform-admin")}>
                  <ShieldCheck />
                  Platform administration
                </DropdownMenuItem> : null}
                {workspaceOptions.length > 1 ? <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
                  {workspaceOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.workspace.id}
                      onClick={() => void switchWorkspace(option.workspace.id).then(() => window.location.assign("/workspace"))}
                    >
                      <Building2 />
                      <span className="min-w-0 flex-1 truncate">{option.workspace.name}</span>
                      {option.workspace.id === workspace?.id ? <Check className="ml-auto" /> : null}
                    </DropdownMenuItem>
                  ))}
                </> : null}
                <DropdownMenuItem onClick={signOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {syncError && (
              <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <strong>We couldn't save your latest changes.</strong> {syncError}
              </div>
            )}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

function SuspendedWorkspaceScreen({ workspaceId, workspaceName, onRestored }: { workspaceId: string; workspaceName: string; onRestored: () => void }) {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [purgeAfter, setPurgeAfter] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!supabase) return
    void supabase.from("breezy_account_deletion_requests").select("purge_after").eq("status", "pending").maybeSingle().then(({ data }) => setPurgeAfter(String(data?.purge_after || "")))
  }, [])

  async function restoreAccount() {
    if (!supabase) return
    setSaving(true)
    const { error: restoreError } = await supabase.rpc("breezy_cancel_account_deletion", { target_workspace_id: workspaceId })
    if (restoreError) {
      setError(restoreError.message)
      setSaving(false)
      return
    }
    await onRestored()
  }

  async function signOut() {
    await supabase?.auth.signOut()
    navigate("/login")
  }

  return <main className="flex min-h-svh items-center justify-center bg-muted/30 p-5">
    <Card className="w-full max-w-xl">
      <CardHeader>
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-amber-100 text-amber-700"><AlertTriangle /></div>
        <CardTitle>Account deletion is scheduled</CardTitle>
        <CardDescription>{workspaceName} is deactivated. Your operational data and credits are unavailable while deletion is pending.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-lg border bg-muted/50 p-3 text-sm">{purgeAfter ? <>Permanent deletion is scheduled after <strong>{new Intl.DateTimeFormat("en-IN", { dateStyle: "long" }).format(new Date(purgeAfter))}</strong>.</> : "Your 30-day recovery period is active."}</p>
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button disabled={saving} onClick={() => void restoreAccount()}>{saving ? "Restoring…" : "Cancel deletion and restore account"}</Button>
          <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </CardContent>
    </Card>
  </main>
}
