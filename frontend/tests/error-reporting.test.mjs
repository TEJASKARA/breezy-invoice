import test from 'node:test'
import assert from 'node:assert/strict'
import { isUnexpectedError, redactDiagnostic, configureErrorReporting, reportUnexpectedError, setErrorWorkspace } from '../src/lib/error-reporting.ts'

test('normal validation and permissions never produce incidents', () => {
  for (const code of ['P0001', '23505', '23503', '23502', '23514', '42501']) {
    assert.equal(isUnexpectedError({ code, message: 'Database validation' }), false)
  }
  for (const message of ['Enter a valid GST number', 'Invalid login credentials', 'This GST number is already registered', 'Add an email address first']) {
    assert.equal(isUnexpectedError(new Error(message)), false)
  }
})
test('infrastructure and runtime failures are unexpected', () => {
  assert.equal(isUnexpectedError({ code: 'PGRST202', message: 'Missing function' }), true)
  assert.equal(isUnexpectedError({ status: 503, message: 'Temporarily unavailable' }), true)
  assert.equal(isUnexpectedError(new TypeError('Cannot read properties of undefined')), true)
})
test('sensitive diagnostic values are redacted', () => {
  const value = redactDiagnostic('token=abc password=hunter2 a@example.com Bearer abc https://host/path?secret=x')
  for (const secret of ['hunter2', 'abc', 'a@example.com', 'https://']) assert.equal(value.includes(secret), false)
})
test('reports are non-blocking, grouped and tolerate logging failure', async () => {
  const reports = []
  configureErrorReporting(async report => { reports.push(report); throw new Error('logger failed') })
  setErrorWorkspace('test-workspace')
  const error = { code: 'XX000', message: 'Unexpected internal failure' }
  reportUnexpectedError(error, 'Please try again')
  reportUnexpectedError(error, 'Please try again')
  reportUnexpectedError(new Error('Missing email'), 'Missing email')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(reports.length, 1)
  assert.equal(reports[0].target_workspace_id, 'test-workspace')
})
