import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { clearSignedInBrowserData } from "../src/lib/session-cleanup.ts"

class FakeStorage {
  constructor(entries) { this.map = new Map(Object.entries(entries)) }
  get length() { return this.map.size }
  key(index) { return [...this.map.keys()][index] ?? null }
  removeItem(key) { this.map.delete(key) }
  keys() { return [...this.map.keys()].sort() }
}

const personal = {
  "breezyaccounts-mvp-data": "{legacy workspace}",
  "breezyaccounts-mvp-data:11111111": "{customers, employees, salaries, bank details}",
  "breezyinvoice-workspace:aaaaaaaa": "{customers, employees, salaries, bank details}",
  "chanax.invoice-draft.aaaaaaaa.entity1": "{customer name, gstin}",
  "chanax.invoice-draft.aaaaaaaa": "{older draft}",
  "chanax.quotation-form-draft.aaaaaaaa.entity1": "{quotation draft}",
  "chanax.entity-draft:11111111:aaaaaaaa": "{company draft}",
}
const harmless = {
  "chanax-guest-workspace": "{signed-out free-tool data}",
  "breezyaccounts-theme": "dark",
  "chanax-anonymous-visitor-id": "random-id",
  "breezyinvoice-product-tour:11111111": "3",
  "chanax-active-workspace:11111111": "aaaaaaaa",
}

test("sign-out removes every personal data entry and nothing else", () => {
  const storage = new FakeStorage({ ...personal, ...harmless })

  const removed = clearSignedInBrowserData(storage)

  assert.equal(removed, Object.keys(personal).length)
  assert.deepEqual(storage.keys(), Object.keys(harmless).sort())
})

test("it is safe on an empty, missing or broken storage", () => {
  assert.equal(clearSignedInBrowserData(new FakeStorage({})), 0)
  assert.equal(clearSignedInBrowserData(null), 0)
  const broken = { length: 1, key() { throw new Error("blocked") }, removeItem() {} }
  assert.equal(clearSignedInBrowserData(broken), 0)
})

test("the signed-in workspace is never written to browser storage", () => {
  const source = readFileSync(new URL("../src/lib/mvp-store.tsx", import.meta.url), "utf8")
  // The only localStorage write of the workspace state is guarded by guest mode.
  const writes = source.split("\n").filter((line) => line.includes("localStorage.setItem"))
  assert.equal(writes.length, 1)
  assert.match(writes[0], /guest && storageKey/)
})

test("signing out is wired to the cleanup", () => {
  const source = readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8")
  assert.match(source, /SIGNED_OUT/)
  assert.match(source, /clearSignedInBrowserData/)
})
