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

export const parseDocumentStatus = (value: string): "Draft" | "Generated" =>
  value.toLowerCase() === "generated" ? "Generated" : "Draft"
