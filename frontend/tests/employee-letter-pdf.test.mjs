import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { pathToFileURL } from "node:url"
import ts from "typescript"

const require = createRequire(import.meta.url)
const jsPdfUrl = pathToFileURL(require.resolve("jspdf")).href
let source = await readFile(new URL("../src/lib/employee-letter-pdf.ts", import.meta.url), "utf8")
source = source.replace('import("jspdf")', `import(${JSON.stringify(jsPdfUrl)})`)
source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createEmployeeLetterPdf } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

const template = { logoSize: 64, showChanaxBranding: true, pageColor: "#FFFFFF", watermarkEnabled: false, watermarkText: "", watermarkOpacity: 0.1, signatureMode: "system", signatureDataUrl: null }
const employee = { id: "employee", employeeName: "Kolli Usha Priya", designation: "Sales Executive", department: "Sales" }
const entity = { companyName: "Example Company", billingAddress: "Hyderabad, Telangana" }
const body = `# OFFER LETTER\n\n**Date:** 26 October 2026\n\n**To,**\n\n**Kolli Usha Priya**\n\n**Subject: Offer of Employment**\n\nDear Kolli Usha Priya,\n\nWe are pleased to offer you employment with our organisation.\n\n${"- Build professional client relationships and deliver excellent service.\n\n".repeat(18)}Please confirm your acceptance of this offer.`
const letter = { id: "letter", entityId: "entity", employeeId: "employee", letterType: "offer", title: "OFFER LETTER", issueDate: "2026-04-01", effectiveDate: "2026-10-26", subject: "Employment offer", body, status: "Issued" }

test("long employee letters use a clean continuation page without duplicated form fields", async () => {
  const doc = await createEmployeeLetterPdf({ letter, employee, entity, template })
  const renderedText = doc.internal.pages.flat().join("\n")
  assert.equal(doc.getNumberOfPages(), 2)
  assert(renderedText.includes("OFFER LETTER - continued"))
  assert(!renderedText.includes("**"))
  assert(!renderedText.includes("26 October 2026"))
  assert(renderedText.includes("For Example Company"))
})
