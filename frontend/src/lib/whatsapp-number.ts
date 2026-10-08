/** Normalize a formatted phone number to the digits-only format WhatsApp accepts. */
export function normalizeWhatsAppNumber(value: string): string | null {
  let digits = value.trim().replace(/[\s\-().]/g, "")
  if (digits.startsWith("+")) digits = digits.slice(1)
  else if (digits.startsWith("00")) digits = digits.slice(2)
  if (!/^[0-9]+$/.test(digits)) return null
  if (digits.length === 10 && /^[6-9]/.test(digits)) digits = `91${digits}`
  else if (digits.length === 11 && /^0[6-9]/.test(digits)) digits = `91${digits.slice(1)}`
  return digits.length >= 10 && digits.length <= 15 && !digits.startsWith("0") ? digits : null
}
