import assert from "node:assert/strict"
import test from "node:test"
import { entitySelectionKey, selectedWorkspaceEntity } from "../src/lib/entity-selection-utils.ts"

const companies = [{ id: "archived", transferredAt: "2026-10-01" }, { id: "alpha" }, { id: "beta" }]
test("selection restores the preferred entity and falls back safely after deletion", () => {
  assert.equal(selectedWorkspaceEntity(companies, "beta").id, "beta")
  assert.equal(selectedWorkspaceEntity(companies, "deleted").id, "alpha")
  assert.equal(selectedWorkspaceEntity([], "beta"), undefined)
})
test("moved entities remain selectable for historical read-only records", () => {
  assert.equal(selectedWorkspaceEntity(companies, "archived").id, "archived")
  assert.equal(selectedWorkspaceEntity([companies[0]], "").id, "archived")
})
test("selection storage is isolated by workspace and user", () => {
  assert.notEqual(entitySelectionKey("client-a", "ca"), entitySelectionKey("client-b", "ca"))
  assert.notEqual(entitySelectionKey("client-a", "owner"), entitySelectionKey("client-a", "ca"))
  assert.equal(entitySelectionKey(undefined, "owner"), "")
})
