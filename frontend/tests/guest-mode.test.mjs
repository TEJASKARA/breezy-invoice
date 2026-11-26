import assert from "node:assert/strict"
import test from "node:test"

const store = new Map()
const events = []
globalThis.localStorage = { getItem: (key) => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) }
globalThis.window = { localStorage: globalThis.localStorage, dispatchEvent: (event) => events.push(event.type) }
globalThis.CustomEvent ??= class { constructor(type) { this.type = type } }

const guest = await import("../src/lib/guest-mode.ts")

test("signed-in use is never limited", () => {
  guest.setGuestMode(false)
  for (let index = 0; index < 5; index += 1) assert.equal(guest.claimGuestDownload(), true)
  assert.equal(guest.guestDownloadsUsed(), 0)
})

test("a guest gets one free download, then is asked to sign up", () => {
  guest.setGuestMode(true, "invoice")
  assert.equal(guest.guestDownloadsLeft(), 1)
  assert.equal(guest.claimGuestDownload(), true)
  assert.equal(guest.guestDownloadsLeft(), 0)
  assert.equal(guest.claimGuestDownload(), false)
  assert.deepEqual(events, [guest.GUEST_DOWNLOAD_EVENT, guest.GUEST_LIMIT_EVENT])
})

test("app links point to the matching free tool only for guests", () => {
  guest.setGuestMode(true)
  assert.equal(guest.appPath("/settings/templates"), "/free/invoice-design")
  assert.equal(guest.appPath("/settings/letterhead"), "/free/letterhead")
  assert.equal(guest.appPath("/pricing"), "/pricing")
  guest.setGuestMode(false)
  assert.equal(guest.appPath("/settings/templates"), "/settings/templates")
})
