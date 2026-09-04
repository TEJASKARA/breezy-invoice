const normalizeColumn = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")

export const pickCell = (row: Record<string, unknown>, ...names: string[]) => {
  const normalizedNames = new Set(names.map(normalizeColumn))
  const match = Object.entries(row).find(([column]) => normalizedNames.has(normalizeColumn(column)))
  return String(match?.[1] ?? "").trim()
}

export async function readSpreadsheet(file: File) {
  const XLSX = await import("xlsx")
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "", raw: false })
}

export const parseMoney = (value: string) => Number(value.replace(/[₹,\s]/g, ""))

export function normalizeSpreadsheetDate(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  const separated = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/)
  if (separated) {
    const [, day, month, suppliedYear] = separated
    const year = suppliedYear.length === 2 ? `20${suppliedYear}` : suppliedYear
    const candidate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    const parsed = new Date(`${candidate}T00:00:00Z`)
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate) return candidate
  }

  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString().slice(0, 10)
}

export const parseDocumentStatus = (value: string): "Draft" | "Generated" =>
  value.toLowerCase() === "generated" ? "Generated" : "Draft"
