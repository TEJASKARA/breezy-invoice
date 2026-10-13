import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import ts from "typescript"

const source = await readFile(new URL("../src/lib/payslip-page-breaks.ts", import.meta.url), "utf8")
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { payslipPageBreaks } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`)

test("normal payslip stays on one page", () => {
  assert.deepEqual(payslipPageBreaks(1160, 1160, []), [{ top: 0, height: 1160 }])
})
test("page break moves above a salary row rather than cutting it", () => {
  assert.deepEqual(payslipPageBreaks(1800, 1160, [{ top: 1140, bottom: 1180 }]), [
    { top: 0, height: 1140 }, { top: 1140, height: 660 },
  ])
})
test("long documents and oversized blocks retain every pixel without gaps", () => {
  for (const blocks of [[], [{ top: 100, bottom: 2800 }], [{ top: 1120, bottom: 1180 }, { top: 1100, bottom: 1160 }]]) {
    const pages = payslipPageBreaks(4000, 1160, blocks)
    assert(pages.length > 1)
    let next = 0
    for (const page of pages) {
      assert.equal(page.top, next)
      assert(page.height > 0 && page.height <= 1160)
      next += page.height
    }
    assert.equal(next, 4000)
  }
})
