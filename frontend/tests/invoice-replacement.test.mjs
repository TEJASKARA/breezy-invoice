import assert from "node:assert/strict"
import test from "node:test"
import { invoiceReplacementSaveOrder, replacementInvoiceCompany } from "../src/lib/invoice-replacement.ts"

const companies = [{ id: "issuer-a", companyName: "Company A" }, { id: "issuer-b", companyName: "Company B" }]
const original = { id: "original", entityId: "issuer-a", entityName: "Company A", customerId: "customer-a" }
test("replacement precedes cancelled original in the single atomic write", () => {
  const replacement = { id: "replacement", entityId: "issuer-a", correctsInvoiceId: "original" }
  const cancelled = { ...original, status: "Cancelled", correction: { replacementInvoiceId: "replacement" } }
  assert.deepEqual(invoiceReplacementSaveOrder(cancelled, replacement), [replacement, cancelled])
})
test("issuing company is resolved by stable ID or legacy customer/name", () => {
  assert.equal(replacementInvoiceCompany(original, { entityName: "Company A" }, companies, []).id, "issuer-a")
  assert.equal(replacementInvoiceCompany({ ...original, entityId: undefined, entityName: "Old name" }, { entityName: "Company A" }, companies, [{ id: "customer-a", entityId: "issuer-a" }]).id, "issuer-a")
  assert.equal(replacementInvoiceCompany({ ...original, entityId: undefined, customerId: undefined }, { entityName: "Company A" }, companies, []).id, "issuer-a")
})
test("other issuing companies, moved companies and missing IDs are rejected", () => {
  assert.throws(() => replacementInvoiceCompany(original, { entityName: "Company B" }, companies, []), /same issuing company/)
  assert.throws(() => replacementInvoiceCompany(original, { entityId: "missing", entityName: "Company A" }, companies, []), /active issuing company/)
  assert.throws(() => replacementInvoiceCompany(original, { entityName: "Company A" }, [{ ...companies[0], transferredAt: "2026-10-10" }], []), /active issuing company/)
})
