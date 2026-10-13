import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import ts from "typescript"

const source = await readFile(new URL("../src/lib/workspace-repository.ts", import.meta.url), "utf8")
const routine = source.slice(source.indexOf("export async function updateExistingCompanies("), source.indexOf("export async function deleteCompanyRow("))
const moduleSource = `let db; export function setClient(value) { db = value }
function client() { return db }
function throwIfError(error) { if (error) throw new Error(error.message) }
function withoutKeys(value, keys) { return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key))) }
${routine}`
const javascript = ts.transpileModule(moduleSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { setClient, updateExistingCompanies } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`)
const company = { id: "entity-a", companyName: "Existing issuer", gstin: "UNCHANGEDGST", invoiceNumbering: { nextNumber: 12 } }
function mock(result = { data: { id: "entity-a" }, error: null }) {
  const calls = []
  const query = Object.fromEntries(["from", "update", "eq", "is", "select"].map((method) => [method, (...args) => { calls.push([method, ...args]); return query }]))
  query.maybeSingle = async () => result
  setClient(query)
  return calls
}
test("existing numbering saves use UPDATE scoped to the active company, never INSERT/upsert", async () => {
  const calls = mock()
  await updateExistingCompanies("user", "workspace-a", [company])
  assert.deepEqual(calls, [
    ["from", "breezy_entities"],
    ["update", { payload: { companyName: company.companyName, gstin: company.gstin, invoiceNumbering: company.invoiceNumbering } }],
    ["eq", "workspace_id", "workspace-a"], ["eq", "id", "entity-a"],
    ["is", "transferred_at", null], ["select", "id"],
  ])
})
test("missing, moved or inaccessible companies cannot silently succeed or be recreated", async () => {
  mock({ data: null, error: null })
  await assert.rejects(updateExistingCompanies("user", "workspace-a", [company]), /no longer available/)
  const calls = mock()
  await assert.rejects(updateExistingCompanies("user", "workspace-a", [{ ...company, transferredAt: "2026-10-13" }]), /read-only/)
  assert.equal(calls.length, 0)
})
test("database validation still rejects changed duplicate GST numbers", async () => {
  mock({ data: null, error: { message: "This GST number is already registered in ChanaX." } })
  await assert.rejects(updateExistingCompanies("user", "workspace-a", [{ ...company, gstin: "DUPLICATEGST" }]), /already registered/)
})
test("individual, replacement and bulk invoice counters use the existing-record path", async () => {
  const store = await readFile(new URL("../src/lib/mvp-store.tsx", import.meta.url), "utf8")
  assert.equal((store.match(/if \(updatedCompany\) await updateExistingCompanies/g) || []).length, 2)
  assert(store.includes("if (changedCompanies.length) await updateExistingCompanies"))
})
