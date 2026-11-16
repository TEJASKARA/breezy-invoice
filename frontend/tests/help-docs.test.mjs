import assert from "node:assert/strict"
import test from "node:test"
import { helpArticles, helpGroups, searchHelp } from "../src/lib/help-docs.ts"

test("every article has a unique id and a known group", () => {
  const ids = helpArticles.map((article) => article.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const article of helpArticles) assert.ok(helpGroups.includes(article.group), article.id)
  for (const group of helpGroups) assert.ok(helpArticles.some((article) => article.group === group), group)
})

test("search finds the right article first", () => {
  const top = (query) => searchHelp(query)[0]?.article.id
  assert.equal(top("bulk upload"), "bulk-invoices")
  assert.equal(top("tally"), "tally")
  assert.equal(top("leave policy"), "leave-policy")
  assert.equal(top("credit note"), "correct-invoice")
  assert.equal(top("offer letter"), "employee-letters")
  assert.equal(top("whatsapp code"), "sign-in")
})

test("every word must match, and empty queries return nothing", () => {
  assert.deepEqual(searchHelp("   "), [])
  assert.deepEqual(searchHelp("tally zzzunknown"), [])
  assert.ok(searchHelp("GSTIN").length > 3)
  assert.ok(searchHelp("payslip")[0].snippet.length > 0)
})

test("help reflects the single credit balance", () => {
  const text = JSON.stringify(helpArticles)
  assert.ok(!/quotation credit/i.test(text))
  assert.ok(text.includes("400"))
})

test("every figure points to a real article, section and image file", async () => {
  const { helpFigures } = await import("../src/lib/help-docs.ts")
  const { existsSync } = await import("node:fs")
  for (const [id, figures] of Object.entries(helpFigures)) {
    const article = helpArticles.find((item) => item.id === id)
    assert.ok(article, `article ${id}`)
    for (const figure of figures) {
      if (figure.section) assert.ok(article.sections.some((section) => section.heading === figure.section), `${id}: ${figure.section}`)
      assert.ok(existsSync(new URL(`../public${figure.src}`, import.meta.url)), figure.src)
      assert.ok(figure.alt.length > 10)
    }
  }
})
