import assert from "node:assert/strict"
import test from "node:test"
import { customStyleFrom, resolveTemplateStyle, templatePresets, tint } from "../src/lib/template-style.ts"
import { builtInPdfFont, documentFontCss, documentFonts, findDocumentFont } from "../src/lib/document-fonts.ts"

test("the three original styles keep their look", () => {
  const breeze = resolveTemplateStyle({ preset: "breeze", accentColor: "#2563EB" })
  assert.equal(breeze.topStrip, true); assert.equal(breeze.tableHeadFilled, true); assert.equal(breeze.totalsStyle, "filled"); assert.equal(breeze.rounded, true)
  const classic = resolveTemplateStyle({ preset: "classic", accentColor: "#2563EB" })
  assert.equal(classic.pageBorder, "double"); assert.equal(classic.totalsStyle, "outline")
  const minimal = resolveTemplateStyle({ preset: "minimal", accentColor: "#2563EB" })
  assert.equal(minimal.quietHeader, true); assert.equal(minimal.totalsStyle, "soft")
})

test("ready-made styles follow the brand colour", () => {
  for (const preset of templatePresets) {
    const style = resolveTemplateStyle({ preset: preset.id, accentColor: "#059669" })
    assert.equal(style.headerColor, "#059669", preset.id)
    assert.equal(style.backgroundImageDataUrl, null)
  }
  assert.ok(templatePresets.length >= 8)
})

test("custom keeps valid choices and falls back for invalid ones", () => {
  const style = resolveTemplateStyle({ preset: "custom", accentColor: "#2563EB", customStyle: { headerLayout: "centered", tableStyle: "sideways", headerColor: "red", textColor: "#111111", backgroundImageDataUrl: "data:image/png;base64,AAAA" } })
  assert.equal(style.headerLayout, "centered")
  assert.equal(style.tableStyle, "lines")
  assert.equal(style.headerColor, "#2563EB")
  assert.equal(style.textColor, "#111111")
  assert.equal(style.backgroundImageDataUrl, "data:image/png;base64,AAAA")
})

test("switching to custom starts from the current look", () => {
  const start = customStyleFrom({ preset: "corporate", accentColor: "#7C3AED" })
  assert.equal(start.headerLayout, "logo-right")
  assert.equal(start.tableStyle, "boxed")
})

test("tint lightens a colour", () => {
  assert.equal(tint("#000000", 0.5), "#808080")
  assert.equal(tint("#FFFFFF", 0.9), "#FFFFFF")
})

test("font library: every font has files named by id and a CSS family", () => {
  assert.equal(documentFonts.length, 25)
  assert.equal(new Set(documentFonts.map((font) => font.id)).size, 25)
  for (const font of documentFonts) assert.match(font.id, /^[a-z0-9-]+$/)
  assert.equal(findDocumentFont("poppins")?.name, "Poppins")
  assert.match(documentFontCss("lora"), /ChanaX Lora/)
  assert.equal(builtInPdfFont("serif"), "times")
  assert.equal(builtInPdfFont(undefined), "helvetica")
})

test("every library font ships regular and bold files", async () => {
  const { existsSync } = await import("node:fs")
  for (const font of documentFonts) {
    for (const weight of ["regular", "bold"]) assert.ok(existsSync(new URL(`../public/fonts/${font.id}-${weight}.ttf`, import.meta.url)), `${font.id}-${weight}`)
  }
})
