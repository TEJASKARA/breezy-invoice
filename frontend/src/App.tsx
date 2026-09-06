import { lazy, Suspense, useEffect, useState } from "react"
import { Navigate, Outlet, Route, Routes } from "react-router-dom"
import type { Session } from "@supabase/supabase-js"

import { AppShell } from "@/components/app-shell"
import { LandingPage } from "@/pages/landing-page"
import { LoginPage } from "@/pages/login-page"
import { MvpStoreProvider, useMvpStore } from "@/lib/mvp-store"
import { supabase } from "@/lib/supabase"
import { WorkspaceAccessProvider, useWorkspaceAccess } from "@/lib/workspace-access"
import type { WorkspacePermission } from "@/lib/workspace-access-service"

const DashboardPage = lazy(() => import("@/pages/dashboard-page").then((module) => ({ default: module.DashboardPage })))
const AttendancePage = lazy(() => import("@/pages/attendance-page").then((module) => ({ default: module.AttendancePage })))
const EmployeesPage = lazy(() => import("@/pages/employees-page").then((module) => ({ default: module.EmployeesPage })))
const EntitiesPage = lazy(() => import("@/pages/entities-page").then((module) => ({ default: module.EntitiesPage })))
const ExpensesPage = lazy(() => import("@/pages/expenses-page").then((module) => ({ default: module.ExpensesPage })))
const InvoicesPage = lazy(() => import("@/pages/invoices-page").then((module) => ({ default: module.InvoicesPage })))
const ProformasPage = lazy(() => import("@/pages/proformas-page").then((module) => ({ default: module.ProformasPage })))
const EmployeeLettersPage = lazy(() => import("@/pages/employee-letters-page").then((module) => ({ default: module.EmployeeLettersPage })))
const OnboardingPage = lazy(() => import("@/pages/onboarding-page").then((module) => ({ default: module.OnboardingPage })))
const TemplatesPage = lazy(() => import("@/pages/templates-page").then((module) => ({ default: module.TemplatesPage })))
const TallyExportPage = lazy(() => import("@/pages/tally-export-page").then((module) => ({ default: module.TallyExportPage })))
const WorkspaceSettingsPage = lazy(() => import("@/pages/workspace-settings-page").then((module) => ({ default: module.WorkspaceSettingsPage })))
const PlatformAdminPage = lazy(() => import("@/pages/platform-admin-page").then((module) => ({ default: module.PlatformAdminPage })))
const CaPortalPage = lazy(() => import("@/pages/ca-portal-page").then((module) => ({ default: module.CaPortalPage })))

function PageFallback() {
  return <div className="grid min-h-72 place-items-center text-sm text-muted-foreground">Loading page…</div>
}

function Protected({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => { if (!supabase) { setSession(null); return }; supabase.auth.getSession().then(({ data }) => setSession(data.session)); const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next)); return () => listener.subscription.unsubscribe() }, [])
  if (session === undefined) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading ChanaX…</div>
  return session ? <>{children}</> : <Navigate to="/login" replace />
}
function SetupGate({ children }: { children: React.ReactNode }) {
  const { setup, loading, syncError } = useMvpStore()
  const { workspace, userProfile, loading: accessLoading } = useWorkspaceAccess()
  async function signOut() {
    await supabase?.auth.signOut()
    window.location.assign("/login")
  }
  if (loading || accessLoading) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading your workspace…</div>
  if (userProfile?.account_type === "unselected") return <Navigate to="/setup" replace />
  if (userProfile?.account_type === "ca" && !workspace) return <Navigate to="/ca" replace />
  if (!setup && syncError) {
    return (
      <main className="grid min-h-svh place-items-center bg-muted/30 p-5">
        <section className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-sm">
          <p className="text-sm font-semibold text-destructive">Your workspace could not be loaded</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{syncError}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" onClick={() => window.location.reload()} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Try again</button>
            <button type="button" onClick={() => void signOut()} className="h-9 rounded-lg border bg-background px-4 text-sm font-medium">Log out</button>
          </div>
        </section>
      </main>
    )
  }
  return setup ? <>{children}</> : <Navigate to="/setup" replace />
}
function PermissionGate({ permission, children }: { permission: WorkspacePermission; children: React.ReactNode }) {
  const { loading, can } = useWorkspaceAccess()
  if (loading) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Checking workspace access…</div>
  return can(permission) ? <>{children}</> : <Navigate to="/workspace" replace />
}

function WorkspaceProviders() {
  return <WorkspaceAccessProvider><MvpStoreProvider><Outlet /></MvpStoreProvider></WorkspaceAccessProvider>
}

function App() {
  return (
    <Suspense fallback={<PageFallback />}><Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<WorkspaceProviders />}>
        <Route path="/setup" element={<Protected><OnboardingPage /></Protected>} />
        <Route path="/ca" element={<Protected><CaPortalPage /></Protected>} />
        <Route element={<Protected><SetupGate><AppShell /></SetupGate></Protected>}>
          <Route path="/workspace" element={<DashboardPage />} />
          <Route path="/entities" element={<PermissionGate permission="entities.read"><EntitiesPage /></PermissionGate>} />
          <Route path="/invoices" element={<PermissionGate permission="invoices.read"><InvoicesPage /></PermissionGate>} />
          <Route path="/proformas" element={<PermissionGate permission="invoices.read"><ProformasPage /></PermissionGate>} />
          <Route path="/employees" element={<PermissionGate permission="payslips.read"><EmployeesPage /></PermissionGate>} />
          <Route path="/employees/letters" element={<PermissionGate permission="payslips.read"><EmployeeLettersPage /></PermissionGate>} />
          <Route path="/attendance" element={<PermissionGate permission="payslips.read"><AttendancePage /></PermissionGate>} />
          <Route path="/expenses" element={<PermissionGate permission="expenses.read"><ExpensesPage /></PermissionGate>} />
          <Route path="/tally-export" element={<PermissionGate permission="data_export.read"><TallyExportPage /></PermissionGate>} />
          <Route path="/settings/templates" element={<PermissionGate permission="templates.read"><TemplatesPage /></PermissionGate>} />
          <Route path="/settings/workspace" element={<WorkspaceSettingsPage />} />
          <Route path="/platform-admin" element={<PlatformAdminPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense>
  )
}

export default App
