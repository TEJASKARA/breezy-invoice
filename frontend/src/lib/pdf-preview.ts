/** Render the exact downloadable bytes, without depending on browser PDF plugins. */
export async function renderPdfPreview(data: ArrayBuffer, cancelled: () => boolean) {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ])
  if (cancelled()) return []
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true })
  const pages: string[] = []
  try {
    const document = await task.promise
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      if (cancelled()) return []
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = window.document.createElement("canvas")
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport }).promise
      pages.push(canvas.toDataURL("image/png"))
      canvas.width = 0
      canvas.height = 0
      page.cleanup()
    }
    return pages
  } finally {
    await task.destroy()
  }
}
