import {
  ArrowDown,
  ArrowRight,
  Building2,
  CalendarCheck2,
  Database,
  FileOutput,
  FileText,
  Palette,
  ReceiptText,
  Users,
  WalletCards,
} from "lucide-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { supabase } from "@/lib/supabase"
import { useAuthUser } from "@/lib/use-auth-user"

const salesFlow = [
  { label: "Customer", description: "Contact, GST and billing details", icon: Users },
  { label: "Quotation", description: "Products, pricing and terms", icon: FileText },
  { label: "Proforma", description: "A clear pre-sale document", icon: FileOutput },
  { label: "Invoice", description: "Tax calculations and PDFs", icon: ReceiptText },
  { label: "Records", description: "History and exports, ready", icon: Database },
]

const operationLanes = [
  {
    eyebrow: "Sales operations",
    title: "Win work and bill professionally",
    description: "Turn approved work into an invoice without entering the same information again.",
    items: ["Contacts & GST", "Quotations", "Proformas", "Invoices", "PDF & sharing"],
  },
  {
    eyebrow: "People operations",
    title: "Keep your team records in order",
    description: "Manage employee information, attendance, documents and business expenses together.",
    items: ["Employees", "Attendance", "Payslips", "Letters", "Expenses"],
  },
]

export function LandingPage() {
  const { user } = useAuthUser()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const primaryHref = user ? "/workspace" : "/login"
  const primaryLabel = user ? "Open workspace" : "Get started"

  async function signOut() {
    setSigningOut(true)
    await supabase?.auth.signOut()
    navigate("/", { replace: true })
    setSigningOut(false)
  }

  return (
    <main className="public-light min-h-svh bg-white text-[#082f5b]">
      <header className="sticky top-0 z-40 border-b border-[#0b3f77]/10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <BrandMark tone="brand" />
          <nav className="hidden items-center gap-7 text-sm text-[#0b3f77]/65 sm:flex" aria-label="Landing page navigation">
            <a href="#workflow" className="transition-colors hover:text-[#0b3f77]">What we do</a>
            <a href="#operations" className="transition-colors hover:text-[#0b3f77]">How it works</a>
            <a href="#built-for" className="transition-colors hover:text-[#0b3f77]">Who it’s for</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to={primaryHref}
              className="inline-flex h-9 items-center rounded-lg border border-[#0b3f77] px-4 text-sm font-medium transition-colors hover:bg-[#0b3f77] hover:text-white"
            >
              {user ? "Workspace" : "Log in"}
            </Link>
            {user ? (
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={signingOut}
                className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-[#0b3f77]/55 transition-colors hover:bg-[#0b3f77]/5 hover:text-[#0b3f77] disabled:opacity-50"
              >
                {signingOut ? "Signing out…" : "Log out"}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-[#0b3f77]/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(20,184,230,.17),transparent_34%)]" />
        <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(to_right,rgba(11,63,119,.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(11,63,119,.07)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[.95fr_1.05fr] lg:items-center">
          <div className="max-w-2xl">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.22em] text-[#0b3f77]/55">One connected business workspace</p>
            <h1 className="text-5xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-6xl lg:text-7xl">
              Run your business. Keep everything organized.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-[#0b3f77]/65 sm:text-lg">
              Manage customers, quotations, invoices, employees, attendance and expenses from one calm, connected workspace.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to={primaryHref} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0b3f77] px-5 text-sm font-medium text-white shadow-[0_10px_30px_rgba(11,63,119,.22)] transition-transform hover:-translate-y-0.5">
                {primaryLabel}<ArrowRight className="size-4" />
              </Link>
              <span className="text-sm text-[#0b3f77]/50">Built for Indian businesses</span>
            </div>
          </div>

          <div className="relative pb-10">
            <div className="overflow-hidden rounded-[2rem] border border-[#0b3f77]/15 bg-[#f4f9fc] shadow-[0_28px_90px_rgba(11,63,119,.16)]">
              <img src="/chanax-hero.png" alt="ChanaX business workspace" className="aspect-[16/9] w-full object-cover" />
            </div>
            <div className="absolute inset-x-4 bottom-0 grid grid-cols-4 gap-2 rounded-2xl border border-[#0b3f77]/15 bg-white/95 p-3 shadow-xl backdrop-blur sm:inset-x-8">
              {[
                ["Sales", ReceiptText],
                ["People", Users],
                ["Expenses", WalletCards],
                ["Exports", FileOutput],
              ].map(([label, Icon]) => (
                <div key={String(label)} className="flex min-w-0 flex-col items-center gap-2 rounded-xl px-1 py-2 text-center">
                  <Icon className="size-5 text-[#13aeda]" />
                  <p className="truncate text-xs font-semibold text-[#0b3f77] sm:text-sm">{String(label)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-20 sm:px-8 sm:py-24">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0b3f77]/50">One flow, no repeated work</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">From first contact to final business record.</h2>
          <p className="mt-4 text-[#0b3f77]/60">Create information once, carry it forward, and keep the full history connected.</p>
        </div>

        <div className="mt-10 overflow-hidden rounded-2xl border border-[#0b3f77]/15 lg:grid lg:grid-cols-5">
          {salesFlow.map(({ label, description, icon: Icon }, index) => (
            <article key={label} className={`relative min-h-40 p-6 ${index > 0 ? "border-t border-[#0b3f77]/15 lg:border-l lg:border-t-0" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-[0.18em] text-[#0b3f77]/45">{String(index + 1).padStart(2, "0")}</span>
                <Icon className="size-5 text-[#13aeda]" />
              </div>
              <h3 className="mt-8 text-lg font-semibold">{label}</h3>
              <p className="mt-2 text-sm leading-5 text-[#0b3f77]/55">{description}</p>
              {index < salesFlow.length - 1 ? <ArrowRight className="absolute -right-3 top-7 z-10 hidden size-6 rounded-full bg-white p-1 text-[#13aeda] lg:block" /> : null}
              {index < salesFlow.length - 1 ? <ArrowDown className="absolute -bottom-3 right-6 z-10 size-6 rounded-full bg-white p-1 text-[#13aeda] lg:hidden" /> : null}
            </article>
          ))}
        </div>
      </section>

      <section id="operations" className="scroll-mt-16 bg-[#062f5d] text-white">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Everything works together</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Two sides of your business. One workspace.</h2>
          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {operationLanes.map((lane) => (
              <article key={lane.title} className="rounded-2xl border border-white/15 bg-white/[0.04] p-6 sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2bc4e8]">{lane.eyebrow}</p>
                <h3 className="mt-3 text-2xl font-semibold">{lane.title}</h3>
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  {lane.items.map((item, index) => (
                    <div key={item} className="contents">
                      <span className="rounded-lg border border-white/15 bg-black/15 px-3 py-2 text-xs text-white/85">{item}</span>
                      {index < lane.items.length - 1 ? <ArrowRight className="size-3.5 text-[#2bc4e8]" /> : null}
                    </div>
                  ))}
                </div>
                <p className="mt-6 text-sm leading-6 text-white/60">{lane.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="grid gap-5 lg:grid-cols-2">
          <article className="rounded-2xl border border-[#13aeda]/25 bg-[#13aeda]/[0.07] p-7 sm:p-9">
            <Palette className="size-7 text-[#13aeda]" />
            <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Make every document yours.</h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-[#0b3f77]/60">Add your logo, company information and terms once. Reuse branded templates across quotations, proformas, invoices and employee letters.</p>
            <p className="mt-6 text-sm font-semibold text-[#0b3f77]">Consistent documents. Fewer repeated steps.</p>
          </article>
          <article className="rounded-2xl border border-[#0b3f77]/15 p-7 sm:p-9">
            <Database className="size-7 text-[#13aeda]" />
            <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Your data stays accessible.</h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-[#0b3f77]/60">Export business contacts, invoices, quotations, employee records, attendance and expenses whenever you need them for accounting or analysis.</p>
            <p className="mt-6 text-sm font-semibold text-[#0b3f77]">Your data. Your business. Your control.</p>
          </article>
        </div>
      </section>

      <section id="built-for" className="scroll-mt-16 border-y border-[#0b3f77]/10 bg-[#f4f9fc]">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-16 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 text-[#13aeda]"><Building2 className="size-5" /><CalendarCheck2 className="size-5" /></div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">Start small. Grow without the chaos.</h2>
            <p className="mt-4 text-sm leading-6 text-[#0b3f77]/60 sm:text-base">For startups, SMEs, agencies, consultants, traders, contractors, CA practices and growing teams that want less administrative work.</p>
          </div>
          <Link to={primaryHref} className="inline-flex h-11 w-fit shrink-0 items-center gap-2 rounded-lg bg-[#0b3f77] px-5 text-sm font-medium text-white shadow-[0_10px_30px_rgba(11,63,119,.16)]">
            {primaryLabel}<ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <footer className="bg-[#062f5d] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-4"><BrandMark tone="light" /><span>© {new Date().getFullYear()}</span></div>
          <span>Customers · Documents · Invoices · Employees · Attendance · Expenses</span>
        </div>
      </footer>
    </main>
  )
}
