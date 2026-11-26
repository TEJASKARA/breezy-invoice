import { useEffect, useRef, type ChangeEvent } from "react"
import { ImagePlus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { documentFonts, loadDocumentFontCss, documentFontCss, type BuiltInFontStyle } from "@/lib/document-fonts"
import { isPngOrJpegDataUrl } from "@/lib/file-signature"
import { tint, type HeaderLayout, type PageBorder, type TableStyle, type TemplateStyleOptions, type TotalsStyle } from "@/lib/template-style"
import { cn } from "@/lib/utils"

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
const builtInFonts: { value: BuiltInFontStyle; label: string }[] = [
  { value: "sans", label: "Helvetica (built-in)" },
  { value: "serif", label: "Times (built-in)" },
  { value: "mono", label: "Courier (built-in)" },
]

/** Font choice: a library font, or one of the three built-in PDF fonts. */
export function FontPicker({ id, fontFamily, fontStyle, disabled, onChange }: {
  id: string
  fontFamily?: string
  fontStyle?: BuiltInFontStyle
  disabled?: boolean
  onChange: (change: { fontFamily?: string; fontStyle?: BuiltInFontStyle }) => void
}) {
  useEffect(() => { loadDocumentFontCss(fontFamily) }, [fontFamily])
  const value = fontFamily && documentFonts.some((font) => font.id === fontFamily) ? fontFamily : `builtin:${fontStyle || "sans"}`
  const categories = [...new Set(documentFonts.map((font) => font.category))]
  return <div className="space-y-2">
    <select id={id} className={selectClass} disabled={disabled} value={value} onChange={(event) => {
      const next = event.target.value
      if (next.startsWith("builtin:")) onChange({ fontFamily: undefined, fontStyle: next.slice(8) as BuiltInFontStyle })
      else onChange({ fontFamily: next })
    }}>
      <optgroup label="Built-in">{builtInFonts.map((font) => <option key={font.value} value={`builtin:${font.value}`}>{font.label}</option>)}</optgroup>
      {categories.map((category) => <optgroup key={category} label={category}>{documentFonts.filter((font) => font.category === category).map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}</optgroup>)}
    </select>
    <p className="truncate rounded-md border bg-muted/30 px-3 py-2 text-base" style={{ fontFamily: documentFontCss(fontFamily, fontStyle) }}>Tax Invoice · INV-0042 · ₹1,18,000.00</p>
  </div>
}

/** Small picture of a template style, drawn from its options. */
export function StyleThumbnail({ style, pageColor }: { style: TemplateStyleOptions; pageColor: string }) {
  const centered = style.headerLayout === "centered"
  const logoRight = style.headerLayout === "logo-right"
  return (
    <div className={cn("relative aspect-[1.45] overflow-hidden rounded-md border shadow-sm", style.pageBorder === "double" && "border-4 border-double", style.pageBorder === "thin" && "border-2")} style={{ backgroundColor: pageColor, borderColor: style.pageBorder !== "none" ? style.headerColor : undefined }}>
      {style.backgroundImageDataUrl ? <img src={style.backgroundImageDataUrl} alt="" className="absolute inset-0 size-full object-fill opacity-60" /> : null}
      <div className="relative">
        {style.topStrip && !style.headerBand ? <div className="h-1.5" style={{ backgroundColor: style.headerColor }} /> : null}
        <div className={cn("flex gap-1.5 px-2 pb-1.5 pt-1.5", centered ? "flex-col items-center" : logoRight ? "flex-row-reverse justify-between" : "justify-between")} style={style.headerBand ? { backgroundColor: style.headerColor } : undefined}>
          <div className={cn("flex items-center gap-1", logoRight && "flex-row-reverse")}><div className="size-2.5 rounded-sm" style={{ backgroundColor: style.headerBand ? "#fff" : style.headerColor }} /><div className="h-1.5 w-9 rounded-full" style={{ backgroundColor: style.headerBand ? "#ffffffcc" : style.textColor }} /></div>
          <div className="h-1.5 w-7 rounded-full" style={{ backgroundColor: style.headerBand ? "#fff" : style.headerColor }} />
        </div>
        {!style.headerBand ? <div className="mx-2 h-px" style={{ backgroundColor: style.quietHeader ? "#e4e4e7" : style.headerColor }} /> : null}
        <div className={cn("mx-2 mt-1.5 overflow-hidden", style.rounded && "rounded-sm", style.tableStyle === "boxed" && "border border-slate-300")}>
          <div className="h-1.5" style={{ backgroundColor: style.tableHeadFilled ? style.tableHeadColor : "#e4e4e7" }} />
          {[0, 1, 2].map((row) => <div key={row} className={cn("h-1.5", style.tableStyle === "lines" && "border-b border-slate-200", style.tableStyle === "boxed" && "border-b border-slate-300")} style={style.tableStyle === "striped" && row % 2 === 1 ? { backgroundColor: tint(style.tableHeadColor, 0.85) } : undefined} />)}
        </div>
        <div className={cn("mx-2 mt-1.5 h-2", style.rounded && "rounded-sm", style.totalsStyle === "outline" && "border")} style={{ backgroundColor: style.totalsStyle === "filled" ? style.headerColor : style.totalsStyle === "soft" ? "#e4e4e7" : undefined, borderColor: style.headerColor }} />
      </div>
    </div>
  )
}

function Choice<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean }) {
  return <div className="space-y-1.5">
    <Label className="text-xs">{label}</Label>
    <div className={cn("grid gap-1.5", options.length === 4 ? "grid-cols-2" : "grid-cols-3")}>
      {options.map((option) => <Button key={option.value} type="button" size="sm" disabled={disabled} variant={value === option.value ? "default" : "outline"} onClick={() => onChange(option.value)}>{option.label}</Button>)}
    </div>
  </div>
}

