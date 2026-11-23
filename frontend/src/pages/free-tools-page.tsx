import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react"
import { ArrowRight, CalendarCheck2, Download, FilePlus2, FileSignature, Gift, LoaderCircle, Palette, ReceiptText, Stamp, Users, WalletCards, X } from "lucide-react"
import { Link, Navigate, NavLink, useParams } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EntitySelectionProvider } from "@/lib/entity-selection"
import { GUEST_DOWNLOAD_EVENT, GUEST_FREE_DOWNLOADS, GUEST_LIMIT_EVENT, guestDownloadsLeft, installGuestPdfGuard, setGuestMode } from "@/lib/guest-mode"
import { MvpStoreProvider, useMvpStore } from "@/lib/mvp-store"
import { supabase } from "@/lib/supabase"
import { freeToolList, type FreeToolInfo } from "@/lib/free-tools"
import { cn } from "@/lib/utils"
import { GuestWorkspaceAccessProvider } from "@/lib/workspace-access"

const InvoicesPage = lazy(() => import("@/pages/invoices-page").then((module) => ({ default: module.InvoicesPage })))
const CustomersPage = lazy(() => import("@/pages/invoices-page").then((module) => ({ default: module.CustomersPage })))
const EmployeeLettersPage = lazy(() => import("@/pages/employee-letters-page").then((module) => ({ default: module.EmployeeLettersPage })))
const EmployeesPage = lazy(() => import("@/pages/employees-page").then((module) => ({ default: module.EmployeesPage })))
const AttendancePage = lazy(() => import("@/pages/attendance-page").then((module) => ({ default: module.AttendancePage })))
const LetterheadPage = lazy(() => import("@/pages/letterhead-page").then((module) => ({ default: module.LetterheadPage })))
const TemplatesPage = lazy(() => import("@/pages/templates-page").then((module) => ({ default: module.TemplatesPage })))

const toolIcons: Record<FreeToolInfo["id"], ComponentType<{ className?: string }>> = {
  invoice: ReceiptText,
  quotation: FilePlus2,
  letterhead: Stamp,
  "offer-letter": FileSignature,
  payslip: WalletCards,
  attendance: CalendarCheck2,
  "invoice-design": Palette,
  customers: Users,
}

const toolPages: Record<FreeToolInfo["id"], () => ReactNode> = {
  invoice: () => <InvoicesPage />,
  quotation: () => <InvoicesPage view="quotations" />,
  letterhead: () => <LetterheadPage />,
  "offer-letter": () => <EmployeeLettersPage />,
  payslip: () => <EmployeesPage />,
  attendance: () => <AttendancePage />,
  "invoice-design": () => <TemplatesPage />,
  customers: () => <CustomersPage />,
}

const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** First step for every tool: the business the documents are issued by. */
function GuestCompanyForm() {
  const { completeSetup } = useMvpStore()
  const [firmName, setFirmName] = useState("")
  const [address, setAddress] = useState("")
  const [gstin, setGstin] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const normalizedGstin = gstin.trim().toUpperCase()
    if (!firmName.trim() || !address.trim()) return setError("Enter your business name and address.")
    if (normalizedGstin && !gstinPattern.test(normalizedGstin)) return setError("Enter a valid 15-character GSTIN, or leave it blank.")
    setSaving(true)
    try {
      await completeSetup({
        firmName: firmName.trim(),
        industry: "Other",
        hasGstin: Boolean(normalizedGstin),
        gstin: normalizedGstin,
        pan: normalizedGstin ? normalizedGstin.slice(2, 12) : "",
        mailingAddress: address.trim(),
        premisesAddress: address.trim(),
      })
    } finally {
      setSaving(false)
    }
  }

  return <Card className="mx-auto max-w-xl">
    <CardHeader><CardTitle>Your business</CardTitle><CardDescription>Printed on your documents. It stays in this browser until you sign up.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-2"><Label htmlFor="guest-firm">Business name</Label><Input id="guest-firm" value={firmName} onChange={(event) => { setFirmName(event.target.value); setError("") }} placeholder="Acme Private Limited" /></div>
      <div className="space-y-2"><Label htmlFor="guest-address">Address</Label><textarea id="guest-address" rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={address} onChange={(event) => { setAddress(event.target.value); setError("") }} placeholder="Street, city, state, PIN" /></div>
      <div className="space-y-2"><Label htmlFor="guest-gstin">GSTIN (optional)</Label><Input id="guest-gstin" value={gstin} maxLength={15} onChange={(event) => { setGstin(event.target.value.toUpperCase()); setError("") }} placeholder="36ABCDE1234F1Z5" /></div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button className="w-full" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="animate-spin" /> : null}Continue</Button>
    </CardContent>
  </Card>
}

