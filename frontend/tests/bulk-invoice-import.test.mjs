import assert from "node:assert/strict"
import test from "node:test"
import { parseBulkInvoiceRow, resolveAmounts } from "../src/lib/bulk-invoice-import.ts"

const entity = { id: "e1", companyName: "Axigear Auto Ventures LLP", hasGstin: true, gstin: "36AAAAA0000A1Z5", hsnSac: "8711", hsnSacCodes: ["8711"] }
const ctx = { entity, entityName: entity.companyName, isGstEntity: true, savedCustomers: [] }
const b2cRow = { "Customer Name": "Gopala Krishna ", "Total Amount": "87000", "INVOICE NUMBER ": "AVV/2026-27/125", "Invoice Date": "2026-10-01", "CGST Amount": "2.5", "SGST Amount": "2.5" }

test("B2C row with only name, total and CGST/SGST rates is accepted", () => {
  const result = parseBulkInvoiceRow(b2cRow, 2, ctx)
  assert.equal(result.ok, true)
  const invoice = result.invoice
  assert.equal(invoice.companyName, "Gopala Krishna")
  assert.equal(invoice.sourceNumber, "AVV/2026-27/125")
  assert.equal(invoice.amount, 87000)
  assert.equal(invoice.taxableAmount, 82857.14)
  assert.equal(invoice.cgstAmount, 2071.43)
  assert.equal(invoice.sgstAmount, 2071.43)
  assert.equal(Math.round((invoice.taxableAmount + invoice.cgstAmount + invoice.sgstAmount) * 100), 8700000)
  assert.equal(invoice.hsnSac, "8711")
  assert.equal(result.newCustomer.gstin, "")
  assert.equal(result.newCustomer.billingAddress, "")
})

test("taxable amount comes from total minus tax amounts", () => {
  const amounts = resolveAmounts({ taxable: NaN, total: 1180, cgst: { amount: 90 }, sgst: { amount: 90 }, igst: {} })
  assert.deepEqual(amounts, { taxableAmount: 1000, cgstAmount: 90, sgstAmount: 90, igstAmount: 0, amount: 1180 })
})

test("explicit taxable amount and percent columns still work", () => {
  const result = parseBulkInvoiceRow({ "Customer Name": "A", "Invoice Number": "1", "Invoice Date": "2026-10-01", "Taxable Amount": "1000", "IGST %": "18" }, 2, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.invoice.igstAmount, 180)
  assert.equal(result.invoice.amount, 1180)
})

test("small tax amounts are amounts, not rates", () => {
  const result = parseBulkInvoiceRow({ "Customer Name": "A", "Invoice Number": "1", "Invoice Date": "2026-10-01", "Invoice Total": "105", "CGST Amount": "2.5", "SGST Amount": "2.5" }, 2, ctx)
  assert.equal(result.invoice.taxableAmount, 100)
  assert.equal(result.invoice.cgstAmount, 2.5)
})

test("B2B rows need a valid GSTIN, matching PAN and a billing address", () => {
  const base = { "Customer Name": "HAROLOG Pvt Ltd", "Invoice Number": "1", "Invoice Date": "2026-10-01", "Invoice Total": "1180", "CGST": "9%", "SGST": "9%" }
  assert.match(parseBulkInvoiceRow({ ...base, GSTIN: "36AABCH1234Q1Z5" }, 5, ctx).reason, /billing address/)
  assert.match(parseBulkInvoiceRow({ ...base, GSTIN: "BADGSTIN" }, 5, ctx).reason, /not a valid/)
  assert.match(parseBulkInvoiceRow({ ...base, GSTIN: "36AABCH1234Q1Z5", PAN: "AAAAA1111A", "Billing Address": "Hyd" }, 5, ctx).reason, /does not match/)
  const ok = parseBulkInvoiceRow({ ...base, GSTIN: "36AABCH1234Q1Z5", "Billing Address": "Hyderabad" }, 5, ctx)
  assert.equal(ok.ok, true)
  assert.equal(ok.newCustomer.pan, "AABCH1234Q")
  assert.equal(ok.newCustomer.premisesAddress, "Hyderabad")
  assert.equal(ok.invoice.taxableAmount, 1000)
})

test("saved customers are matched by name and their details reused", () => {
  const saved = { id: "c1", entityId: "e1", companyName: "HAROLOG Pvt Ltd", gstin: "36AABCH1234Q1Z5", pan: "AABCH1234Q", billingAddress: "Hyd", premisesAddress: "Hyd", hsnSac: "8711" }
  const result = parseBulkInvoiceRow({ "Customer Name": "harolog pvt ltd", "Invoice Number": "9", "Invoice Date": "2026-10-01", "Invoice Total": "500" }, 3, { ...ctx, savedCustomers: [saved] })
  assert.equal(result.ok, true)
  assert.equal(result.invoice.customerId, "c1")
  assert.equal(result.newCustomer, undefined)
})

test("rejections explain the row's problem", () => {
  assert.match(parseBulkInvoiceRow({ "Invoice Number": "1" }, 7, ctx).reason, /customer name/)
  assert.match(parseBulkInvoiceRow({ "Customer Name": "A", "Invoice Date": "2026-10-01", "Invoice Total": "1" }, 7, ctx).reason, /invoice number/)
  assert.match(parseBulkInvoiceRow({ "Customer Name": "A", "Invoice Number": "1", "Invoice Date": "soon", "Invoice Total": "1" }, 7, ctx).reason, /date/)
  assert.match(parseBulkInvoiceRow({ "Customer Name": "A", "Invoice Number": "1", "Invoice Date": "2026-10-01" }, 7, ctx).reason, /Invoice Total or a Taxable Amount/)
  assert.match(parseBulkInvoiceRow({ ...b2cRow }, 7, { ...ctx, isGstEntity: false }).reason, /no GSTIN/)
  assert.equal(parseBulkInvoiceRow({ "Invoice Number": "1" }, 7, ctx).row, 7)
})

test("invoice numbers that already exist or clash within the file are rejected", async () => {
  const { existingInvoiceNumbers, invoiceNumberConflict } = await import("../src/lib/bulk-invoice-import.ts")
  const existing = existingInvoiceNumbers([
    { entityName: entity.companyName, sourceNumber: "AVV/2026-27/001", number: "INV-1" },
    { entityName: "Other LLP", sourceNumber: "AVV/2026-27/125", number: "INV-2" },
  ], entity.companyName)
  const seen = new Map()
  const base = { companyName: "Gopala Krishna", date: "2026-10-01" }
  assert.match(invoiceNumberConflict({ ...base, sourceNumber: "avv/2026-27/001 " }, 2, existing, seen), /already exists/)
  assert.equal(invoiceNumberConflict({ ...base, sourceNumber: "AVV/2026-27/125" }, 3, existing, seen), null)
  assert.equal(invoiceNumberConflict({ ...base, sourceNumber: "AVV/2026-27/125" }, 4, existing, seen), null)
  assert.match(invoiceNumberConflict({ ...base, companyName: "Someone Else", sourceNumber: "AVV/2026-27/125" }, 5, existing, seen), /row 3/)
})

test("mixed invoice prefixes produce a warning", async () => {
  const { invoicePrefixWarning } = await import("../src/lib/bulk-invoice-import.ts")
  assert.equal(invoicePrefixWarning(["AVV/1", "AVV/2"]), "")
  assert.match(invoicePrefixWarning(["AVV/1", "AVV/2", "AAV/3"]), /AVV \(2\), AAV \(1\)/)
})
