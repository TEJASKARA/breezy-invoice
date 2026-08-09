import type { Invoice, InvoiceLineItem } from "@/lib/mvp-store"

export function getInvoiceLineItems(invoice: Invoice): InvoiceLineItem[] {
  if (invoice.lineItems?.length) return invoice.lineItems
  return [{
    id: `${invoice.id}-legacy-item`,
    description: invoice.description || "Professional services",
    hsnSac: invoice.hsnSac || "",
    taxableAmount: invoice.taxableAmount ?? Math.max(0, invoice.amount - (invoice.cgstAmount || 0) - (invoice.sgstAmount || 0) - (invoice.igstAmount || 0)),
    cgstAmount: invoice.cgstAmount || 0,
    sgstAmount: invoice.sgstAmount || 0,
    igstAmount: invoice.igstAmount || 0,
  }]
}

export function calculateInvoiceTotals(lineItems: InvoiceLineItem[]) {
  const totals = lineItems.reduce((sum, item) => ({
    taxableAmount: sum.taxableAmount + item.taxableAmount,
    cgstAmount: sum.cgstAmount + item.cgstAmount,
    sgstAmount: sum.sgstAmount + item.sgstAmount,
    igstAmount: sum.igstAmount + item.igstAmount,
  }), { taxableAmount: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0 })
  return {
    ...totals,
    amount: totals.taxableAmount + totals.cgstAmount + totals.sgstAmount + totals.igstAmount,
  }
}
