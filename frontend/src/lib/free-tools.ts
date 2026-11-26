/** The free tools on the home page (/free/:id). Used by the landing page and the tools page. */
export type FreeToolInfo = {
  id: "invoice" | "quotation" | "letterhead" | "offer-letter" | "invoice-design"
  label: string
  /** Search-friendly page title. */
  title: string
  description: string
}

export const freeToolList: FreeToolInfo[] = [
  { id: "invoice", label: "Invoice", title: "Free GST invoice generator", description: "GST or non-GST invoices with CGST/SGST or IGST, HSN/SAC and your logo." },
  { id: "quotation", label: "Quotation", title: "Free quotation maker", description: "Quotations with GST, a validity date and your bank or UPI payment details." },
  { id: "letterhead", label: "Letterhead", title: "Free company letterhead maker", description: "Design a letterhead with your logo, address and GSTIN, and download it as a PDF." },
  { id: "offer-letter", label: "Offer letter", title: "Free offer letter with CTC breakup", description: "Offer, relieving and experience letters on your letterhead, with the salary structure." },
  { id: "invoice-design", label: "Invoice design", title: "Free invoice template designer", description: "Pick a style, font, colours, logo, signature and terms for your documents." },
]

/** The sign-up page, telling it the visitor came from the free tools (it then shows the 15-credit offer). */
export const FREE_TOOLS_SIGNUP = "/login?from=free-tools"
