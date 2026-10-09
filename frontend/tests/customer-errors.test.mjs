import assert from "node:assert/strict"
import test from "node:test"
import { customerErrorMessage } from "../src/lib/customer-errors.ts"

const fallback = "We couldn't save your changes. Please try again."

test("infrastructure details never become customer copy", () => {
  for (const message of [
    "Could not find public.breezy_delete_entity in the schema cache",
    "Supabase is not configured. Add VITE_SUPABASE_URL",
    "Your workspace needs a database migration",
    "ERROR: syntax error at or near create (SQLSTATE 42601)",
    "Failed to make POST request to https://project.supabase.co/auth/v1/invite",
    "relation breezy_entities does not exist",
    "column transferred_at does not exist",
    "Could not find the function public.some_action",
    "Cannot read properties of undefined (reading payload)",
    "Unexpected token at JSON position 0",
    "[object Object]",
    "WhiteBooks did not return an access token.",
    "The ChanaX backend URL has not been configured.",
  ]) assert.equal(customerErrorMessage(new Error(message), fallback), fallback)
})

test("missing functions and unexpected database codes are hidden", () => {
  assert.equal(customerErrorMessage({ code: "PGRST202", message: "Function missing" }, fallback), fallback)
  assert.equal(customerErrorMessage({ code: "22003", message: "integer out of range" }, fallback), fallback)
  assert.equal(customerErrorMessage({ code: "42P13", message: "cannot change parameter name" }, fallback), fallback)
})

test("linked-record failures have useful plain-language instructions", () => {
  const result = customerErrorMessage({ code: "23503", message: "breezy_invoices_entity_id_fkey foreign key constraint" })
  assert.match(result, /linked to other records/)
  assert.doesNotMatch(result, /breezy|constraint|schema|supabase/i)
})

test("validation and confirmation messages remain actionable", () => {
  for (const message of [
    "Type the company name exactly to confirm permanent deletion.",
    "Cancel the pending account transfer before deleting this company.",
    "Enter a valid WhatsApp number with its country code.",
    "Add an email address to the employee profile before sending the email.",
    "The GST number could not be found. Check the number and try again.",
  ]) assert.equal(customerErrorMessage({ code: "P0001", message }, fallback), message)
  assert.match(customerErrorMessage(new Error("This GST number is already registered in ChanaX.")), /already registered/)
})

test("login and connection errors give customer instructions", () => {
  assert.match(customerErrorMessage(new Error("Invalid login credentials")), /email or password/)
  assert.match(customerErrorMessage(new Error("Email not confirmed")), /confirm your email/)
  assert.match(customerErrorMessage(new Error("Load failed")), /internet connection/)
  assert.match(customerErrorMessage(new Error("JWT expired")), /sign in again/)
  assert.match(customerErrorMessage({ code: "42501", message: "permission denied for table breezy_entities" }), /workspace owner/)
})

test("unknown or malformed errors use safe defaults", () => {
  assert.equal(customerErrorMessage(null, fallback), fallback)
  assert.equal(customerErrorMessage({ detail: [] }, fallback), fallback)
  assert.equal(customerErrorMessage(new Error("x".repeat(600)), fallback), fallback)
  assert.doesNotMatch(customerErrorMessage(null, "Supabase failed"), /supabase/i)
})
