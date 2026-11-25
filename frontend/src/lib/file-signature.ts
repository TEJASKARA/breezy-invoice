/** Content checks for picked images: trust the file's bytes, not its name or declared type. */

/** The real image type from the first bytes, or null when it is not a PNG or JPEG. */
export function imageKind(bytes: ArrayLike<number>): "png" | "jpeg" | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) return "png"
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  return null
}

/** True only for a data URL that declares PNG/JPEG and really contains one. */
export function isPngOrJpegDataUrl(dataUrl: string): boolean {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) return false
  try {
    const head = atob(match[2].slice(0, 16))
    const bytes = Array.from(head, (character) => character.charCodeAt(0))
    return imageKind(bytes) === match[1]
  } catch {
    return false
  }
}
