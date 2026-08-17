import {
  ArrowRight,
  Check,
  FileOutput,
  ReceiptText,
  Users,
  WalletCards,
} from "lucide-react"
import { Link } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
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
  const primaryHref = user ? "/workspace" : "/login"
  const primaryLabel = user ? "Open workspace" : "Get started"

  return (
    <main className="min-h-svh bg-white text-black">
      <header className="sticky top-0 z-40 border-b border-black/10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <BrandMark className="[&>span:first-child]:bg-black [&>span:first-child]:text-white" />
          <nav className="hidden items-center gap-7 text-sm text-black/65 sm:flex" aria-label="Landing page navigation">
            <a href="#features" className="transition-colors hover:text-black">What we do</a>
            <a href="#how-it-helps" className="transition-colors hover:text-black">How it helps</a>
          </nav>
          <Link
            to={user ? "/workspace" : "/login"}
            className="inline-flex h-9 items-center rounded-lg border border-black px-4 text-sm font-medium transition-colors hover:bg-black hover:text-white"
          >
            {user ? "Workspace" : "Log in"}
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-black/10">
        <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(to_right,rgba(0,0,0,.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,.06)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
          <div className="max-w-2xl">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.22em] text-black/50">Built for Indian businesses and accounting teams</p>
            <h1 className="text-5xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-6xl lg:text-7xl">
              Invoices and payroll, without the busywork.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-black/60 sm:text-lg">
              BreezyInvoice keeps companies, customers, invoices, employees, payslips, expenses, and Tally exports together in one simple workspace.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to={primaryHref} className="inline-flex h-11 items-center gap-2 rounded-lg bg-black px-5 text-sm font-medium text-white transition-transform hover:-translate-y-0.5">
                {primaryLabel}<ArrowRight className="size-4" />
              </Link>
              {!user && <Link to="/login" className="inline-flex h-11 items-center rounded-lg border border-black/20 px-5 text-sm font-medium hover:border-black">Log in</Link>}
            </div>
          </div>

          <div className="rounded-2xl border border-black/15 bg-white p-3 shadow-[0_24px_80px_rgba(0,0,0,.12)]">
            <div className="flex items-center justify-between border-b border-black/10 px-3 py-3">
              <div>
                <p className="text-xs text-black/45">Workspace overview</p>
                <p className="mt-0.5 text-sm font-semibold">Your business, at a glance</p>
              </div>
              <span className="rounded-full bg-black px-3 py-1 text-[11px] font-medium text-white">Live</span>
            </div>
            <div className="grid grid-cols-2 gap-3 p-3">
              {[
                ["Invoices", "Create & download", ReceiptText],
                ["Payslips", "Monthly payroll", Users],
                ["Expenses", "Bills & categories", WalletCards],
                ["Data export", "Tally-ready XML", FileOutput],
              ].map(([label, detail, Icon]) => (
                <div key={String(label)} className="min-h-32 rounded-xl border border-black/10 p-4">
                  <Icon className="size-5" />
                  <p className="mt-7 text-sm font-semibold">{String(label)}</p>
                  <p className="mt-1 text-xs text-black/45">{String(detail)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/45">What we do</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Routine accounting work, made lighter.</h2>
        </div>
        <div className="mt-10 grid border-y border-black/15 md:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, description }, index) => (
            <article key={title} className={`py-8 md:px-8 ${index > 0 ? "border-t border-black/15 md:border-l md:border-t-0" : ""}`}>
              <Icon className="size-6" />
              <h3 className="mt-8 text-lg font-semibold">{title}</h3>
              <p className="mt-3 max-w-sm text-sm leading-6 text-black/55">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how-it-helps" className="bg-black text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">How it helps</p>
            <h2 className="mt-3 max-w-lg text-3xl font-semibold tracking-tight sm:text-4xl">Enter details once. Reuse them every month.</h2>
          </div>
          <div className="space-y-5">
            {["Maintain separate companies in one account", "Generate documents individually or in bulk", "Keep records ready for review and future analysis"].map((item) => (
              <div key={item} className="flex items-center gap-4 border-b border-white/15 pb-5 text-sm text-white/75">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/30"><Check className="size-4" /></span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-16 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Ready for a calmer workflow?</h2>
          <p className="mt-2 text-sm text-black/50">Start with your first company, invoice, or payslip.</p>
        </div>
        <Link to={primaryHref} className="inline-flex h-11 w-fit items-center gap-2 rounded-lg bg-black px-5 text-sm font-medium text-white">
          {primaryLabel}<ArrowRight className="size-4" />
        </Link>
      </section>

      <footer className="border-t border-black/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 text-xs text-black/45 sm:px-8">
          <span>© {new Date().getFullYear()} BreezyInvoice</span>
          <span>Invoices · Payslips · Expenses · Data export</span>
        </div>
      </footer>
    </main>
  )
}