function Toggle({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
    <span><span className="block font-medium">{label}</span>{description ? <span className="block text-xs text-muted-foreground">{description}</span> : null}</span>
    <input type="checkbox" className="size-4 accent-foreground" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
  </label>
}

export function ColourField({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <div className="space-y-1.5">
    <Label htmlFor={id} className="text-xs">{label}</Label>
    <div className="flex items-center gap-2">
      <Input id={id} type="color" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value.toUpperCase())} className="size-9 shrink-0 p-1" />
      <Input value={value} disabled={disabled} aria-label={`${label} hex value`} className="h-9 font-mono text-xs" onChange={(event) => { const next = event.target.value.toUpperCase(); if (/^#[0-9A-F]{6}$/.test(next)) onChange(next) }} />
    </div>
  </div>
}

const MAX_BACKGROUND_BYTES = 3 * 1024 * 1024

/** Full-page background image picker (PNG/JPG). Reports errors through onError. */
export function BackgroundImageField({ value, onChange, onError, disabled, hint }: { value: string | null; onChange: (value: string | null) => void; onError: (message: string) => void; disabled?: boolean; hint?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const read = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (!["image/png", "image/jpeg"].includes(file.type)) return onError("Upload the background as a PNG or JPG image.")
    if (file.size > MAX_BACKGROUND_BYTES) return onError("The background image must be smaller than 3 MB.")
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      if (!isPngOrJpegDataUrl(result)) return onError("That file is not a real PNG or JPG image, so it was not added.")
      onChange(result)
    }
    reader.onerror = () => onError("The image could not be read.")
    reader.readAsDataURL(file)
  }
  return <div className="space-y-1.5">
    <Label className="text-xs">Full-page background</Label>
    <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" onChange={read} />
    {value ? <div className="flex items-center gap-2 rounded-lg border p-2"><img src={value} alt="Page background" className="h-14 w-10 rounded border object-cover" /><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>Replace</Button><Button type="button" size="icon" variant="ghost" aria-label="Remove background" disabled={disabled} onClick={() => onChange(null)}><Trash2 /></Button></div>
      : <Button type="button" variant="outline" className="w-full justify-start border-dashed" disabled={disabled} onClick={() => input.current?.click()}><ImagePlus />Upload background (A4, PNG or JPG)</Button>}
    {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
  </div>
}

/** All the options of the Custom template style. */
export function CustomStyleEditor({ value, onChange, onError, disabled }: { value: TemplateStyleOptions; onChange: (changes: Partial<TemplateStyleOptions>) => void; onError: (message: string) => void; disabled?: boolean }) {
  return <div className="space-y-4 rounded-lg border p-3">
    <Choice<HeaderLayout> label="Header layout" value={value.headerLayout} disabled={disabled} onChange={(headerLayout) => onChange({ headerLayout })} options={[{ value: "logo-left", label: "Logo left" }, { value: "centered", label: "Centred" }, { value: "logo-right", label: "Logo right" }]} />
    <Toggle label="Colour band behind the header" checked={value.headerBand} disabled={disabled} onChange={(headerBand) => onChange({ headerBand })} />
    <Toggle label="Colour strip at the top" checked={value.topStrip} disabled={disabled || value.headerBand} onChange={(topStrip) => onChange({ topStrip })} />
    <Toggle label="Smaller header" description="Lighter divider and smaller company name" checked={value.quietHeader} disabled={disabled} onChange={(quietHeader) => onChange({ quietHeader })} />
    <Choice<TableStyle> label="Item table" value={value.tableStyle} disabled={disabled} onChange={(tableStyle) => onChange({ tableStyle })} options={[{ value: "lines", label: "Lines" }, { value: "striped", label: "Striped" }, { value: "boxed", label: "Boxed" }, { value: "plain", label: "Plain" }]} />
    <Toggle label="Coloured table header" checked={value.tableHeadFilled} disabled={disabled} onChange={(tableHeadFilled) => onChange({ tableHeadFilled })} />
    <Choice<PageBorder> label="Page border" value={value.pageBorder} disabled={disabled} onChange={(pageBorder) => onChange({ pageBorder })} options={[{ value: "none", label: "None" }, { value: "thin", label: "Thin" }, { value: "double", label: "Double" }]} />
    <Choice<TotalsStyle> label="Totals box" value={value.totalsStyle} disabled={disabled} onChange={(totalsStyle) => onChange({ totalsStyle })} options={[{ value: "filled", label: "Filled" }, { value: "soft", label: "Soft" }, { value: "outline", label: "Outline" }]} />
    <Toggle label="Rounded corners" checked={value.rounded} disabled={disabled} onChange={(rounded) => onChange({ rounded })} />
    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
      <ColourField id="custom-header-colour" label="Header colour" value={value.headerColor} disabled={disabled} onChange={(headerColor) => onChange({ headerColor })} />
      <ColourField id="custom-table-colour" label="Table header" value={value.tableHeadColor} disabled={disabled} onChange={(tableHeadColor) => onChange({ tableHeadColor })} />
      <ColourField id="custom-text-colour" label="Text" value={value.textColor} disabled={disabled} onChange={(textColor) => onChange({ textColor })} />
    </div>
    <BackgroundImageField value={value.backgroundImageDataUrl} disabled={disabled} onChange={(backgroundImageDataUrl) => onChange({ backgroundImageDataUrl })} onError={onError} hint="For a pre-printed letterpad: the invoice is printed on top. Use a light design so the text stays readable." />
  </div>
}
