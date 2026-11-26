import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react"
import { ArrowRight, Download, FilePlus2, FileSignature, Gift, LoaderCircle, Palette, ReceiptText, Stamp } from "lucide-react"
import { Link, Navigate, NavLink, useNavigate, useParams } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EntitySelectionProvider } from "@/lib/entity-selection"
import { GUEST_DOWNLOAD_EVENT, GUEST_FREE_DOWNLOADS, GUEST_LIMIT_EVENT, guestDownloadsLeft, installGuestPdfGuard, setGuestMode } from "@/lib/guest-mode"
import { MvpStoreProvider, useMvpStore } from "@/lib/mvp-store"
import { supabase } from "@/lib/supabase"
import { FREE_TOOLS_SIGNUP, freeToolList, type FreeToolInfo } from "@/lib/free-tools"
import { cn } from "@/lib/utils"
import { GuestWorkspaceAccessProvider } from "@/lib/workspace-access"

const FreeDocumentTool = lazy(() => import("@/pages/free-document-tool").then((module) => ({ default: module.FreeDocumentTool })))
const EmployeeLettersPage = lazy(() => import("@/pages/employee-letters-page").then((module) => ({ default: module.EmployeeLettersPage })))
const LetterheadPage = lazy(() => import("@/pages/letterhead-page").then((module) => ({ default: module.LetterheadPage })))
const TemplatesPage = lazy(() => import("@/pages/templates-page").then((module) => ({ default: module.TemplatesPage })))

const toolIcons: Record<FreeToolInfo["id"], ComponentType<{ className?: string }>> = {
  invoice: ReceiptText,
  quotation: FilePlus2,
  letterhead: Stamp,
  "offer-letter": FileSignature,
  "invoice-design": Palette,
}

const toolPages: Record<FreeToolInfo["id"], () => ReactNode> = {
  invoice: () => <FreeDocumentTool kind="invoice" />,
  quotation: () => <FreeDocumentTool kind="quotation" />,
  letterhead: () => <LetterheadPage />,
  "offer-letter": () => <EmployeeLettersPage />,
  "invoice-design": () => <TemplatesPage />,
}

/** Tools that print the company name and address get these fields above them. */
const toolsWithCompanyFields: FreeToolInfo["id"][] = ["letterhead", "offer-letter"]

