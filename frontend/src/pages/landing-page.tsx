import {
  ArrowRight,
  Check,
  FileOutput,
  ReceiptText,
  Users,
  WalletCards,
} from "lucide-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { supabase } from "@/lib/supabase"
import { useAuthUser } from "@/lib/use-auth-user"

const capabilities = [
  {
    icon: ReceiptText,
    title: "Invoices that stay organised",
    description: "Create one or many GST invoices, reuse customer details, and download polished PDFs.",
  },
  {
    icon: Users,
    title: "Payslips without repetition",
    description: "Save employee salary structures once, then generate individual or bulk payslips each month.",
  },
  {
    icon: FileOutput,
    title: "Accounting-ready exports",
    description: "Map ledger names and prepare invoice and payroll data for a smoother move into Tally.",
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
            <a href="#features" className="transition-colors hover:text-[#0b3f77]">What we do</a>
            <a href="#how-it-helps" className="transition-colors hover:text-[#0b3f77]">How it helps</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to={user ? "/workspace" : "/login"}
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
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.22em] text-[#0b3f77]/55">Built for Indian businesses and accounting teams</p>
            <h1 className="text-5xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-6xl lg:text-7xl">
              Business operations, in a calmer state.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-[#0b3f77]/65 sm:text-lg">
              ChanaX brings invoices, payroll, attendance, expenses, and Tally-ready exports together in one focused workspace.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to={primaryHref} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0b3f77] px-5 text-sm font-medium text-white shadow-[0_10px_30px_rgba(11,63,119,.22)] transition-transform hover:-translate-y-0.5">
                {primaryLabel}<ArrowRight className="size-4" />
              </Link>
              {!user && <Link to="/login" className="inline-flex h-11 items-center rounded-lg border border-[#0b3f77]/25 px-5 text-sm font-medium hover:border-[#0b3f77]">Log in</Link>}
            </div>
          </div>

          <div className="relative pb-10">
            <div className="overflow-hidden rounded-[2rem] border border-[#0b3f77]/15 bg-[#f4f9fc] shadow-[0_28px_90px_rgba(11,63,119,.16)]">
              <img src="/chanax-hero.png" alt="ChanaX brand artwork" className="aspect-[16/9] w-full object-cover" />
            </div>
            <div className="absolute inset-x-4 bottom-0 grid grid-cols-4 gap-2 rounded-2xl border border-[#0b3f77]/15 bg-white/95 p-3 shadow-xl backdrop-blur sm:inset-x-8">
              {[
                ["Invoices", ReceiptText],
                ["Payroll", Users],
                ["Expenses", WalletCards],
                ["Tally", FileOutput],
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

      <section id="features" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0b3f77]/50">What we do</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Routine accounting work, made lighter.</h2>
        </div>
        <div className="mt-10 grid border-y border-[#0b3f77]/15 md:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, description }, index) => (
            <article key={title} className={`py-8 md:px-8 ${index > 0 ? "border-t border-[#0b3f77]/15 md:border-l md:border-t-0" : ""}`}>
              <Icon className="size-6 text-[#13aeda]" />
              <h3 className="mt-8 text-lg font-semibold">{title}</h3>
              <p className="mt-3 max-w-sm text-sm leading-6 text-[#0b3f77]/60">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how-it-helps" className="bg-[#062f5d] text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">How it helps</p>
            <h2 className="mt-3 max-w-lg text-3xl font-semibold tracking-tight sm:text-4xl">Enter details once. Reuse them every month.</h2>
          </div>
          <div className="space-y-5">
            {["Maintain separate companies in one account", "Generate documents individually or in bulk", "Keep records ready for review and future analysis"].map((item) => (
              <div key={item} className="flex items-center gap-4 border-b border-white/15 pb-5 text-sm text-white/75">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[#2bc4e8]/60 text-[#2bc4e8]"><Check className="size-4" /></span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-16 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Ready for a calmer workflow?</h2>
          <p className="mt-2 text-sm text-[#0b3f77]/55">Start with your first company, invoice, or payslip.</p>
        </div>
        <Link to={primaryHref} className="inline-flex h-11 w-fit items-center gap-2 rounded-lg bg-[#0b3f77] px-5 text-sm font-medium text-white">
          {primaryLabel}<ArrowRight className="size-4" />
        </Link>
      </section>

      <footer className="border-t border-[#0b3f77]/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 text-xs text-[#0b3f77]/50 sm:px-8">
          <span>© {new Date().getFullYear()} ChanaX</span>
          <span>Invoices · Payslips · Expenses · Data export</span>
        </div>
      </footer>
    </main>
  )
}
