import assert from "node:assert/strict"
import test from "node:test"
import { createWelcomeRequester } from "../src/lib/welcome-email.ts"

test("welcome requests are authenticated, contain no recipient and are throttled", async () => {
  const calls = []
  let now = 0
  const request = createWelcomeRequester("https://api.example.com/", {
    getSession: async () => ({ access_token: "secret", user: { id: "user-a" } }),
    fetch: async (...args) => { calls.push(args); return { ok: true } },
    now: () => now,
  })
  await Promise.all([request("user-a"), request("user-a")])
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "https://api.example.com/api/v1/account/welcome")
  assert.equal(calls[0][1].headers.Authorization, "Bearer secret")
  assert.equal(calls[0][1].body, undefined)
  now = 600_001
  await request("user-a")
  assert.equal(calls.length, 2)
})
test("network failures and account changes do not block sign-in", async () => {
  const request = createWelcomeRequester("https://api.example.com", {
    getSession: async () => ({ access_token: "secret", user: { id: "user-a" } }),
    fetch: async () => { throw new Error("Network unavailable") }, now: () => 0,
  })
  await assert.doesNotReject(request("user-a"))
  const other = createWelcomeRequester("https://api.example.com", {
    getSession: async () => ({ access_token: "secret", user: { id: "user-b" } }),
    fetch: async () => { assert.fail("Must not send for an old signed-out session") }, now: () => 0,
  })
  await other("user-a")
})