const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** Company name, address and GSTIN, edited in place; creates the company on first entry. */
function GuestCompanyFields() {
  const { setup, companies, completeSetup, updateCompany } = useMvpStore()
  const company = companies[0]
  const [name, setName] = useState(company?.companyName || "")
  const [address, setAddress] = useState(company?.billingAddress || "")
  const [gstin, setGstin] = useState(company?.gstin || "")
  const saving = useRef(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const normalizedGstin = gstinPattern.test(gstin) ? gstin : ""
      if (!name.trim() || saving.current) return
      if (!setup || !company) {
        saving.current = true
        void completeSetup({ firmName: name.trim(), industry: "Other", hasGstin: Boolean(normalizedGstin), gstin: normalizedGstin, pan: normalizedGstin.slice(2, 12), mailingAddress: address.trim(), premisesAddress: address.trim() }).finally(() => { saving.current = false })
      } else if (company.companyName !== name.trim() || company.billingAddress !== address.trim() || company.gstin !== normalizedGstin) {
        void updateCompany(company.id, { companyName: name.trim(), billingAddress: address.trim(), premisesAddress: address.trim(), gstin: normalizedGstin, pan: normalizedGstin.slice(2, 12), hasGstin: Boolean(normalizedGstin) })
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [name, address, gstin, setup, company, completeSetup, updateCompany])

  return <Card>
    <CardHeader className="pb-3"><CardTitle className="text-base">Your company</CardTitle><CardDescription>Printed on the document. It stays in this browser until you sign up.</CardDescription></CardHeader>
    <CardContent className="grid gap-3 md:grid-cols-[1fr_1.4fr_220px]">
      <div className="space-y-1.5"><Label htmlFor="guest-firm">Company name</Label><Input id="guest-firm" value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Private Limited" /></div>
      <div className="space-y-1.5"><Label htmlFor="guest-address">Address</Label><Input id="guest-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street, city, state, PIN" /></div>
      <div className="space-y-1.5"><Label htmlFor="guest-gstin">GSTIN (optional)</Label><Input id="guest-gstin" value={gstin} maxLength={15} className="font-mono uppercase" onChange={(event) => setGstin(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="36ABCDE1234F1Z5" /></div>
    </CardContent>
  </Card>
}

function SignUpFooter() {
  return <footer className="mt-10 border-t bg-muted/30">
    <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 py-8 sm:flex-row sm:items-center">
      <div className="flex items-start gap-3">
        <Gift className="mt-0.5 size-5 shrink-0 text-primary" />
        <div><p className="font-semibold">Need more documents? Sign up free for 15 credits.</p><p className="text-sm text-muted-foreground">Invoices, quotations and payslips; letters and letterheads are always free. Your company and design move to your account.</p></div>
      </div>
      <Button asChild><Link to={FREE_TOOLS_SIGNUP}>Sign up for more credits<ArrowRight /></Link></Button>
    </div>
  </footer>
}

function FreeToolsShell({ tool }: { tool: FreeToolInfo }) {
  const { loading } = useMvpStore()
  const navigate = useNavigate()
  const [downloadsLeft, setDownloadsLeft] = useState(guestDownloadsLeft())
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    const updated = () => setDownloadsLeft(guestDownloadsLeft())
    // Free download used: take the visitor to sign up for more credits.
    const limit = () => navigate(FREE_TOOLS_SIGNUP)
    window.addEventListener(GUEST_DOWNLOAD_EVENT, updated)
    window.addEventListener(GUEST_LIMIT_EVENT, limit)
    void supabase?.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)))
    return () => { window.removeEventListener(GUEST_DOWNLOAD_EVENT, updated); window.removeEventListener(GUEST_LIMIT_EVENT, limit) }
  }, [navigate])

  useEffect(() => { document.title = `${tool.title} · ChanaX` }, [tool.title])

  return <div className="flex min-h-svh flex-col bg-background text-foreground">
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3"><Link to="/" aria-label="ChanaX home"><BrandMark tone="brand" /></Link><span className="hidden text-sm text-muted-foreground sm:inline">Free tools · no sign-up</span></div>
        <div className="flex items-center gap-2">
          <span className={cn("hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs sm:inline-flex", downloadsLeft === 0 && "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200")}><Download className="size-3.5" />{downloadsLeft > 0 ? `${downloadsLeft} free download${downloadsLeft === 1 ? "" : "s"} left` : "Free download used"}</span>
          {signedIn ? <Button asChild size="sm" variant="outline"><Link to="/workspace">Open my workspace</Link></Button> : <Button asChild size="sm"><Link to={FREE_TOOLS_SIGNUP}>Sign up free · 15 credits</Link></Button>}
        </div>
      </div>
      <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2" aria-label="Free tools">
        {freeToolList.map((item) => { const Icon = toolIcons[item.id]; return <NavLink key={item.id} to={`/free/${item.id}`} className={({ isActive }) => cn("inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground", isActive && "bg-muted font-medium text-foreground")}><Icon className="size-4" />{item.label}</NavLink> })}
      </nav>
    </header>
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6">
      {signedIn ? <p className="rounded-lg border bg-muted/40 p-3 text-sm">You're signed in. These free tools keep their data in this browser only; use <Link to="/workspace" className="underline">your workspace</Link> to save documents to your account.</p> : null}
      <p className="text-sm text-muted-foreground">{GUEST_FREE_DOWNLOADS} free PDF download, then <Link to={FREE_TOOLS_SIGNUP} className="underline">sign up free for 15 credits</Link>. Your work stays in this browser.</p>
      {loading ? <div className="grid min-h-72 place-items-center"><LoaderCircle className="size-5 animate-spin" /></div> : <>
        {toolsWithCompanyFields.includes(tool.id) ? <GuestCompanyFields /> : null}
        <Suspense fallback={<div className="grid min-h-72 place-items-center text-sm text-muted-foreground">Loading…</div>}><div key={tool.id}>{toolPages[tool.id]()}</div></Suspense>
      </>}
    </main>
    <SignUpFooter />
  </div>
}

/** /free/:tool — ChanaX tools that run in this browser without an account. */
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
