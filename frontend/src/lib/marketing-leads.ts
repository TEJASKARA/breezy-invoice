/**
 * Cleans daily GST-registration and MCA-incorporation exports into one
 * de-duplicated list of marketing contacts. Pure: no imports, safe for tests.
 */
export type MarketingSource = "gst" | "mca"

export type MarketingLead = {
  email: string
  contact_name: string | null
  business_name: string | null
  phone: string | null
  state: string | null
  city: string | null
  source: MarketingSource
  source_ref: string | null
  registered_on: string | null
  details: Record<string, string>
}

export type MarketingCleanResult = {
  source: MarketingSource
  totalRows: number
  leads: MarketingLead[]
  missingEmail: number
  invalidEmail: number
  duplicateInFile: number
}

type Row = Record<string, unknown>

/** "ï»¿GSTIN", "Registered Email Address", "directorEmail" -> "gstin", "registeredemailaddress", "directoremail". */
const columnKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")

const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/
const PLACEHOLDER = /^(?:na|n\/a|nil|none|null|-+|\.+|0+|test|xyz)$/i

function indexRow(row: Row) {
  const indexed = new Map<string, unknown>()
  for (const [column, value] of Object.entries(row)) indexed.set(columnKey(column), value)
  return indexed
}

function text(row: Map<string, unknown>, ...columns: string[]) {
  for (const column of columns) {
    const value = row.get(columnKey(column))
    if (value === null || value === undefined) continue
    const cleaned = String(value).replace(/[\p{Cc}`]+/gu, " ").replace(/\s+/g, " ").trim()
    if (cleaned && !PLACEHOLDER.test(cleaned)) return cleaned
  }
  return null
}

/** Lower-cased, first address only, or null when it cannot receive email. */
export function cleanEmail(value: unknown): { email: string | null; reason: "missing" | "invalid" | null } {
  const raw = String(value ?? "").trim()
  if (!raw || PLACEHOLDER.test(raw)) return { email: null, reason: "missing" }
  const first = raw.replace(/^mailto:/i, "").split(/[\s,;/]+/).find(Boolean) ?? ""
  const email = first.toLowerCase().replace(/^[<("']+|[>)"'.]+$/g, "")
  if (email.length > 254 || !EMAIL.test(email) || email.includes("..")) return { email: null, reason: "invalid" }
  return { email, reason: null }
}

/** Indian mobile numbers as +91XXXXXXXXXX; other numbers keep their digits with a leading +. */
export function cleanPhone(value: unknown): string | null {
  let digits = String(value ?? "").replace(/\D/g, "")
  if (!digits) return null
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1)
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
}

/** "ARYA DAS" -> "Arya Das"; mixed-case names are kept as written. */
export function cleanName(value: string | null): string | null {
  if (!value) return null
  if (value !== value.toUpperCase()) return value
  return value.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_match, start: string, letter: string) => `${start}${letter.toUpperCase()}`)
}

/** Accepts Date objects, Excel serials, ISO and dd-mm-yyyy / dd/mm/yyyy. Returns YYYY-MM-DD or null. */
export function cleanDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Spreadsheet readers return dates a few seconds before midnight; round to the nearest day.
    const rounded = new Date(value.getTime() + 12 * 3_600_000)
    const day = new Date(rounded.getFullYear(), rounded.getMonth(), rounded.getDate())
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
  }
  if (typeof value === "number" && value > 20_000 && value < 80_000) {
    return new Date(Math.round((value - 25_569) * 86_400_000)).toISOString().slice(0, 10)
  }
  const raw = String(value ?? "").trim()
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (dmy) {
    const candidate = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`
    const parsed = new Date(`${candidate}T00:00:00Z`)
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate) return candidate
  }
  return null
}

export function detectMarketingSource(rows: Row[]): MarketingSource | null {
  const columns = new Set(rows.slice(0, 5).flatMap((row) => Object.keys(row).map(columnKey)))
  if (columns.has("registeredemailaddress") || (columns.has("gstin") && columns.has("businessname"))) return "gst"
  if (columns.has("directoremail") || (columns.has("entityid") && columns.has("directorname"))) return "mca"
  return null
}

function compact(details: Record<string, string | null>) {
  return Object.fromEntries(Object.entries(details).filter((entry): entry is [string, string] => Boolean(entry[1])))
}

function gstLead(row: Map<string, unknown>, email: string): MarketingLead {
  const legalName = text(row, "Name")
  return {
    email,
    contact_name: cleanName(legalName),
    business_name: text(row, "Business Name", "Trade Name") ?? legalName,
    phone: cleanPhone(row.get("registeredmobilenumber") ?? row.get("mobile")),
    state: text(row, "State"),
    city: text(row, "City", "District"),
    source: "gst",
    source_ref: text(row, "GSTIN")?.toUpperCase() ?? null,
    registered_on: cleanDate(row.get("dateofregistration")),
    details: compact({
      business_nature: text(row, "Business Nature"),
      business_type: text(row, "Business Type"),
      pincode: text(row, "Zipcode", "Pincode")?.replace(/\.0+$/, "") ?? null,
    }),
  }
}

function mcaLead(row: Map<string, unknown>, email: string): MarketingLead {
  return {
    email,
    contact_name: cleanName(text(row, "directorName")),
    business_name: text(row, "name", "companyName"),
    phone: cleanPhone(row.get("directormobile")),
    state: text(row, "state"),
    city: null,
    source: "mca",
    source_ref: text(row, "entityId", "CIN")?.toUpperCase() ?? null,
    registered_on: cleanDate(row.get("dateofincorporation")),
    details: compact({
      entity_type: text(row, "entityType"),
      industry: text(row, "nicLabel"),
      company_class: text(row, "classOfCompany"),
      paid_up_capital: text(row, "paidUpCapital"),
      roc: text(row, "roc"),
    }),
  }
}

export function cleanMarketingRows(rows: Row[], source = detectMarketingSource(rows)): MarketingCleanResult {
  if (!source) {
    throw new Error("This file is not a recognised GST or MCA export. Expected a 'Registered Email Address' (GST) or 'directorEmail' (MCA) column.")
  }
  const seen = new Set<string>()
  const leads: MarketingLead[] = []
  let missingEmail = 0
  let invalidEmail = 0
  let duplicateInFile = 0
  let totalRows = 0
  for (const original of rows) {
    const row = indexRow(original)
    if (![...row.values()].some((value) => String(value ?? "").trim())) continue
    totalRows += 1
    const { email, reason } = cleanEmail(source === "gst" ? row.get("registeredemailaddress") ?? row.get("email") : row.get("directoremail") ?? row.get("email"))
    if (!email) {
      if (reason === "invalid") invalidEmail += 1
      else missingEmail += 1
      continue
    }
    if (seen.has(email)) { duplicateInFile += 1; continue }
    seen.add(email)
    leads.push(source === "gst" ? gstLead(row, email) : mcaLead(row, email))
  }
  return { source, totalRows, leads, missingEmail, invalidEmail, duplicateInFile }
}
