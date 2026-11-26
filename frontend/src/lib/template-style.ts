/**
 * Layout options for invoice and quotation templates. Every ready-made style
 * is a set of these options; "custom" lets the user set each one. The PDF
 * renderer and the on-screen preview both read the resolved options, so they
 * stay in step.
 */
export type TemplatePresetId = "classic" | "breeze" | "minimal" | "bold" | "elegant" | "corporate" | "modern" | "ledger" | "custom"

export type HeaderLayout = "logo-left" | "logo-right" | "centered"
export type TableStyle = "lines" | "striped" | "boxed" | "plain"
export type PageBorder = "none" | "thin" | "double"
export type TotalsStyle = "filled" | "soft" | "outline"

export type TemplateStyleOptions = {
  headerLayout: HeaderLayout
  /** Header area printed on a colour band, with white text. */
  headerBand: boolean
  /** Thin colour strip across the top of the page. */
  topStrip: boolean
  pageBorder: PageBorder
  tableStyle: TableStyle
  /** Table header filled with the table colour (white text); otherwise light grey. */
  tableHeadFilled: boolean
  rounded: boolean
  totalsStyle: TotalsStyle
  /** Smaller company name and title, light divider (the Minimal look). */
  quietHeader: boolean
  /** Band, title and label colour. */
  headerColor: string
  tableHeadColor: string
  textColor: string
  /** Full-page background, e.g. a scanned pre-printed letterpad. */
  backgroundImageDataUrl: string | null
}

export const DEFAULT_TEXT_COLOR = "#18181B"

type PresetDefinition = { id: Exclude<TemplatePresetId, "custom">; name: string; description: string; options: (accent: string) => Omit<TemplateStyleOptions, "backgroundImageDataUrl"> }

const base = (accent: string) => ({ headerColor: accent, tableHeadColor: accent, textColor: DEFAULT_TEXT_COLOR, quietHeader: false, headerBand: false, topStrip: false, rounded: false })

export const templatePresets: PresetDefinition[] = [
  { id: "breeze", name: "Modern Breeze", description: "Bold, modern and brand-forward", options: (accent) => ({ ...base(accent), headerLayout: "logo-left", topStrip: true, pageBorder: "none", tableStyle: "lines", tableHeadFilled: true, rounded: true, totalsStyle: "filled" }) },
  { id: "classic", name: "Classic Ledger", description: "Traditional bordered GST invoice", options: (accent) => ({ ...base(accent), headerLayout: "logo-left", pageBorder: "double", tableStyle: "lines", tableHeadFilled: false, totalsStyle: "outline" }) },
  { id: "minimal", name: "Minimal Professional", description: "Clean layout with generous spacing", options: (accent) => ({ ...base(accent), headerLayout: "logo-left", pageBorder: "none", tableStyle: "lines", tableHeadFilled: false, totalsStyle: "soft", quietHeader: true }) },
  { id: "bold", name: "Bold Banner", description: "Company name on a full colour band", options: (accent) => ({ ...base(accent), headerLayout: "logo-left", headerBand: true, pageBorder: "none", tableStyle: "striped", tableHeadFilled: true, rounded: true, totalsStyle: "filled" }) },
  { id: "elegant", name: "Elegant Centered", description: "Centred letterhead with a fine border", options: (accent) => ({ ...base(accent), headerLayout: "centered", pageBorder: "thin", tableStyle: "plain", tableHeadFilled: false, totalsStyle: "outline", quietHeader: true }) },
  { id: "corporate", name: "Corporate Grid", description: "Logo on the right, fully boxed table", options: (accent) => ({ ...base(accent), headerLayout: "logo-right", pageBorder: "none", tableStyle: "boxed", tableHeadFilled: true, totalsStyle: "soft" }) },
  { id: "modern", name: "Modern Stripe", description: "Striped rows and rounded corners", options: (accent) => ({ ...base(accent), headerLayout: "logo-left", topStrip: true, pageBorder: "none", tableStyle: "striped", tableHeadFilled: false, rounded: true, totalsStyle: "filled" }) },
  { id: "ledger", name: "Accounts Ledger", description: "Boxed table inside a thin page border", options: (accent) => ({ ...base(accent), headerLayout: "logo-left", pageBorder: "thin", tableStyle: "boxed", tableHeadFilled: true, totalsStyle: "outline", tableHeadColor: "#334155" }) },
]

export const customPreset = { id: "custom" as const, name: "Custom", description: "Choose the layout, table, borders and colours yourself" }

const validLayouts: HeaderLayout[] = ["logo-left", "logo-right", "centered"]
const validTables: TableStyle[] = ["lines", "striped", "boxed", "plain"]
const validBorders: PageBorder[] = ["none", "thin", "double"]
const validTotals: TotalsStyle[] = ["filled", "soft", "outline"]
const hex = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback

/** The options for a template: its preset's, or for Custom, the user's choices (starting from Modern Breeze). */
export function resolveTemplateStyle(template: { preset?: string; accentColor: string; customStyle?: Partial<TemplateStyleOptions> | null }): TemplateStyleOptions {
  const preset = templatePresets.find((item) => item.id === template.preset)
  if (preset) return { ...preset.options(template.accentColor), backgroundImageDataUrl: null }
  const start = templatePresets[0].options(template.accentColor)
  const custom = template.customStyle || {}
  return {
    headerLayout: validLayouts.includes(custom.headerLayout as HeaderLayout) ? custom.headerLayout as HeaderLayout : start.headerLayout,
    headerBand: typeof custom.headerBand === "boolean" ? custom.headerBand : start.headerBand,
    topStrip: typeof custom.topStrip === "boolean" ? custom.topStrip : start.topStrip,
    pageBorder: validBorders.includes(custom.pageBorder as PageBorder) ? custom.pageBorder as PageBorder : start.pageBorder,
    tableStyle: validTables.includes(custom.tableStyle as TableStyle) ? custom.tableStyle as TableStyle : start.tableStyle,
    tableHeadFilled: typeof custom.tableHeadFilled === "boolean" ? custom.tableHeadFilled : start.tableHeadFilled,
    rounded: typeof custom.rounded === "boolean" ? custom.rounded : start.rounded,
    totalsStyle: validTotals.includes(custom.totalsStyle as TotalsStyle) ? custom.totalsStyle as TotalsStyle : start.totalsStyle,
    quietHeader: typeof custom.quietHeader === "boolean" ? custom.quietHeader : start.quietHeader,
    headerColor: hex(custom.headerColor, template.accentColor),
    tableHeadColor: hex(custom.tableHeadColor, template.accentColor),
    textColor: hex(custom.textColor, DEFAULT_TEXT_COLOR),
    backgroundImageDataUrl: typeof custom.backgroundImageDataUrl === "string" ? custom.backgroundImageDataUrl : null,
  }
}

/** Starting point when switching to Custom: the look of the style currently selected. */
export function customStyleFrom(template: { preset?: string; accentColor: string; customStyle?: Partial<TemplateStyleOptions> | null }): TemplateStyleOptions {
  return resolveTemplateStyle(template)
}

/** Light tint of a colour, for striped rows and soft fills. */
export function tint(hexColor: string, amount = 0.9) {
  const value = /^#[0-9a-f]{6}$/i.test(hexColor) ? hexColor.slice(1) : "2563EB"
  const channel = (offset: number) => Math.round(Number.parseInt(value.slice(offset, offset + 2), 16) * (1 - amount) + 255 * amount)
  return `#${[0, 2, 4].map((offset) => channel(offset).toString(16).padStart(2, "0")).join("")}`.toUpperCase()
}
