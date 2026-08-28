import { supabase } from "@/lib/supabase"

const bucket = "expense-bills"

function storage() {
  if (!supabase) throw new Error("Supabase is not configured.")
  return supabase.storage.from(bucket)
}

function safeFileName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase()}` : ""
  const base = name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "bill"
  return `${base}${extension}`
}

export async function uploadExpenseBill(userId: string, file: File) {
  const path = `${userId}/${crypto.randomUUID()}/${safeFileName(file.name)}`
  const { error } = await storage().upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  return path
}

export async function downloadExpenseBill(path: string, fileName: string) {
  const { data, error } = await storage().download(path)
  if (error) throw new Error(error.message)
  const url = URL.createObjectURL(data)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName || "expense-bill"
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function getExpenseBillFile(path: string) {
  const { data, error } = await storage().download(path)
  if (error) throw new Error(error.message)
  return new Uint8Array(await data.arrayBuffer())
}

export async function removeExpenseBill(path: string) {
  const { error } = await storage().remove([path])
  if (error) throw new Error(error.message)
}
