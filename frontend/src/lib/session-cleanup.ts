/**
 * Removes personal business data (customers, employees, salaries, invoice and customer
 * drafts) that the app keeps in this browser, so nothing is left behind for the next
 * person on a shared computer. Free-tool (signed-out) data, the theme and other
 * non-personal settings are kept.
 */
export const SIGNED_IN_DATA_PREFIXES = [
  "breezyaccounts-mvp-data", // old whole-workspace cache, plain and ":<user id>"
  "breezyinvoice-workspace:", // whole-workspace cache
  "chanax.invoice-draft", // unsaved invoice forms
  "chanax.quotation-form-draft", // unsaved quotation forms
  "chanax.entity-draft:", // unsaved company/customer forms
]

type KeyedStorage = Pick<Storage, "length" | "key" | "removeItem">

function browserStorage(): KeyedStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage } catch { return null }
}

/** Returns how many entries were removed. Never throws. */
export function clearSignedInBrowserData(storage: KeyedStorage | null = browserStorage()): number {
  if (!storage) return 0
  try {
    const doomed: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key && SIGNED_IN_DATA_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key)
    }
    doomed.forEach((key) => storage.removeItem(key))
    return doomed.length
  } catch {
    return 0
  }
}
