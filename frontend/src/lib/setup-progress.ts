import type { Company, Invoice, Payslip, Setup } from "@/lib/mvp-store"

type SetupProgressInput = {
  hasLogin: boolean
  setup: Setup | null
  companies: Company[]
  invoices: Invoice[]
  payslips: Payslip[]
}

export function getSetupProgress({ hasLogin, setup, companies, invoices, payslips }: SetupProgressInput) {
  const steps = [
    { id: "login", label: "Create your login", done: hasLogin },
    { id: "firm", label: "Add firm details", done: Boolean(setup) },
    { id: "company", label: "Add your first company", done: companies.length > 0 },
    { id: "invoice", label: "Create your first invoice", done: invoices.length > 0 },
    { id: "payslip", label: "Create your first payslip", done: payslips.length > 0 },
  ]
  const completed = steps.reduce((total, step) => total + Number(step.done), 0)

  return {
    steps,
    completed,
    total: steps.length,
    percentage: Math.round((completed / steps.length) * 100),
  }
}
