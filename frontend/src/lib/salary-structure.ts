/**
 * CTC → salary structure for Indian payroll, based on the HR CTC calculator
 * workbook, with these corrections:
 * - ESIC (employee 0.75%, employer 3.25%) is calculated on full gross,
 *   including the special allowance, and solved so gross + employer costs = CTC.
 * - Statutory bonus is 8.33% of Basic capped at ₹7,000 (Payment of Bonus Act),
 *   for employees with Basic up to ₹21,000.
 * - Professional Tax uses a two-step slab (default: Telangana ₹150 above
 *   ₹15,000 and ₹200 above ₹20,000) instead of a flat amount.
 */

export type SalaryStructureSettings = {
  basicPercentOfCtc: number
  hraPercentOfBasic: number
  conveyance: { enabled: boolean; monthly: number }
  medical: { enabled: boolean; monthly: number }
  statutoryBonus: { enabled: boolean; percent: number }
  pf: { enabled: boolean; mode: "capped" | "actual" }
  esic: { enabled: boolean }
  professionalTax: { enabled: boolean; lowerLimit: number; lowerAmount: number; upperLimit: number; upperAmount: number }
  tds: { enabled: boolean; monthly: number }
  gratuity: { enabled: boolean }
  groupInsurance: { enabled: boolean; monthly: number }
}

export const PF_WAGE_CEILING = 15_000
export const ESIC_WAGE_CEILING = 21_000
export const BONUS_ELIGIBILITY_CEILING = 21_000
export const BONUS_CALCULATION_CEILING = 7_000
const EMPLOYEE_PF_RATE = 0.12
const EMPLOYER_PF_RATE = 0.13
const EMPLOYEE_ESIC_RATE = 0.0075
const EMPLOYER_ESIC_RATE = 0.0325
const GRATUITY_RATE = 0.0481

export const defaultSalaryStructureSettings = (): SalaryStructureSettings => ({
  basicPercentOfCtc: 50,
  hraPercentOfBasic: 40,
  conveyance: { enabled: true, monthly: 1600 },
  medical: { enabled: false, monthly: 1250 },
  statutoryBonus: { enabled: false, percent: 8.33 },
  pf: { enabled: true, mode: "capped" },
  esic: { enabled: true },
  professionalTax: { enabled: true, lowerLimit: 15_000, lowerAmount: 150, upperLimit: 20_000, upperAmount: 200 },
  tds: { enabled: false, monthly: 0 },
  gratuity: { enabled: true },
  groupInsurance: { enabled: false, monthly: 500 },
})

/** Fills any missing fields (older saved settings) with defaults. */
export function normalizeSalarySettings(value?: Partial<SalaryStructureSettings> | null): SalaryStructureSettings {
  const base = defaultSalaryStructureSettings()
  if (!value) return base
  return {
    basicPercentOfCtc: finite(value.basicPercentOfCtc, base.basicPercentOfCtc),
    hraPercentOfBasic: finite(value.hraPercentOfBasic, base.hraPercentOfBasic),
    conveyance: { ...base.conveyance, ...value.conveyance },
    medical: { ...base.medical, ...value.medical },
    statutoryBonus: { ...base.statutoryBonus, ...value.statutoryBonus },
    pf: { ...base.pf, ...value.pf },
    esic: { ...base.esic, ...value.esic },
    professionalTax: { ...base.professionalTax, ...value.professionalTax },
    tds: { ...base.tds, ...value.tds },
    gratuity: { ...base.gratuity, ...value.gratuity },
    groupInsurance: { ...base.groupInsurance, ...value.groupInsurance },
  }
}

export type SalaryLine = { key: string; label: string; monthly: number; annual: number }
export type SalaryStructure = {
  annualCtc: number
  monthlyCtc: number
  earnings: SalaryLine[]
  employeeDeductions: SalaryLine[]
  employerContributions: SalaryLine[]
  grossMonthly: number
  deductionsMonthly: number
  netMonthly: number
  employerMonthly: number
  basicShareOfCtc: number
  esicApplies: boolean
  warnings: string[]
}

