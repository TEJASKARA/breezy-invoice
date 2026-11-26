import { useEffect, useMemo, useRef, useState } from "react"
import { Download, ImagePlus, LoaderCircle, RotateCcw, Save, Trash2 } from "lucide-react"
import { Link } from "react-router-dom"

import { PageHeader } from "@/components/page-header"
import { BackgroundImageField, ColourField, FontPicker } from "@/components/template-style-controls"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useEntitySelection } from "@/lib/entity-selection"
import { createLetterheadPdf, defaultLetterhead, letterheadAccent, letterheadFileName, letterheadStyles, type LetterheadBorder, type LetterheadSettings } from "@/lib/letterhead"
import { useMvpStore } from "@/lib/mvp-store"
import { canRemoveChanaxBranding } from "@/lib/subscription-entitlements"
import { trackAction } from "@/lib/usage-tracking"
import { appPath } from "@/lib/guest-mode"
import { isPngOrJpegDataUrl } from "@/lib/file-signature"
import { cn } from "@/lib/utils"
import { useWorkspaceAccess } from "@/lib/workspace-access"

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024

/** Design the company letterhead used on employment letters, or download it blank. */
export function LetterheadPage() {
  const { companies, template: workspaceTemplate, templateFor, letterheadFor, updateLetterhead } = useMvpStore()
  const { can, subscription } = useWorkspaceAccess()
  const { selectedEntity } = useEntitySelection()
  const entity = selectedEntity ?? companies[0]
  const canManage = can("templates.manage") && !entity?.transferredAt
  // templateFor/letterheadFor build new objects on every call; memoise them so
  // the preview only redraws when the saved design or the company changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saved = useMemo(() => letterheadFor(entity?.id), [workspaceTemplate, entity?.id])
  const [draft, setDraft] = useState<LetterheadSettings | null>(null)
  const letterhead = draft ?? saved
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const template = useMemo(() => templateFor(entity?.id), [workspaceTemplate, entity?.id])
  const [preview, setPreview] = useState<{ image: string; url: string } | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const headerInput = useRef<HTMLInputElement>(null)
  const footerInput = useRef<HTMLInputElement>(null)
  const brandingCanBeRemoved = canRemoveChanaxBranding(subscription)

  useEffect(() => { setDraft(null) }, [entity?.id])

  // Live preview: the exact PDF, drawn as an image (works on phones too).
  useEffect(() => {
    let cancelled = false
    let url = ""
    const timer = window.setTimeout(() => {
      void createLetterheadPdf({ entity, template, letterhead, canRemoveBranding: brandingCanBeRemoved }).then(async (doc) => {
        if (cancelled) return
        url = URL.createObjectURL(doc.output("blob"))
        const { renderPdfPreview } = await import("@/lib/pdf-preview")
        const [image] = await renderPdfPreview(doc.output("arraybuffer"), () => cancelled)
        if (!cancelled && image) setPreview({ image, url })
      }).catch(() => { if (!cancelled) setPreview(null) })
    }, 350)
    return () => { cancelled = true; window.clearTimeout(timer); if (url) URL.revokeObjectURL(url) }
  }, [entity, template, letterhead, brandingCanBeRemoved])

  const change = (changes: Partial<LetterheadSettings>) => { if (canManage) { setDraft({ ...letterhead, ...changes }); setMessage(null) } }

  const readImage = (file: File | undefined, field: "headerImageDataUrl" | "footerImageDataUrl") => {
    if (!file) return
    if (!/^image\/(png|jpe?g)$/.test(file.type)) return setMessage({ text: "Upload a PNG or JPG image.", error: true })
    if (file.size > MAX_IMAGE_BYTES) return setMessage({ text: "The image must be smaller than 1.5 MB.", error: true })
    const reader = new FileReader()
    reader.onload = () => {
      if (!isPngOrJpegDataUrl(String(reader.result))) return setMessage({ text: "That file is not a real PNG or JPG image.", error: true })
      change({ [field]: String(reader.result), style: "image" })
    }
    reader.readAsDataURL(file)
  }

  const save = () => {
    if (!entity || !draft) return
    updateLetterhead(entity.id, draft)
    setDraft(null)
    setMessage({ text: `Letterhead saved for ${entity.companyName}. Employment letters now use it.` })
    trackAction("letterhead_saved")
  }

  const download = async () => {
    setBusy(true)
    try {
      const doc = await createLetterheadPdf({ entity, template, letterhead, canRemoveBranding: brandingCanBeRemoved })
      doc.save(letterheadFileName(entity))
      trackAction("letterhead_downloaded")
    } catch {
      setMessage({ text: "The letterhead PDF could not be created.", error: true })
    } finally {
      setBusy(false)
    }
  }

  const resetDesign = () => {
    const base = defaultLetterhead()
    change({ fontFamily: base.fontFamily, accentColor: base.accentColor, textColor: base.textColor, logoSize: base.logoSize, nameSize: base.nameSize, logoPosition: base.logoPosition, pageColor: base.pageColor, pageBorder: base.pageBorder, watermarkText: base.watermarkText, watermarkOpacity: base.watermarkOpacity, backgroundImageDataUrl: base.backgroundImageDataUrl })
  }

  const field = (id: keyof Pick<LetterheadSettings, "phone" | "email" | "website" | "registration">, label: string, placeholder: string) => (
    <div className="space-y-2"><Label htmlFor={`letterhead-${id}`}>{label}</Label><Input id={`letterhead-${id}`} value={letterhead[id]} disabled={!canManage} placeholder={placeholder} onChange={(event) => change({ [id]: event.target.value })} /></div>
  )
  const slider = (id: "logoSize" | "nameSize", label: string, min: number, max: number, unit: string) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between"><Label htmlFor={`letterhead-${id}`} className="text-xs">{label}</Label><span className="text-xs tabular-nums text-muted-foreground">{letterhead[id]} {unit}</span></div>
      <Input id={`letterhead-${id}`} type="range" min={min} max={max} step={1} value={letterhead[id]} disabled={!canManage} onChange={(event) => change({ [id]: Number(event.target.value) })} className="h-5 cursor-pointer p-0" />
    </div>
  )
  const accent = letterheadAccent(template, letterhead)
  const logoSideApplies = letterhead.style === "classic" || letterhead.style === "banner" || letterhead.style === "split"

  return <div className="space-y-6">
    <PageHeader
      eyebrow="Branding"
      title="Letterhead"
      description={`Company letterhead for ${entity?.companyName || "your company"}. It is printed on every employment letter, and you can download it blank to print.`}
      actions={<>
        <Button variant="outline" disabled={busy} onClick={() => void download()}>{busy ? <LoaderCircle className="animate-spin" /> : <Download />}Download letterhead</Button>
        {canManage ? <Button disabled={!draft} onClick={save}><Save />Save</Button> : null}
      </>}
    />
    {message ? <p role={message.error ? "alert" : "status"} className={cn("rounded-lg border p-3 text-sm", message.error ? "border-destructive/30 bg-destructive/10 text-destructive" : "bg-muted/40")}>{message.text}</p> : null}
    {!entity ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Add a company first; the letterhead uses its name and address.</p> : null}
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,440px)_1fr]">
      <Card className={cn("h-fit", !canManage && "opacity-80")}>
        <CardHeader><CardTitle>Design</CardTitle><CardDescription>The logo comes from <Link to={appPath("/settings/templates")} className="underline">Templates</Link>; everything else can be set here.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-2">
            <Label>Layout</Label>
            <div className="grid grid-cols-2 gap-2">
              {letterheadStyles.map((style) => <button key={style.id} type="button" disabled={!canManage} onClick={() => change({ style: style.id })} className={cn("rounded-lg border p-3 text-left text-sm transition hover:bg-muted/50", letterhead.style === style.id && "border-foreground ring-1 ring-foreground")}><span className="block font-medium">{style.name}</span><span className="mt-1 block text-xs text-muted-foreground">{style.description}</span></button>)}
            </div>
          </section>
          {letterhead.style === "image" ? <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Upload your designed letterhead as images (PNG or JPG, full page width). The header is required; the footer is optional.</p>
            {(["headerImageDataUrl", "footerImageDataUrl"] as const).map((key) => <div key={key} className="space-y-2">
              <Label>{key === "headerImageDataUrl" ? "Header image" : "Footer image"}</Label>
              {letterhead[key] ? <div className="flex items-center gap-2"><img src={letterhead[key] ?? ""} alt={key === "headerImageDataUrl" ? "Letterhead header" : "Letterhead footer"} className="h-12 max-w-[220px] rounded border object-contain" /><Button size="sm" variant="outline" disabled={!canManage} onClick={() => (key === "headerImageDataUrl" ? headerInput : footerInput).current?.click()}>Replace</Button><Button size="icon" variant="ghost" aria-label="Remove image" disabled={!canManage} onClick={() => change({ [key]: null })}><Trash2 /></Button></div>
                : <Button variant="outline" className="w-full justify-start border-dashed" disabled={!canManage} onClick={() => (key === "headerImageDataUrl" ? headerInput : footerInput).current?.click()}><ImagePlus />Upload {key === "headerImageDataUrl" ? "header" : "footer"}</Button>}
            </div>)}
            <input ref={headerInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(event) => { readImage(event.target.files?.[0], "headerImageDataUrl"); event.target.value = "" }} />
            <input ref={footerInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(event) => { readImage(event.target.files?.[0], "footerImageDataUrl"); event.target.value = "" }} />
          </div> : null}

          <Separator />
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2"><Label>Style</Label><Button type="button" size="sm" variant="ghost" disabled={!canManage} onClick={resetDesign}><RotateCcw />Reset style</Button></div>
            <div className="space-y-2"><Label htmlFor="letterhead-font" className="text-xs">Font</Label><FontPicker id="letterhead-font" fontFamily={letterhead.fontFamily || template.fontFamily} fontStyle={template.fontStyle} disabled={!canManage} onChange={(next) => change({ fontFamily: next.fontFamily || "" })} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <ColourField id="letterhead-accent" label="Letterhead colour" value={accent} disabled={!canManage} onChange={(accentColor) => change({ accentColor })} />
                {letterhead.accentColor ? <button type="button" className="text-xs text-muted-foreground underline" disabled={!canManage} onClick={() => change({ accentColor: null })}>Use brand colour from Templates</button> : <p className="text-xs text-muted-foreground">Brand colour from Templates</p>}
              </div>
              <ColourField id="letterhead-text" label="Name colour" value={letterhead.textColor} disabled={!canManage} onChange={(textColor) => change({ textColor })} />
            </div>
            {slider("logoSize", "Logo size", 10, 40, "mm")}
            {slider("nameSize", "Company name size", 12, 26, "pt")}
            {logoSideApplies ? <div className="space-y-1.5">
              <Label className="text-xs">Logo position</Label>
              <div className="grid grid-cols-2 gap-1.5">{(["left", "right"] as const).map((side) => <Button key={side} type="button" size="sm" disabled={!canManage} variant={letterhead.logoPosition === side ? "default" : "outline"} onClick={() => change({ logoPosition: side })}>{side === "left" ? "Left" : "Right"}</Button>)}</div>
            </div> : null}
          </section>

          <Separator />
          <section className="space-y-4">
            <Label>Page</Label>
            <div className="space-y-1.5">
              <ColourField id="letterhead-page" label="Page colour" value={letterhead.pageColor || template.pageColor || "#FFFFFF"} disabled={!canManage} onChange={(pageColor) => change({ pageColor })} />
              {letterhead.pageColor ? <button type="button" className="text-xs text-muted-foreground underline" disabled={!canManage} onClick={() => change({ pageColor: null })}>Use page colour from Templates</button> : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Page border</Label>
              <div className="grid grid-cols-3 gap-1.5">{(["none", "thin", "double"] as LetterheadBorder[]).map((border) => <Button key={border} type="button" size="sm" disabled={!canManage} variant={letterhead.pageBorder === border ? "default" : "outline"} onClick={() => change({ pageBorder: border })}>{border === "none" ? "None" : border === "thin" ? "Thin" : "Double"}</Button>)}</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="letterhead-watermark" className="text-xs">Watermark text</Label>
              <Input id="letterhead-watermark" value={letterhead.watermarkText} maxLength={48} disabled={!canManage} placeholder="e.g. CONFIDENTIAL (leave empty for none)" onChange={(event) => change({ watermarkText: event.target.value })} />
              {letterhead.watermarkText.trim() ? <Input type="range" aria-label="Watermark visibility" min={0.04} max={0.3} step={0.01} value={letterhead.watermarkOpacity} disabled={!canManage} onChange={(event) => change({ watermarkOpacity: Number(event.target.value) })} className="h-5 cursor-pointer p-0" /> : null}
            </div>
            <BackgroundImageField value={letterhead.backgroundImageDataUrl} disabled={!canManage} onChange={(backgroundImageDataUrl) => change({ backgroundImageDataUrl })} onError={(text) => setMessage({ text, error: true })} hint="A scanned letterpad or design printed behind the whole page." />
          </section>

          <Separator />
          <section className="space-y-3">
            <Label>Details</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {field("phone", "Phone", "+91 98765 43210")}
              {field("email", "Email", "hr@company.com")}
              {field("website", "Website", "www.company.com")}
              {field("registration", "Registration (e.g. CIN)", "CIN: U72900TG2020PTC123456")}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={letterhead.showGstin} disabled={!canManage} onChange={(event) => change({ showGstin: event.target.checked })} />Show GSTIN in the footer{entity?.gstin ? ` (${entity.gstin})` : ""}</label>
            <div className="space-y-2"><Label htmlFor="letterhead-footer">Footer note</Label><Input id="letterhead-footer" value={letterhead.footerText} disabled={!canManage} placeholder="Registered office: …" onChange={(event) => change({ footerText: event.target.value })} /></div>
          </section>
          {draft ? <p className="text-xs text-muted-foreground">Unsaved changes. Click Save to use them on letters.</p> : null}
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader><CardTitle>Preview</CardTitle><CardDescription>A4 page, as it will print.{preview ? <> <a href={preview.url} target="_blank" rel="noreferrer" className="underline">Open PDF</a></> : null}</CardDescription></CardHeader>
        <CardContent>
          {preview ? <img src={preview.image} alt="Letterhead preview" className="mx-auto w-full max-w-[640px] rounded-lg border bg-white shadow-sm" /> : <div className="grid aspect-[210/297] w-full place-items-center rounded-lg border text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin" /></div>}
        </CardContent>
      </Card>
    </div>
  </div>
}
