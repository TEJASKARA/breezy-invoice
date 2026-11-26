import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { pathToFileURL } from "node:url"
import ts from "typescript"

const require = createRequire(import.meta.url)
const jsPdfUrl = pathToFileURL(require.resolve("jspdf")).href
let source = await readFile(new URL("../src/lib/letterhead.ts", import.meta.url), "utf8")
const fontsSource = ts.transpileModule(await readFile(new URL("../src/lib/document-fonts.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
source = source.replace('"@/lib/document-fonts"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(fontsSource).toString("base64")}`))
source = source.replace('import("jspdf")', `import(${JSON.stringify(jsPdfUrl)})`)
source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createLetterheadPdf, normalizeLetterhead, letterheadContactLine, letterheadRegistrationLine, letterheadLogo } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

const template = { accentColor: "#2563EB", pageColor: "#FFFFFF", logoDataUrl: null, showChanaxBranding: true }
const entity = { companyName: "Axifleetx Private Limited", billingAddress: "Hitech City, Hyderabad", gstin: "36ABCDE1234F1Z5" }
const text = (doc) => doc.internal.pages.flat().join("\n")

test("missing or invalid settings fall back to the classic letterhead", () => {
  assert.equal(normalizeLetterhead(undefined).style, "classic")
  assert.equal(normalizeLetterhead({ style: "fancy" }).style, "classic")
  assert.equal(normalizeLetterhead({ style: "banner", showGstin: false }).showGstin, false)
})

test("contact and registration lines skip empty values", () => {
  const letterhead = normalizeLetterhead({ phone: "+91 98765 43210", website: "axifleetx.com", registration: "CIN: U1" })
  assert.equal(letterheadContactLine(letterhead), "+91 98765 43210  ·  axifleetx.com")
  assert.equal(letterheadRegistrationLine(letterhead, entity), "GSTIN: 36ABCDE1234F1Z5  ·  CIN: U1")
  assert.equal(letterheadRegistrationLine({ ...letterhead, showGstin: false, registration: "" }, entity), "")
})

for (const style of ["classic", "centered", "banner", "split", "image"]) {
  test(`${style} letterhead prints the company details on one page`, async () => {
    const doc = await createLetterheadPdf({ entity, template, letterhead: normalizeLetterhead({ style, email: "hr@axifleetx.com", footerText: "Registered office: Hyderabad" }) })
    assert.equal(doc.getNumberOfPages(), 1)
    const rendered = text(doc)
    assert(rendered.includes("Axifleetx Private Limited"))
    assert(rendered.includes("hr@axifleetx.com"))
    assert(rendered.includes("Registered office: Hyderabad"))
  })
}

test("letterhead logo overrides the Templates logo, falls back to it, and can be hidden", () => {
  const withTemplateLogo = { ...template, logoDataUrl: "data:image/png;base64,TEMPLATE" }
  assert.equal(letterheadLogo(withTemplateLogo, normalizeLetterhead({})), "data:image/png;base64,TEMPLATE")
  assert.equal(letterheadLogo(withTemplateLogo, normalizeLetterhead({ logoDataUrl: "data:image/png;base64,OWN" })), "data:image/png;base64,OWN")
  assert.equal(letterheadLogo(withTemplateLogo, normalizeLetterhead({ logoDataUrl: "data:image/png;base64,OWN", hideLogo: true })), null)
  assert.equal(normalizeLetterhead({ logoDataUrl: 5 }).logoDataUrl, null)
})