function finite(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
const money = (value: number) => Math.max(0, Math.round(finite(value, 0)))
const line = (key: string, label: string, monthly: number): SalaryLine => ({ key, label, monthly, annual: monthly * 12 })

export function professionalTaxFor(grossMonthly: number, settings: SalaryStructureSettings["professionalTax"]) {
  if (!settings.enabled) return 0
  if (grossMonthly > settings.upperLimit) return money(settings.upperAmount)
  if (grossMonthly > settings.lowerLimit) return money(settings.lowerAmount)
  return 0
}

export function calculateSalaryStructure(annualCtcInput: number, settingsInput?: Partial<SalaryStructureSettings> | null): SalaryStructure {
  const settings = normalizeSalarySettings(settingsInput)
  const annualCtc = money(annualCtcInput)
  const monthlyCtc = Math.round(annualCtc / 12)
  const warnings: string[] = []
  if (annualCtc <= 0) {
    return { annualCtc: 0, monthlyCtc: 0, earnings: [], employeeDeductions: [], employerContributions: [], grossMonthly: 0, deductionsMonthly: 0, netMonthly: 0, employerMonthly: 0, basicShareOfCtc: 0, esicApplies: false, warnings }
  }

  const basic = Math.round((annualCtc * Math.max(0, settings.basicPercentOfCtc) / 100) / 12)
  const hra = Math.round(basic * Math.max(0, settings.hraPercentOfBasic) / 100)
  const conveyance = settings.conveyance.enabled ? money(settings.conveyance.monthly) : 0
  const medical = settings.medical.enabled ? money(settings.medical.monthly) : 0
  const bonus = settings.statutoryBonus.enabled && basic <= BONUS_ELIGIBILITY_CEILING
    ? Math.round(Math.min(basic, BONUS_CALCULATION_CEILING) * Math.max(0, settings.statutoryBonus.percent) / 100)
    : 0
  const fixedEarnings = basic + hra + conveyance + medical + bonus

  const pfWage = settings.pf.mode === "capped" ? Math.min(basic, PF_WAGE_CEILING) : basic
  const employeePf = settings.pf.enabled ? Math.round(pfWage * EMPLOYEE_PF_RATE) : 0
  const employerPf = settings.pf.enabled ? Math.round(pfWage * EMPLOYER_PF_RATE) : 0
  const gratuity = settings.gratuity.enabled ? Math.round(basic * GRATUITY_RATE) : 0
  const insurance = settings.groupInsurance.enabled ? money(settings.groupInsurance.monthly) : 0

  // Gross + employer ESIC must equal what is left of CTC after the other employer costs.
  const available = monthlyCtc - employerPf - gratuity - insurance
  let gross = available
  let employerEsic = 0
  let esicApplies = false
  if (settings.esic.enabled && available / (1 + EMPLOYER_ESIC_RATE) <= ESIC_WAGE_CEILING) {
    gross = Math.floor(available / (1 + EMPLOYER_ESIC_RATE))
    for (let step = 0; step < 5; step += 1) {
      employerEsic = Math.ceil(gross * EMPLOYER_ESIC_RATE)
      const next = available - employerEsic
      if (next === gross) break
      gross = next
    }
    esicApplies = gross <= ESIC_WAGE_CEILING
    if (!esicApplies) { gross = available; employerEsic = 0 }
  }

  let special = gross - fixedEarnings
  if (special < 0) {
    warnings.push("The fixed components are more than this CTC allows, so the special allowance is zero and the total cost is higher than the CTC entered. Lower Basic %, HRA % or fixed allowances.")
    special = 0
    gross = fixedEarnings
    employerEsic = esicApplies ? Math.ceil(gross * EMPLOYER_ESIC_RATE) : 0
  }
  const employeeEsic = esicApplies ? Math.ceil(gross * EMPLOYEE_ESIC_RATE) : 0
  const professionalTax = professionalTaxFor(gross, settings.professionalTax)
  const tds = settings.tds.enabled ? money(settings.tds.monthly) : 0

  const earnings = [
    line("basic", "Basic Salary", basic),
    line("hra", "House Rent Allowance (HRA)", hra),
    line("conveyance", "Conveyance Allowance", conveyance),
    line("medical", "Medical Allowance", medical),
    line("bonus", "Statutory Bonus", bonus),
    line("special", "Special Allowance", special),
  ].filter((item) => item.monthly > 0)
  const employeeDeductions = [
    line("employee_pf", "Employee Provident Fund (12%)", employeePf),
    line("employee_esic", "Employee State Insurance (0.75%)", employeeEsic),
    line("professional_tax", "Professional Tax", professionalTax),
    line("tds", "Income Tax (TDS)", tds),
  ].filter((item) => item.monthly > 0)
  const employerContributions = [
    line("employer_pf", "Employer Provident Fund (13%)", employerPf),
    line("employer_esic", "Employer State Insurance (3.25%)", employerEsic),
    line("gratuity", "Gratuity (4.81% of Basic)", gratuity),
    line("insurance", "Group Health Insurance", insurance),
  ].filter((item) => item.monthly > 0)

  const grossMonthly = earnings.reduce((total, item) => total + item.monthly, 0)
  const deductionsMonthly = employeeDeductions.reduce((total, item) => total + item.monthly, 0)
  const employerMonthly = employerContributions.reduce((total, item) => total + item.monthly, 0)
  const totalMonthlyCost = grossMonthly + employerMonthly
  const basicShareOfCtc = totalMonthlyCost ? basic / totalMonthlyCost : 0
  if (annualCtc > 0 && basicShareOfCtc < 0.5) warnings.push(`Basic is ${(basicShareOfCtc * 100).toFixed(1)}% of CTC. The Code on Wages expects at least 50%.`)

  return {
    annualCtc,
    monthlyCtc: totalMonthlyCost,
    earnings,
    employeeDeductions,
    employerContributions,
    grossMonthly,
    deductionsMonthly,
    netMonthly: grossMonthly - deductionsMonthly,
    employerMonthly,
    basicShareOfCtc,
    esicApplies,
    warnings,
  }
}

/** Payslip components (earnings and employee deductions) for an employee profile. */
export function salaryStructureToPayroll(structure: SalaryStructure, newId: () => string) {
  return {
    defaultEarnings: structure.earnings.map((item) => ({ id: newId(), label: item.label, amount: item.monthly })),
    defaultDeductions: structure.employeeDeductions.map((item) => ({ id: newId(), label: item.label, amount: item.monthly })),
  }
}
