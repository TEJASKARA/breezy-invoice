import { useEffect, useMemo, useRef, useState } from "react"
import { Download, ImagePlus, LoaderCircle, Save, Trash2 } from "lucide-react"
import { Link } from "react-router-dom"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useEntitySelection } from "@/lib/entity-selection"
import { createLetterheadPdf, letterheadFileName, letterheadStyles, type LetterheadSettings } from "@/lib/letterhead"
import { useMvpStore } from "@/lib/mvp-store"
import { canRemoveChanaxBranding } from "@/lib/subscription-entitlements"
import { trackAction } from "@/lib/usage-tracking"
import { appPath } from "@/lib/guest-mode"
import { cn } from "@/lib/utils"
import { useWorkspaceAccess } from "@/lib/workspace-access"

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024
/** Phones and browsers without a built-in PDF viewer can't show a PDF in an iframe. */
const inlinePdfUnsupported = typeof navigator !== "undefined" && (navigator.pdfViewerEnabled === false || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent))

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
  const [previewUrl, setPreviewUrl] = useState("")
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const headerInput = useRef<HTMLInputElement>(null)
  const footerInput = useRef<HTMLInputElement>(null)
  const brandingCanBeRemoved = canRemoveChanaxBranding(subscription)

  useEffect(() => { setDraft(null) }, [entity?.id])

  // Live preview of the letterhead PDF.
  useEffect(() => {
    let active = true
    let url = ""
    const timer = window.setTimeout(() => {
      void createLetterheadPdf({ entity, template, letterhead, canRemoveBranding: brandingCanBeRemoved }).then((doc) => {
        if (!active) return
        url = URL.createObjectURL(doc.output("blob"))
        setPreviewUrl(url)
      }).catch(() => { if (active) setPreviewUrl("") })
    }, 350)
    return () => { active = false; window.clearTimeout(timer); if (url) URL.revokeObjectURL(url) }
  }, [entity, template, letterhead, brandingCanBeRemoved])

  const change = (changes: Partial<LetterheadSettings>) => { if (canManage) { setDraft({ ...letterhead, ...changes }); setMessage(null) } }

  const readImage = (file: File | undefined, field: "headerImageDataUrl" | "footerImageDataUrl") => {
    if (!file) return
    if (!/^image\/(png|jpe?g)$/.test(file.type)) return setMessage({ text: "Upload a PNG or JPG image.", error: true })
    if (file.size > MAX_IMAGE_BYTES) return setMessage({ text: "The image must be smaller than 1.5 MB.", error: true })
    const reader = new FileReader()
    reader.onload = () => change({ [field]: String(reader.result), style: "image" })
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

  const field = (id: keyof Pick<LetterheadSettings, "phone" | "email" | "website" | "registration">, label: string, placeholder: string) => (
    <div className="space-y-2"><Label htmlFor={`letterhead-${id}`}>{label}</Label><Input id={`letterhead-${id}`} value={letterhead[id]} disabled={!canManage} placeholder={placeholder} onChange={(event) => change({ [id]: event.target.value })} /></div>
  )

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
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
      <Card className={cn("h-fit", !canManage && "opacity-80")}>
        <CardHeader><CardTitle>Design</CardTitle><CardDescription>Logo and brand colour come from <Link to={appPath("/settings/templates")} className="underline">Templates</Link>.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            {letterheadStyles.map((style) => <button key={style.id} type="button" disabled={!canManage} onClick={() => change({ style: style.id })} className={cn("rounded-lg border p-3 text-left text-sm transition hover:bg-muted/50", letterhead.style === style.id && "border-foreground ring-1 ring-foreground")}><span className="block font-medium">{style.name}</span><span className="mt-1 block text-xs text-muted-foreground">{style.description}</span></button>)}
          </div>
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
          <div className="grid gap-3 sm:grid-cols-2">
            {field("phone", "Phone", "+91 98765 43210")}
            {field("email", "Email", "hr@company.com")}
            {field("website", "Website", "www.company.com")}
            {field("registration", "Registration (e.g. CIN)", "CIN: U72900TG2020PTC123456")}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={letterhead.showGstin} disabled={!canManage} onChange={(event) => change({ showGstin: event.target.checked })} />Show GSTIN in the footer{entity?.gstin ? ` (${entity.gstin})` : ""}</label>
          <div className="space-y-2"><Label htmlFor="letterhead-footer">Footer note</Label><Input id="letterhead-footer" value={letterhead.footerText} disabled={!canManage} placeholder="Registered office: …" onChange={(event) => change({ footerText: event.target.value })} /></div>
          {draft ? <p className="text-xs text-muted-foreground">Unsaved changes. Click Save to use them on letters.</p> : null}
        </CardContent>
      </Card>
      <Card className="min-h-[600px]">
        <CardHeader><CardTitle>Preview</CardTitle><CardDescription>A4 page, as it will print.</CardDescription></CardHeader>
        <CardContent>
          {previewUrl && inlinePdfUnsupported ? <div className="grid h-60 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground"><div className="space-y-3"><p>This device can't show the PDF inside the page.</p><Button variant="outline" asChild><a href={previewUrl} target="_blank" rel="noreferrer">Open preview</a></Button></div></div>
            : previewUrl ? <iframe title="Letterhead preview" src={`${previewUrl}#toolbar=0&navpanes=0`} className="h-[75vh] w-full rounded-lg border bg-white" /> : <div className="grid h-[60vh] place-items-center text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin" /></div>}
        </CardContent>
      </Card>
    </div>
  </div>
}
