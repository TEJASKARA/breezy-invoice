import test from 'node:test'
import assert from 'node:assert/strict'
import { captchaOptions, captchaEnabled } from '../src/lib/captcha.ts'

test('no token means no extra options, so sign-in behaves as before', () => {
  for (const value of [undefined, null, '', '   ']) assert.deepEqual(captchaOptions(value), {})
})

test('a token is passed to Supabase as captchaToken (trimmed)', () => {
  assert.deepEqual(captchaOptions('abc123'), { captchaToken: 'abc123' })
  assert.deepEqual(captchaOptions('  abc123  '), { captchaToken: 'abc123' })
})

test('security check stays off until a site key is configured', () => {
  assert.equal(captchaEnabled, false)
})
