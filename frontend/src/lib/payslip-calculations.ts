import type { PayrollComponent } from "@/lib/mvp-store"

export const payrollId = () => crypto.randomUUID()

export const defaultEarnings = (): PayrollComponent[] => [
  { id: payrollId(), label: "Basic Salary", amount: 0 },
  { id: payrollId(), label: "House Rent Allowance (HRA)", amount: 0 },
  { id: payrollId(), label: "Special Allowance", amount: 0 },
]

export const defaultDeductions = (): PayrollComponent[] => [
  { id: payrollId(), label: "Provident Fund (PF)", amount: 0 },
  { id: payrollId(), label: "Professional Tax", amount: 0 },
  { id: payrollId(), label: "TDS / Income Tax", amount: 0 },
]

export function sumPayrollComponents(items: PayrollComponent[]) {
  return items.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0)
}

export function formatSalaryMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
}

export function nextSalaryMonth(month: string) {
  const date = new Date(`${month}-01T00:00:00`)
  date.setMonth(date.getMonth() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

export function maskBankAccount(account: string) {
  const cleaned = account.replace(/\s/g, "")
  if (!cleaned) return "Not provided"
  return `XXXX-XXXX-${cleaned.slice(-4)}`
}

const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

function belowThousand(value: number) {
  const words: string[] = []
  if (value >= 100) {
    words.push(`${ones[Math.floor(value / 100)]} Hundred`)
    value %= 100
  }
  if (value >= 20) {
    words.push(tens[Math.floor(value / 10)])
    value %= 10
  }
  if (value > 0) words.push(ones[value])
  return words.join(" ")
}

export function amountInWords(amount: number) {
  let value = Math.max(0, Math.round(amount))
  if (value === 0) return "Zero Rupees Only"
  const parts: string[] = []
  const crore = Math.floor(value / 10_000_000)
  if (crore) {
    parts.push(`${belowThousand(crore)} Crore`)
    value %= 10_000_000
  }
  const lakh = Math.floor(value / 100_000)
  if (lakh) {
    parts.push(`${belowThousand(lakh)} Lakh`)
    value %= 100_000
  }
  const thousand = Math.floor(value / 1_000)
  if (thousand) {
    parts.push(`${belowThousand(thousand)} Thousand`)
    value %= 1_000
  }
  if (value) parts.push(belowThousand(value))
  return `${parts.join(" ")} Rupees Only`
}

export function cleanPayslipFileName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "payslip"
}
