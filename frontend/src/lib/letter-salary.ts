import type { EmployeeLetter, LetterSalary } from "@/lib/mvp-store"
import { amountInWords } from "@/lib/payslip-calculations"
import { calculateSalaryStructure } from "@/lib/salary-structure"

/** ₹ in the app; PDFs pass "INR " because the built-in PDF font has no ₹ glyph. */
export const formatRupees = (value: number, symbol = "₹") => `${symbol}${Math.round(value).toLocaleString("en-IN")}`

export function letterSalaryStructure(letterType: EmployeeLetter["letterType"], salary?: LetterSalary) {
  if (letterType === "internship_offer" || !salary || salary.display !== "breakdown" || !salary.annualCtc) return null
  return calculateSalaryStructure(salary.annualCtc, salary.settings)
}

/** The sentence added to the letter for the salary; empty when no salary is shown. */
export function letterSalaryParagraph(letterType: EmployeeLetter["letterType"], salary?: LetterSalary, symbol = "₹") {
  if (!salary || salary.display === "none") return ""
  if (letterType === "internship_offer") {
    const stipend = Math.round(salary.monthlyStipend || 0)
    return stipend > 0 ? `You will receive a monthly stipend of ${formatRupees(stipend, symbol)} (${amountInWords(stipend)}).` : ""
  }
  const ctc = Math.round(salary.annualCtc || 0)
  if (ctc <= 0) return ""
  const annexure = salary.display === "breakdown" ? " The salary structure is enclosed as Annexure A." : ""
  if (letterType === "offer") return `Your annual Cost to Company (CTC) will be ${formatRupees(ctc, symbol)} (${amountInWords(ctc)}).${annexure}`
  return `Your last drawn annual Cost to Company (CTC) was ${formatRupees(ctc, symbol)} (${amountInWords(ctc)}).${annexure}`
}

export const letterSalaryDisplayOptions = (letterType: EmployeeLetter["letterType"]) =>
  letterType === "internship_offer"
    ? [{ value: "none", label: "Don't mention the stipend" }, { value: "line", label: "Mention the monthly stipend" }] as const
    : [{ value: "none", label: "Don't mention salary" }, { value: "line", label: letterType === "offer" ? "One line with the annual CTC" : "One line with the last drawn CTC" }, { value: "breakdown", label: "CTC line plus full salary breakdown (Annexure A)" }] as const
