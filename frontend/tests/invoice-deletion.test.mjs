import assert from "node:assert/strict"
import test from "node:test"
import { canDeleteInvoice } from "../src/lib/invoice-deletion.ts"

const now = Date.parse("2026-11-20T12:00:00Z")
const hoursAgo = (hours) => new Date(now - hours * 3_600_000).toISOString()

test("drafts can always be deleted", () => {
  assert.equal(canDeleteInvoice({ status: "Draft" }, now), true)
})

test("generated invoices (manual or bulk) can be deleted for 24 hours", () => {
  assert.equal(canDeleteInvoice({ status: "Generated", createdAt: hoursAgo(1) }, now), true)
  assert.equal(canDeleteInvoice({ status: "Generated", createdAt: hoursAgo(23.9) }, now), true)
  assert.equal(canDeleteInvoice({ status: "Generated", createdAt: hoursAgo(24) }, now), false)
  assert.equal(canDeleteInvoice({ status: "Generated" }, now), false)
})

test("replacements, cancelled and amended invoices are never deleted", () => {
  assert.equal(canDeleteInvoice({ status: "Generated", createdAt: hoursAgo(1), correctsInvoiceId: "x" }, now), false)
  assert.equal(canDeleteInvoice({ status: "Cancelled", createdAt: hoursAgo(1) }, now), false)
  assert.equal(canDeleteInvoice({ status: "Amended", createdAt: hoursAgo(1) }, now), false)
})
