import test from 'node:test'
import assert from 'node:assert/strict'
import { validInvitationToken, rememberCaInvitation, pendingCaInvitation, clearCaInvitation } from '../src/lib/ca-invitation-session.ts'

test('only high entropy token format is accepted', () => {
  assert.equal(validInvitationToken('a'.repeat(64)), true)
  for (const value of [null, 'short', 'x'.repeat(64), 'https://attacker.test']) assert.equal(validInvitationToken(value), false)
})
test('invitation is preserved across sign-in and cleared after acceptance', () => {
  const saved = new Map()
  globalThis.sessionStorage = { setItem: (key, value) => saved.set(key, value), getItem: key => saved.get(key) ?? null, removeItem: key => saved.delete(key) }
  rememberCaInvitation('a'.repeat(64))
  assert.equal(pendingCaInvitation(), 'a'.repeat(64))
  rememberCaInvitation('invalid')
  assert.equal(pendingCaInvitation(), 'a'.repeat(64))
  clearCaInvitation()
  assert.equal(pendingCaInvitation(), null)
  delete globalThis.sessionStorage
})
test('blocked browser storage does not crash signup', () => {
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('blocked') } })
  assert.doesNotThrow(() => rememberCaInvitation('b'.repeat(64)))
  assert.equal(pendingCaInvitation(), null)
  assert.doesNotThrow(clearCaInvitation)
  delete globalThis.sessionStorage
})
