import assert from "node:assert/strict"
import test from "node:test"
import { applyInvoiceTaxMode, gstRateOptions, invoiceTaxError, recalculateGstDraftLine, updateDraftQuantity, updateDraftUnitPrice } from "../src/lib/invoice-gst.ts"

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
  assert.deepEqual(gstRateOptions, [0, 5, 12, 18, 28])
  for (const gst of gstRateOptions) {
    const split = applyInvoiceTaxMode(line(), "split", gst)
    const integrated = applyInvoiceTaxMode(line(), "igst", gst)
    assert.equal(Number(split.cgstRate), gst / 2)
    assert.equal(Number(split.sgstRate), gst / 2)
    assert.equal(Number(integrated.igstRate), gst)
    assert.equal(Number(split.totalAmount), 100 + gst)
    assert.equal(Number(integrated.totalAmount), 100 + gst)
  }
})

test("quantity and unit price calculate the line base and tax, not tax twice", () => {
  const initial = line({ quantity: "1", unitPrice: "100" })
  const three = updateDraftQuantity(initial, "3")
  assert.equal(three.taxableAmount, "300")
  assert.equal(three.totalAmount, "354")
  assert.equal(three.unitPrice, "100")
  const fractional = updateDraftUnitPrice(updateDraftQuantity(three, "2.5"), "40")
  assert.equal(fractional.taxableAmount, "100")
  assert.equal(fractional.totalAmount, "118")
  for (const mode of ["split", "igst"]) {
    const zero = applyInvoiceTaxMode(three, mode, 0)
    assert.equal(zero.totalAmount, "300")
    assert.equal(Number(zero.cgstAmount) + Number(zero.sgstAmount) + Number(zero.igstAmount), 0)
    assert.equal(zero.quantity, "3")
  }
})

test("inclusive total and direct taxable inputs derive unit price without changing total", () => {
  const inclusive = recalculateGstDraftLine(line({ quantity: "2", unitPrice: "", totalAmount: "236", amountBasis: "total" }))
  assert.equal(inclusive.taxableAmount, "200")
  assert.equal(inclusive.unitPrice, "100")
  assert.equal(updateDraftQuantity(inclusive, "3").totalAmount, "354")
  const taxable = recalculateGstDraftLine(line({ quantity: "4", taxableAmount: "100", unitPrice: "" }))
  assert.equal(taxable.unitPrice, "25")
  const paise = recalculateGstDraftLine(line({ quantity: "3", totalAmount: "100.03", amountBasis: "total" }))
  assert.equal(totals(paise), 100.03)
  assert.equal(updateDraftQuantity(updateDraftQuantity(taxable, ""), "4").taxableAmount, "100")
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
