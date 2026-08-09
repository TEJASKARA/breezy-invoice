import { useEffect, useState } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import type { Session } from "@supabase/supabase-js"

import { AppShell } from "@/components/app-shell"
import { DashboardPage } from "@/pages/dashboard-page"
import { EmployeesPage } from "@/pages/employees-page"
import { EntitiesPage } from "@/pages/entities-page"
import { ExpensesPage } from "@/pages/expenses-page"
import { InvoicesPage } from "@/pages/invoices-page"
import { LoginPage } from "@/pages/login-page"
import { OnboardingPage } from "@/pages/onboarding-page"
import { TemplatesPage } from "@/pages/templates-page"
import { TallyExportPage } from "@/pages/tally-export-page"
import { WorkspaceSettingsPage } from "@/pages/workspace-settings-page"
import { MvpStoreProvider, useMvpStore } from "@/lib/mvp-store"
import { supabase } from "@/lib/supabase"
import { WorkspaceAccessProvider, useWorkspaceAccess } from "@/lib/workspace-access"
import type { WorkspacePermission } from "@/lib/workspace-access-service"

function Protected({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => { if (!supabase) { setSession(null); return }; supabase.auth.getSession().then(({ data }) => setSession(data.session)); const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next)); return () => listener.subscription.unsubscribe() }, [])
  if (session === undefined) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading BreezyInvoice…</div>
  return session ? <>{children}</> : <Navigate to="/login" replace />
}
function SetupGate({ children }: { children: React.ReactNode }) { const { setup, loading } = useMvpStore(); if (loading) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading your workspace…</div>; return setup ? <>{children}</> : <Navigate to="/setup" replace /> }
function PermissionGate({ permission, children }: { permission: WorkspacePermission; children: React.ReactNode }) {
  const { loading, can } = useWorkspaceAccess()
  if (loading) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Checking workspace access…</div>
  return can(permission) ? <>{children}</> : <Navigate to="/" replace />
}

function App() {
  return (
    <WorkspaceAccessProvider><MvpStoreProvider><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<Protected><OnboardingPage /></Protected>} />
      <Route element={<Protected><SetupGate><AppShell /></SetupGate></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="/entities" element={<PermissionGate permission="entities.read"><EntitiesPage /></PermissionGate>} />
        <Route path="/invoices" element={<PermissionGate permission="invoices.read"><InvoicesPage /></PermissionGate>} />
        <Route path="/employees" element={<PermissionGate permission="payslips.read"><EmployeesPage /></PermissionGate>} />
        <Route path="/expenses" element={<PermissionGate permission="expenses.read"><ExpensesPage /></PermissionGate>} />
        <Route path="/tally-export" element={<PermissionGate permission="data_export.read"><TallyExportPage /></PermissionGate>} />
        <Route path="/settings/templates" element={<PermissionGate permission="templates.read"><TemplatesPage /></PermissionGate>} />
        <Route path="/settings/workspace" element={<WorkspaceSettingsPage />} />
      </Route><Route path="*" element={<Navigate to="/" replace />} />
    </Routes></MvpStoreProvider></WorkspaceAccessProvider>
  )
}

export default App
