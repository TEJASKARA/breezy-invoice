import { customerErrorMessage } from "@/lib/customer-errors"
import { useEffect, useState } from "react"
import { Building2 } from "lucide-react"
import { Navigate, useNavigate } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { EntityTransferRequests } from "@/components/entity-transfers"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { verifyGstin } from "@/lib/gst-api"
import { BusinessSetupForm } from "@/components/business-setup-form"
import { type Setup, useMvpStore } from "@/lib/mvp-store"
import { useWorkspaceAccess } from "@/lib/workspace-access"
import { setMyAccountType } from "@/lib/workspace-access-service"


export function OnboardingPage() {
  const { setup, loading, completeSetup } = useMvpStore()
  const { workspace, membership, userProfile, refresh: refreshWorkspaceAccess } = useWorkspaceAccess()
  const navigate = useNavigate()
  const [firmName, setFirmName] = useState("")
  const [accountType, setAccountType] = useState<"ca" | "founder" | "employee" | null>(null)
  const [saveError, setSaveError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (userProfile?.account_type && userProfile.account_type !== "unselected") {
      setAccountType(userProfile.account_type)
      if (userProfile.account_type === "ca" && userProfile.ca_firm_name) setFirmName(userProfile.ca_firm_name)
    }
  }, [userProfile])

  if (loading) return <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading your workspace…</div>
  if (userProfile?.account_type === "ca" && !membership) return <Navigate to="/ca" replace />
  if (setup && userProfile?.account_type !== "unselected") return <Navigate to="/workspace" replace />

  async function chooseAccountType(nextType: "ca" | "founder" | "employee") {
    setAccountType(nextType)
    setSaveError("")
    if (nextType !== "ca" && setup) {
      setSaving(true)
      try {
        await setMyAccountType(nextType)
        await refreshWorkspaceAccess()
        navigate("/workspace")
      } catch (error) {
        setSaveError(customerErrorMessage(error, "Your account type could not be saved."))
      } finally {
        setSaving(false)
      }
    }
  }

  async function completeCaSetup(event: React.FormEvent) {
    event.preventDefault()
    if (!firmName.trim()) return setSaveError("Enter your CA practice or accounting firm name.")
    setSaving(true)
    setSaveError("")
    try {
      await setMyAccountType("ca", firmName.trim())
      await refreshWorkspaceAccess()
      navigate("/ca", { replace: true })
    } catch (error) {
      setSaveError(customerErrorMessage(error, "Your CA portal could not be created."))
    } finally {
      setSaving(false)
    }
  }

  if (accountType === null) {
    return (
      <main className="grid min-h-svh place-items-center bg-muted/30 p-5 sm:p-10">
        <Card className="w-full max-w-3xl">
          <CardHeader><BrandMark className="mb-6" /><CardTitle className="text-2xl">How will you use ChanaX?</CardTitle><CardDescription>This creates the right workspace experience for your role.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <EntityTransferRequests />
            {saveError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{saveError}</p> : null}
            <div className="grid gap-3 sm:grid-cols-3">
              {([
                ["ca", "CA / accounting firm", "Work across client subscriptions without paying for them"],
                ["founder", "Founder / owner", "Own your company subscription and manage your team"],
                ["employee", "Company employee", "Use access assigned by your company admin"],
              ] as const).map(([value, title, description]) => <button key={value} type="button" disabled={saving} onClick={() => void chooseAccountType(value)} className="rounded-xl border bg-background p-5 text-left transition-colors hover:border-primary hover:bg-primary/5"><span className="block font-semibold">{title}</span><span className="mt-2 block text-sm text-muted-foreground">{description}</span></button>)}
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (accountType === "ca" && userProfile?.account_type !== "ca") {
    return (
      <main className="grid min-h-svh place-items-center bg-muted/30 p-5 sm:p-10">
        <Card className="w-full max-w-xl">
          <CardHeader><BrandMark className="mb-6" /><CardTitle>Create your CA portal</CardTitle><CardDescription>You will access client-paid workspaces only after each company approves your request or invitation.</CardDescription></CardHeader>
          <CardContent><form className="space-y-5" onSubmit={completeCaSetup}>
            {saveError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{saveError}</p> : null}
            <div className="space-y-2"><Label htmlFor="ca-firm-name">CA practice or accounting firm name</Label><Input id="ca-firm-name" required value={firmName} onChange={(event) => setFirmName(event.target.value)} placeholder="Your practice name" /></div>
            <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">Client companies own their subscriptions, credits and data. Every client controls your page permissions and can revoke access.</p>
            <div className="flex justify-between gap-3"><Button type="button" variant="outline" onClick={() => setAccountType(null)}>Back</Button><Button type="submit" disabled={saving}>{saving ? "Creating portal…" : "Continue to CA portal"}</Button></div>
          </form></CardContent>
        </Card>
      </main>
    )
  }

  async function saveBusinessSetup(setup: Setup) {
    // CA profiles have already selected their account type in the portal.
    // Reapplying it here could remove a newly created, still-empty firm workspace.
    if (userProfile?.account_type === "unselected" && setup.accountType) {
      await setMyAccountType(setup.accountType, setup.accountType === "ca" ? setup.firmName : undefined)
    }
    await completeSetup(setup)
    if (setup.hasGstin && workspace?.id) {
      const verification = await verifyGstin(setup.gstin, workspace.id)
      if (!verification.workspace_verified) {
        throw new Error(
          verification.registration_status
            ? `This GSTIN has registration status “${verification.registration_status}” and could not be verified for free credits.`
            : "The GSTIN details were found, but the workspace verification could not be completed. Please try again.",
        )
      }
      await refreshWorkspaceAccess()
    }
    navigate("/customers")
  }

  return (
    <main className="min-h-svh bg-muted/30 p-5 sm:p-10">
      <div className="mx-auto max-w-2xl">
        <BrandMark className="mb-10" />
        <div className="mb-7 flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Building2 className="size-5" /></span>
          <div>
            <p className="text-sm font-medium text-primary">Workspace setup</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Set up your firm</h1>
            <p className="mt-2 text-muted-foreground">Add your sender information and choose how new invoice numbers should continue.</p>
          </div>
        </div>

        <EntityTransferRequests />
        <BusinessSetupForm
          key={accountType}
          accountType={accountType}
          initialFirmName={accountType === "ca" ? userProfile?.ca_firm_name || "" : ""}
          verifyGst={(normalizedGstin) => {
            if (!workspace?.id) throw new Error("Your workspace is still loading. Please try again.")
            return verifyGstin(normalizedGstin, workspace.id)
          }}
          onSubmit={saveBusinessSetup}
        />
      </div>
    </main>
  )
}
