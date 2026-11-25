import assert from "node:assert/strict"
import test from "node:test"

import { imageKind, isPngOrJpegDataUrl } from "../src/lib/file-signature.ts"

const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")
const jpeg = Buffer.from("ffd8ffe000104a46494600010100", "hex")
const exe = Buffer.from("4d5a90000300000004000000ffff0000", "hex")
const dataUrl = (type, bytes) => `data:image/${type};base64,${bytes.toString("base64")}`

test("recognises real PNG and JPEG bytes", () => {
  assert.equal(imageKind(png), "png")
  assert.equal(imageKind(jpeg), "jpeg")
})

test("rejects an executable, a script and empty content", () => {
  assert.equal(imageKind(exe), null)
  assert.equal(imageKind(Buffer.from("<script>alert(1)</script>")), null)
  assert.equal(imageKind(Buffer.alloc(0)), null)
})

test("accepts a data URL whose bytes match its declared type", () => {
  assert.equal(isPngOrJpegDataUrl(dataUrl("png", png)), true)
  assert.equal(isPngOrJpegDataUrl(dataUrl("jpeg", jpeg)), true)
})

test("rejects a data URL that lies about its type", () => {
  assert.equal(isPngOrJpegDataUrl(dataUrl("png", exe)), false)
  assert.equal(isPngOrJpegDataUrl(dataUrl("png", jpeg)), false)
  assert.equal(isPngOrJpegDataUrl(dataUrl("jpeg", png)), false)
})

test("rejects SVG, HTML and non-image data URLs", () => {
  assert.equal(isPngOrJpegDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), false)
  assert.equal(isPngOrJpegDataUrl("data:text/html;base64,PGgxPmhpPC9oMT4="), false)
  assert.equal(isPngOrJpegDataUrl("javascript:alert(1)"), false)
  assert.equal(isPngOrJpegDataUrl(""), false)
})
