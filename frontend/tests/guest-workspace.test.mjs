import assert from "node:assert/strict"
import test from "node:test"
import { mergeGuestWorkspace } from "../src/lib/guest-workspace.ts"

const empty = { setup: null, companies: [], customers: [], invoices: [], proformas: [], employees: [], employeeLetters: [], payslips: [], expenses: [], template: { preset: "breeze" } }
const guest = {
  ...empty,
  setup: { firmName: "Axifleetx", gstin: "", mailingAddress: "Hyderabad", industry: "Other", attendanceDrafts: { "c1:2026-11": { entityId: "c1" } } },
  companies: [{ id: "c1", companyName: "Axifleetx" }],
  customers: [{ id: "k1", entityId: "c1", companyName: "Country Chicken" }],
  employees: [{ id: "e1", entityId: "c1", employeeName: "Lasya" }],
  employeeLetters: [{ id: "l1" }],
  invoices: [{ id: "i1" }], proformas: [{ id: "q1" }], payslips: [{ id: "p1" }],
  template: { preset: "minimal", letterheads: { c1: { style: "banner" } } },
}

test("a new workspace takes the guest's company, customers, employees, letters and design", () => {
  const merged = mergeGuestWorkspace(empty, guest)
  assert.equal(merged.setup.firmName, "Axifleetx")
  assert.deepEqual(merged.companies, guest.companies)
  assert.deepEqual(merged.customers, guest.customers)
  assert.deepEqual(merged.employees, guest.employees)
  assert.deepEqual(merged.employeeLetters, guest.employeeLetters)
  assert.equal(merged.template.letterheads.c1.style, "banner")
})

test("guest invoices, quotations and payslips are not copied (they would use credits)", () => {
  const merged = mergeGuestWorkspace(empty, guest)
  assert.deepEqual([merged.invoices, merged.proformas, merged.payslips], [[], [], []])
})

test("an existing setup keeps its details and gains the guest's attendance", () => {
  const workspace = { ...empty, setup: { firmName: "Signed-up name", gstin: "", mailingAddress: "", industry: "IT" } }
  const merged = mergeGuestWorkspace(workspace, guest)
  assert.equal(merged.setup.firmName, "Signed-up name")
  assert.ok(merged.setup.attendanceDrafts["c1:2026-11"])
})
