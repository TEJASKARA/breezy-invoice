import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { createWorkspaceLoadGuard, selectWorkspaceMembership } from "../src/lib/workspace-context.ts"

const owner = { workspace_id: "owner-workspace", role: "owner" }
const client = { workspace_id: "client-workspace", role: "accountant" }
test("no stored selection defaults to the owner, regardless of invitation order", () => {
  assert.equal(selectWorkspaceMembership([owner, client]), owner)
  assert.equal(selectWorkspaceMembership([client, owner]), owner)
  assert.equal(selectWorkspaceMembership([owner, client], "removed-workspace"), owner)
})
test("explicit client selection remains respected and free CAs can select clients", () => {
  assert.equal(selectWorkspaceMembership([owner, client], client.workspace_id), client)
  assert.equal(selectWorkspaceMembership([client]), client)
  assert.equal(selectWorkspaceMembership([]), undefined)
})
test("late loads cannot overwrite a newer switch or sign-out", () => {
  const guard = createWorkspaceLoadGuard()
  const old = guard.begin()
  const current = guard.begin()
  assert.equal(old(), false)
  assert.equal(current(), true)
  guard.invalidate()
  assert.equal(current(), false)
})
test("data store uses account selection, never its own auth/storage fallback", async () => {
  const source = await readFile(new URL("../src/lib/mvp-store.tsx", import.meta.url), "utf8")
  assert(source.includes("loadWorkspace(userId, selectedWorkspaceId)"))
  assert(source.includes("workspaceId !== selectedWorkspaceId"))
  assert(!source.includes("supabase.auth.onAuthStateChange"))
  assert(!source.includes("const preferredWorkspaceId = window.localStorage.getItem"))
})
