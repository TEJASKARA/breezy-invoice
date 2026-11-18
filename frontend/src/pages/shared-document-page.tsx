import { useEffect, useState } from "react"
import { Download, ExternalLink, FileText, LoaderCircle } from "lucide-react"
import { useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { fetchSharedDocument, type SharedDocument } from "@/lib/document-email-api"

/** Phones and browsers without a built-in PDF viewer can't show a PDF inside the page. */
const canShowPdfInline = () => typeof navigator !== "undefined"
  && navigator.pdfViewerEnabled !== false
  && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

const documentLabels: Record<SharedDocument["document_type"], string> = {
  invoice: "Invoice",
  quotation: "Quotation",
  employee_letter: "Letter",
}

/** Public page behind a shared link: shows the PDF with a download button. */
export function SharedDocumentPage() {
  const { token = "" } = useParams()
  const [document, setDocument] = useState<SharedDocument | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    fetchSharedDocument(token)
      .then((shared) => { if (active) setDocument(shared) })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "This document link is not available.") })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!document) return
    const label = documentLabels[document.document_type] || "Document"
    window.document.title = `${label} ${document.document_number}${document.sender_company_name ? ` · ${document.sender_company_name}` : ""}`.trim()
  }, [document])

  const label = document ? documentLabels[document.document_type] || "Document" : "Document"

  return <div className="flex min-h-svh flex-col bg-muted/40">
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><FileText className="size-5" /></span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{document ? `${label} ${document.document_number}`.trim() : "Shared document"}</p>
            {document?.sender_company_name ? <p className="truncate text-sm text-muted-foreground">From {document.sender_company_name}</p> : null}
          </div>
        </div>
        {document && canShowPdfInline() ? <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild><a href={document.view_url} target="_blank" rel="noreferrer"><ExternalLink />Open</a></Button>
          <Button size="sm" asChild><a href={document.download_url}><Download />Download PDF</a></Button>
        </div> : null}
      </div>
    </header>
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-4">
      {error ? <div className="m-auto max-w-md rounded-xl border bg-background p-6 text-center"><p className="font-semibold">Link not available</p><p className="mt-2 text-sm text-muted-foreground">{error}</p></div>
        : !document ? <div className="m-auto flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Opening document…</div>
        : canShowPdfInline() ? <iframe title={`${label} ${document.document_number}`} src={document.view_url} className="min-h-[75vh] w-full flex-1 rounded-lg border bg-background" />
        : <div className="m-auto w-full max-w-sm rounded-xl border bg-background p-6 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-xl bg-muted"><FileText className="size-6" /></span>
          <p className="mt-3 font-semibold">{`${label} ${document.document_number}`.trim()}</p>
          {document.sender_company_name ? <p className="mt-1 text-sm text-muted-foreground">From {document.sender_company_name}</p> : null}
          <div className="mt-5 grid gap-2">
            <Button asChild><a href={document.view_url} target="_blank" rel="noreferrer"><ExternalLink />Open PDF</a></Button>
            <Button variant="outline" asChild><a href={document.download_url}><Download />Download PDF</a></Button>
          </div>
        </div>}
    </main>
    <footer className="py-3 text-center text-xs text-muted-foreground">Shared with <a className="underline" href="/">ChanaX</a></footer>
  </div>
}
