import assert from "node:assert/strict"
import test from "node:test"
import { calculateSalaryStructure, defaultSalaryStructureSettings, professionalTaxFor, salaryStructureToPayroll } from "../src/lib/salary-structure.ts"

const amounts = (lines) => Object.fromEntries(lines.map((line) => [line.key, line.monthly]))

test("₹6,00,000 CTC matches the HR calculator workbook", () => {
  const result = calculateSalaryStructure(600000)
  assert.deepEqual(amounts(result.earnings), { basic: 25000, hra: 10000, conveyance: 1600, special: 10247 })
  assert.deepEqual(amounts(result.employeeDeductions), { employee_pf: 1800, professional_tax: 200 })
  assert.deepEqual(amounts(result.employerContributions), { employer_pf: 1950, gratuity: 1203 })
  assert.equal(result.grossMonthly, 46847)
  assert.equal(result.netMonthly, 44847)
  assert.equal(result.monthlyCtc, 50000)
  assert.equal(result.esicApplies, false)
  assert.deepEqual(result.warnings, [])
})

test("ESIC is charged on full gross, including special allowance, and CTC still balances", () => {
  for (const annual of [120000, 180000, 216000, 240000, 250000]) {
    const result = calculateSalaryStructure(annual)
    assert.equal(result.monthlyCtc, Math.round(annual / 12), `CTC balances for ${annual}`)
    assert.equal(result.esicApplies, true)
    const esic = amounts(result.employerContributions).employer_esic
    assert.equal(esic, Math.ceil(result.grossMonthly * 0.0325))
    assert.equal(amounts(result.employeeDeductions).employee_esic, Math.ceil(result.grossMonthly * 0.0075))
  }
})

test("statutory bonus is 8.33% of Basic capped at ₹7,000, only when Basic is up to ₹21,000", () => {
  const settings = defaultSalaryStructureSettings()
  settings.statutoryBonus.enabled = true
  assert.equal(amounts(calculateSalaryStructure(216000, settings).earnings).bonus, 583)
  assert.equal(amounts(calculateSalaryStructure(600000, settings).earnings).bonus, undefined)
})

test("professional tax follows the two-step slab", () => {
  const pt = defaultSalaryStructureSettings().professionalTax
  assert.equal(professionalTaxFor(15000, pt), 0)
  assert.equal(professionalTaxFor(18000, pt), 150)
  assert.equal(professionalTaxFor(25000, pt), 200)
  assert.equal(professionalTaxFor(25000, { ...pt, enabled: false }), 0)
})

test("uncapped PF, a low Basic share and an unaffordable structure are reported", () => {
  const actual = defaultSalaryStructureSettings(); actual.pf.mode = "actual"
  assert.equal(amounts(calculateSalaryStructure(600000, actual).employeeDeductions).employee_pf, 3000)
  const lowBasic = defaultSalaryStructureSettings(); lowBasic.basicPercentOfCtc = 40
  assert.match(calculateSalaryStructure(600000, lowBasic).warnings.join(" "), /Code on Wages/)
  assert.match(calculateSalaryStructure(20000).warnings.join(" "), /special allowance is zero/)
  assert.equal(calculateSalaryStructure(0).earnings.length, 0)
})

test("payslip components come from earnings and employee deductions only", () => {
  let next = 0
  const payroll = salaryStructureToPayroll(calculateSalaryStructure(600000), () => `id-${next++}`)
  assert.deepEqual(payroll.defaultEarnings.map((item) => item.label), ["Basic Salary", "House Rent Allowance (HRA)", "Conveyance Allowance", "Special Allowance"])
  assert.deepEqual(payroll.defaultDeductions.map((item) => item.amount), [1800, 200])
})
