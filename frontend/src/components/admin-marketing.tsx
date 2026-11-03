import { useCallback, useEffect, useRef, useState } from "react"
import { CheckCircle2, FileSpreadsheet, LoaderCircle, Mail, Megaphone, RefreshCw, Send, Upload, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cleanMarketingRows, type MarketingCleanResult } from "@/lib/marketing-leads"
import { adminErrorMessage, importMarketingLeads, loadMarketingSummary, type MarketingSummary } from "@/lib/platform-admin-api"
import { cn } from "@/lib/utils"

const number = (value: number | null | undefined) => Number(value || 0).toLocaleString("en-IN")
const dateTime = (value: string) => new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
const sourceLabel = { gst: "GST registrations", mca: "MCA incorporations" } as const

async function readMarketingFile(file: File) {
  const XLSX = await import("xlsx")
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error("This file has no worksheet.")
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true })
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "warn" && value > 0 && "text-amber-700 dark:text-amber-400")}>{number(value)}</p>
    </div>
  )
}

/** Platform admin: upload daily GST/MCA exports into public.email_outreach as pending. */
export function AdminMarketing() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [summary, setSummary] = useState<MarketingSummary | null>(null)
  const [fileName, setFileName] = useState("")
  const [preview, setPreview] = useState<MarketingCleanResult | null>(null)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const refresh = useCallback(async () => {
    try {
      setSummary(await loadMarketingSummary())
    } catch (loadError) {
      setError(adminErrorMessage(loadError, "The marketing summary could not be loaded."))
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const clearFile = () => {
    setPreview(null)
    setFileName("")
    if (fileInput.current) fileInput.current.value = ""
  }

  const chooseFile = async (file: File | undefined) => {
    setError("")
    setNotice("")
    setPreview(null)
    if (!file) return
    setFileName(file.name)
    setReading(true)
    try {
      const result = cleanMarketingRows(await readMarketingFile(file))
      if (!result.leads.length) throw new Error("No valid email addresses were found in this file.")
      setPreview(result)
    } catch (readError) {
      setError(adminErrorMessage(readError, "The file could not be read."))
      setFileName("")
    } finally {
      setReading(false)
    }
  }

  const queue = async () => {
    if (!preview) return
    setSaving(true)
    setError("")
    try {
      const result = await importMarketingLeads({
        source: preview.source,
        file_name: fileName,
        total_rows: preview.totalRows,
        missing_email: preview.missingEmail,
        invalid_email: preview.invalidEmail,
        duplicate_in_file: preview.duplicateInFile,
        // email_outreach stores only name and email: send just what is saved
        // (keeps a 4,000-contact upload around 0.5 MB, under the server limit).
        leads: preview.leads.map((lead) => ({ email: lead.email, contact_name: lead.contact_name, business_name: lead.business_name })),
      })
      setNotice(`${number(result.inserted)} new contacts added to email outreach as pending.${result.already_contacted ? ` ${number(result.already_contacted)} were already in email outreach and were skipped.` : ""}`)
      clearFile()
      await refresh()
    } catch (saveError) {
      setError(adminErrorMessage(saveError, "The contacts could not be added."))
    } finally {
      setSaving(false)
    }
  }

  const counts = summary?.counts ?? {}

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><Megaphone className="size-4" />Marketing outreach</CardTitle>
              <CardDescription>Upload the daily GST or MCA export. ChanaX cleans it, removes duplicates and anyone already in email outreach, and adds the rest to <code>email_outreach</code> as pending for the email workflow.</CardDescription>
            </div>
            <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void refresh()}><RefreshCw /></Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Tile label="Pending" value={(counts.pending ?? 0) + (counts.sending ?? 0)} />
            <Tile label="Sent today" value={summary?.sent_today ?? 0} />
            <Tile label="Sent in total" value={counts.sent ?? 0} />
            <Tile label="Failed" value={counts.failed ?? 0} tone="warn" />
            <Tile label="Unsubscribed" value={counts.unsubscribed ?? 0} />
          </div>
        </CardContent>
      </Card>

      {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}
      {notice ? <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 className="size-4 shrink-0" />{notice}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="size-4" />Upload today&rsquo;s file</CardTitle>
          <CardDescription>Excel or CSV exports of new GST registrations or MCA incorporations. The file type is detected automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <input ref={fileInput} id="marketing-file" type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(event) => void chooseFile(event.target.files?.[0])} />
          {!preview ? (
            <Button asChild variant="outline" className="h-auto w-full justify-start border-dashed p-5" disabled={reading}>
              <label htmlFor="marketing-file" className="cursor-pointer">
                {reading ? <LoaderCircle className="animate-spin" /> : <FileSpreadsheet />}
                <span className="text-left"><span className="block">{reading ? `Reading ${fileName}…` : "Choose a GST or MCA file"}</span><span className="block text-xs font-normal text-muted-foreground">.xlsx, .xls or .csv</span></span>
              </label>
            </Button>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <FileSpreadsheet className="size-4" />
                <span className="font-medium">{fileName}</span>
                <Badge variant="secondary">{sourceLabel[preview.source]}</Badge>
                <Button size="sm" variant="ghost" className="ml-auto" disabled={saving} onClick={clearFile}><X />Choose another file</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Tile label="Rows in file" value={preview.totalRows} />
                <Tile label="Unique valid emails" value={preview.leads.length} />
                <Tile label="Duplicates in file" value={preview.duplicateInFile} />
                <Tile label="No email" value={preview.missingEmail} tone="warn" />
                <Tile label="Invalid email" value={preview.invalidEmail} tone="warn" />
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Name</TableHead><TableHead>Business</TableHead><TableHead>Phone</TableHead><TableHead>State</TableHead><TableHead>Registered</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {preview.leads.slice(0, 8).map((lead) => (
                      <TableRow key={lead.email}>
                        <TableCell className="font-medium">{lead.email}</TableCell>
                        <TableCell>{lead.contact_name || "—"}</TableCell>
                        <TableCell className="max-w-56 truncate">{lead.business_name || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{lead.phone || "—"}</TableCell>
                        <TableCell>{lead.state || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{lead.registered_on || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">Showing the first {Math.min(8, preview.leads.length)} of {number(preview.leads.length)} cleaned contacts. Anyone already in email outreach (sent, pending, failed or unsubscribed) is skipped.</p>
              <div className="flex justify-end">
                <Button disabled={saving} onClick={() => void queue()}>{saving ? <LoaderCircle className="animate-spin" /> : <Send />}{saving ? "Adding…" : `Add ${number(preview.leads.length)} contacts as pending`}</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="size-4" />Upload history</CardTitle><CardDescription>Latest 30 uploads.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Uploaded</TableHead><TableHead>File</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Rows</TableHead><TableHead className="text-right">Added</TableHead><TableHead className="text-right">Already in outreach</TableHead><TableHead className="text-right">Duplicates / invalid</TableHead><TableHead>By</TableHead></TableRow></TableHeader>
            <TableBody>
              {summary?.uploads.length ? summary.uploads.map((upload) => (
                <TableRow key={upload.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(upload.created_at)}</TableCell>
                  <TableCell className="max-w-56 truncate font-medium">{upload.file_name}</TableCell>
                  <TableCell><Badge variant="outline">{upload.source.toUpperCase()}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{number(upload.total_rows)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{number(upload.inserted)}</TableCell>
                  <TableCell className="text-right tabular-nums">{number(upload.already_contacted)}</TableCell>
                  <TableCell className="text-right tabular-nums">{number(upload.duplicate_in_file + upload.missing_email + upload.invalid_email)}</TableCell>
                  <TableCell className="text-muted-foreground">{upload.uploaded_by_email || "—"}</TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={8} className="h-20 text-center text-muted-foreground">No uploads yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