/** Shown when a guest tries a second download. */
function SignUpPrompt({ onClose }: { onClose: () => void }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="guest-signup-title">
    <Card className="w-full max-w-md shadow-2xl">
      <CardHeader className="relative pr-12">
        <CardTitle id="guest-signup-title" className="flex items-center gap-2"><Gift className="size-5" />Sign up free to download more</CardTitle>
        <CardDescription>You've used your free download.</CardDescription>
        <Button className="absolute right-3 top-3" size="icon" variant="ghost" aria-label="Close" onClick={onClose}><X /></Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ul className="space-y-2">
          <li>✓ <strong>15 free documents</strong>: invoices, quotations and payslips</li>
          <li>✓ Letters and letterheads are always free</li>
          <li>✓ Your company, customers, employees and design move to your account; nothing to retype</li>
          <li>✓ No "Made with ChanaX" footer, and share by email, WhatsApp or link</li>
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row"><Button asChild className="flex-1"><Link to="/login">Sign up free<ArrowRight /></Link></Button><Button variant="outline" onClick={onClose}>Not now</Button></div>
      </CardContent>
    </Card>
  </div>
}

function FreeToolsShell({ tool }: { tool: FreeToolInfo }) {
  const { setup, companies, loading } = useMvpStore()
  const [downloadsLeft, setDownloadsLeft] = useState(guestDownloadsLeft())
  const [showPrompt, setShowPrompt] = useState(false)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    const updated = () => setDownloadsLeft(guestDownloadsLeft())
    const limit = () => { setShowPrompt(true); setDownloadsLeft(guestDownloadsLeft()) }
    window.addEventListener(GUEST_DOWNLOAD_EVENT, updated)
    window.addEventListener(GUEST_LIMIT_EVENT, limit)
    void supabase?.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)))
    return () => { window.removeEventListener(GUEST_DOWNLOAD_EVENT, updated); window.removeEventListener(GUEST_LIMIT_EVENT, limit) }
  }, [])

  useEffect(() => { document.title = `${tool.title} · ChanaX` }, [tool.title])

  return <div className="min-h-svh bg-background text-foreground">
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3"><Link to="/" aria-label="ChanaX home"><BrandMark tone="brand" /></Link><span className="hidden text-sm text-muted-foreground sm:inline">Free tools · no sign-up</span></div>
        <div className="flex items-center gap-2">
          <span className={cn("hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs sm:inline-flex", downloadsLeft === 0 && "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200")}><Download className="size-3.5" />{downloadsLeft > 0 ? `${downloadsLeft} free download${downloadsLeft === 1 ? "" : "s"} left` : "Free download used"}</span>
          {signedIn ? <Button asChild size="sm" variant="outline"><Link to="/workspace">Open my workspace</Link></Button> : <Button asChild size="sm"><Link to="/login">Sign up free · 15 documents</Link></Button>}
        </div>
      </div>
      <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2" aria-label="Free tools">
        {freeToolList.map((item) => { const Icon = toolIcons[item.id]; return <NavLink key={item.id} to={`/free/${item.id}`} className={({ isActive }) => cn("inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground", isActive && "bg-muted font-medium text-foreground")}><Icon className="size-4" />{item.label}</NavLink> })}
      </nav>
    </header>
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      {signedIn ? <p className="rounded-lg border bg-muted/40 p-3 text-sm">You're signed in. These free tools keep their data in this browser only; use <Link to="/workspace" className="underline">your workspace</Link> to save documents to your account.</p> : null}
      <p className="text-sm text-muted-foreground">{GUEST_FREE_DOWNLOADS} free PDF download, then sign up free for 15 documents. Your work stays in this browser and moves to your account when you sign up.</p>
      {loading ? <div className="grid min-h-72 place-items-center"><LoaderCircle className="size-5 animate-spin" /></div>
        : !setup || !companies.length ? <GuestCompanyForm />
        : <Suspense fallback={<div className="grid min-h-72 place-items-center text-sm text-muted-foreground">Loading…</div>}><div key={tool.id}>{toolPages[tool.id]()}</div></Suspense>}
    </main>
    {showPrompt ? <SignUpPrompt onClose={() => setShowPrompt(false)} /> : null}
  </div>
}

/** /free/:tool — the real ChanaX pages, running in this browser without an account. */
export function FreeToolsPage() {
  const { tool: toolId = "" } = useParams()
  const tool = freeToolList.find((item) => item.id === toolId)

  useEffect(() => {
    setGuestMode(true, tool?.id)
    void installGuestPdfGuard()
    return () => setGuestMode(false)
  }, [tool?.id])

  if (!tool) return <Navigate to="/free/invoice" replace />
  return <GuestWorkspaceAccessProvider>
    <MvpStoreProvider guest>
      <EntitySelectionProvider>
        <FreeToolsShell tool={tool} />
      </EntitySelectionProvider>
    </MvpStoreProvider>
  </GuestWorkspaceAccessProvider>
}
