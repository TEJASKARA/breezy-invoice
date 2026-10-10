import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import test from "node:test"
import ts from "typescript"

// Load the browser renderer in Node, removing browser-only usage tracking.
const require = createRequire(import.meta.url)
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`
const gstUrl = moduleUrl(await readFile(new URL("../src/lib/invoice-gst.ts", import.meta.url), "utf8"))
const calculationsUrl = moduleUrl((await readFile(new URL("../src/lib/invoice-calculations.ts", import.meta.url), "utf8")).replace('"./invoice-gst"', JSON.stringify(gstUrl)))
const renderer = (await readFile(new URL("../src/lib/invoice-pdf.ts", import.meta.url), "utf8"))
  .replace('"@/lib/invoice-calculations"', JSON.stringify(calculationsUrl))
  .replace('import { trackAction } from "@/lib/usage-tracking"', 'const trackAction = () => {}')
  .replace('import("jspdf")', `import(${JSON.stringify(pathToFileURL(require.resolve("jspdf")).href)})`)
const { createInvoicePdf } = await import(moduleUrl(renderer))
const elements = Object.fromEntries(["logo", "issuer", "invoiceTitle", "customer", "invoiceDetails", "lineItems", "totals", "terms", "signature"].map(id => [id, { visible: true, offsetX: 0, offsetY: 0, label: id === "invoiceTitle" ? "TAX INVOICE" : id }]))
const template = { preset: "minimal", accentColor: "#2563EB", pageColor: "#FFFFFF", logoDataUrl: null, logoSize: 64, watermarkEnabled: false, watermarkText: "", watermarkOpacity: .1, showChanaxBranding: true, signatureDataUrl: null, signatureMode: "system", showTerms: true, termsText: "Payment due as agreed.", customTexts: [], fontStyle: "serif", compact: false, elements }
const entity = { companyName: "AXIWATT GREENTECHNO PRIVATE LIMITED", billingAddress: "Sri Krishna Vihar, Temple Lane, Mythri Nagar, Hyderabad, Telangana 500049", hasGstin: true, gstin: "36ABCCA6762H1ZK", pan: "ABCCA6762H" }
const customer = { companyName: "AXIGEAR AUTOVENTURE LLP", billingAddress: "Hafeezpet, Hyderabad, Telangana 500049", gstin: "36ACJFA4386L1ZW", pan: "ACJFA4386L" }
const lineItems = [69600, 45935.6, 31336.44, 22619.5].map((amount, index) => ({ id: String(index), description: "Lithium-Ion Battery 60V,40Ah, Battery 2400w", hsnSac: "8507", quantity: index === 0 ? 2 : 1, unitPrice: amount / (index === 0 ? 2 : 1), taxableAmount: amount, cgstAmount: Math.round(amount * 9) / 100, sgstAmount: Math.round(amount * 9) / 100, igstAmount: 0 }))
const invoice = { id: "qa", number: "CHX/2026-27/0001", date: "2026-08-20", entityName: entity.companyName, companyName: customer.companyName, status: "Generated", amount: 200000.02, lineItems }
const input = { invoice, entity, customer, template }
const text = doc => doc.internal.pages.flat().join("\n")

test("four-line GST invoice fits one page with separate tax columns and totals", async () => {
  const doc = await createInvoicePdf(input)
  assert.equal(doc.getNumberOfPages(), 1)
  for (const label of ["CGST", "SGST", "IGST", "Total", "Unit price", "INR 2,00,000.02"]) assert(text(doc).includes(label), label)
})
test("long invoices paginate and retain every description", async () => {
  const items = Array.from({ length: 35 }, (_, index) => ({ ...lineItems[index % 4], id: String(index), description: `Item-${index} battery` }))
  const doc = await createInvoicePdf({ ...input, invoice: { ...invoice, lineItems: items } })
  assert(doc.getNumberOfPages() > 1)
  for (let index = 0; index < 35; index++) assert(text(doc).includes(`Item-${index} battery`))
})
test("non-GST invoices omit GST columns and quotation keeps mandatory notice", async () => {
  const doc = await createInvoicePdf({ ...input, entity: { ...entity, hasGstin: false, gstin: "" }, invoice: { ...invoice, lineItems: lineItems.map(item => ({ ...item, cgstAmount: 0, sgstAmount: 0 })) } })
  assert(!text(doc).includes("(CGST)"))
  assert(text(doc).includes("(INVOICE)"))
  const quotation = await createInvoicePdf({ ...input, documentType: "quotation" })
  assert(text(quotation).includes("NOT A SALES OR TAX INVOICE"))
})
