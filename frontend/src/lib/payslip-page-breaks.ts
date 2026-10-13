export function payslipPageBreaks(height: number, pageHeight: number, protectedBlocks: { top: number; bottom: number }[]) {
  const pages: { top: number; height: number }[] = []
  let top = 0
  while (top < height - 0.5) {
    let bottom = Math.min(height, top + pageHeight)
    // Move a break above a row/section rather than cutting through its text.
    let changed = true
    while (changed) {
      changed = false
      for (const block of protectedBlocks) {
        if (block.top > top + 1 && block.top < bottom && block.bottom > bottom) {
          bottom = block.top
          changed = true
        }
      }
    }
    pages.push({ top, height: bottom - top })
    top = bottom
  }
  return pages
}
