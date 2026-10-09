import assert from "node:assert/strict"
import test from "node:test"
import { applyInvoiceTaxMode, invoiceTaxError, recalculateGstDraftLine } from "../src/lib/invoice-gst.ts"

const line = (overrides = {}) => ({ taxableAmount: "100", totalAmount: "", cgstAmount: "", sgstAmount: "", igstAmount: "", cgstRate: "9", sgstRate: "9", igstRate: "", amountBasis: "taxable", ...overrides })
const totals = (value) => Math.round((Number(value.taxableAmount) + Number(value.cgstAmount) + Number(value.sgstAmount) + Number(value.igstAmount)) * 100) / 100

test("switching invoice type clears incompatible taxes on all lines", () => {
  const lines = [line(), line({ taxableAmount: "200", cgstRate: "6", sgstRate: "6" })]
  const integrated = lines.map((item) => applyInvoiceTaxMode(item, "igst"))
  assert.deepEqual(integrated.map((item) => item.igstRate), ["18", "12"])
  for (const item of integrated) {
    assert.equal(item.cgstRate, ""); assert.equal(item.sgstRate, "")
    assert.equal(item.cgstAmount, ""); assert.equal(item.sgstAmount, "")
  }
  const split = integrated.map((item) => applyInvoiceTaxMode(item, "split"))
  assert.deepEqual(split.map((item) => item.cgstRate), ["9", "6"])
  assert.deepEqual(split.map((item) => item.taxableAmount), ["100", "200"])
  for (const item of split) assert.equal(item.igstAmount, "")
})

test("standard GST choices use the invoice-wide tax type", () => {
  for (const gst of [5, 12, 18, 28]) {
    const split = applyInvoiceTaxMode(line(), "split", gst)
    const integrated = applyInvoiceTaxMode(line(), "igst", gst)
    assert.equal(Number(split.cgstRate), gst / 2)
    assert.equal(Number(split.sgstRate), gst / 2)
    assert.equal(Number(integrated.igstRate), gst)
    assert.equal(Number(split.totalAmount), 100 + gst)
    assert.equal(Number(integrated.totalAmount), 100 + gst)
  }
})

test("inclusive totals survive switching and paise rounding", () => {
  for (const total of [118, 100.01, 100.03, 999.99]) {
    const initial = line({ taxableAmount: "", totalAmount: String(total), amountBasis: "total" })
    for (const mode of ["split", "igst"]) {
      const result = applyInvoiceTaxMode(initial, mode)
      assert.equal(Number(result.totalAmount), total)
      assert.equal(totals(result), total)
      assert.equal(invoiceTaxError({ gstTaxMode: mode, lineItems: [result] }), "")
    }
  }
  const result = recalculateGstDraftLine(line({ taxableAmount: "", totalAmount: "118", amountBasis: "total" }))
  assert.equal(result.taxableAmount, "100")
  assert.equal(result.cgstAmount, "9"); assert.equal(result.sgstAmount, "9")
})

test("saving rejects mixed lines, aggregates and selected-mode mismatches", () => {
  const split = { cgstAmount: 9, sgstAmount: 9, igstAmount: 0 }
  const integrated = { cgstAmount: 0, sgstAmount: 0, igstAmount: 18 }
  assert.match(invoiceTaxError({ lineItems: [split, integrated] }), /entire invoice/)
  assert.match(invoiceTaxError({ ...split, lineItems: [integrated] }), /entire invoice/)
  assert.match(invoiceTaxError({ gstTaxMode: "split", lineItems: [integrated] }), /entire invoice/)
  assert.equal(invoiceTaxError({ gstTaxMode: "igst", lineItems: [integrated, { igstAmount: 5 }, {}] }), "")
  assert.equal(invoiceTaxError({ gstTaxMode: "split", lineItems: [split, {}] }), "")
  assert.match(invoiceTaxError({ igstAmount: -1 }), /non-negative/)
})
