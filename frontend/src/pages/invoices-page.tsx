import { useEffect, useRef, useState } from "react"
import { Download, Eye, LoaderCircle, MessageCircle, Plus, Search, Trash2, Upload, X } from "lucide-react"

import { InvoicePreview } from "@/components/invoice-preview"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { calculateInvoiceTotals } from "@/lib/invoice-calculations"
import { cleanInvoiceFileName, createInvoicePdfFile, downloadInvoicePdf } from "@/lib/invoice-pdf"
import { nextInvoiceNumber, type Customer, type Invoice, type InvoiceLineItem, useMvpStore } from "@/lib/mvp-store"
import { parseDocumentStatus, parseMoney, pickCell, readSpreadsheet } from "@/lib/spreadsheet"
import { downloadZip } from "@/lib/zip-download"
import { sharePdfViaWhatsApp } from "@/lib/whatsapp-share"
import { useWorkspaceAccess } from "@/lib/workspace-access"

type ImportInvoice = Omit<Invoice, "id" | "number">
type ImportCustomer = Omit<Customer, "id">
type ManualCustomer = Omit<ImportCustomer, "entityId">
type DraftLineItem = Omit<InvoiceLineItem, "taxableAmount" | "cgstAmount" | "sgstAmount" | "igstAmount"> & {
  taxableAmount: string
  cgstAmount: string
  sgstAmount: string
  igstAmount: string
}
const newDraftLine = (hsnSac = ""): DraftLineItem => ({
  id: crypto.randomUUID(),
  description: "",
  hsnSac,
  taxableAmount: "",
  cgstAmount: "",
  sgstAmount: "",
  igstAmount: "",
})
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const hsnSacPattern = /^(?:[0-9]{4}|[0-9]{6}|[0-9]{8})$/
const entityHsnCodes = (company: { hsnSac: string; hsnSacCodes?: string[] } | undefined) => [...new Set([...(company?.hsnSacCodes || []), company?.hsnSac || ""].filter(Boolean))]
const emptyManualCustomer = (): ManualCustomer => ({
  companyName: "",
  billingAddress: "",
  gstin: "",
  pan: "",
  premisesAddress: "",
  hsnSac: "",
})
const invoiceColumns = [
  "Customer Name", "Billing Address", "GSTIN", "PAN", "Premises Address", "HSN/SAC",
  "Invoice Number", "Invoice Date", "Description", "Taxable Amount", "CGST Amount",
  "SGST Amount", "IGST Amount", "Invoice Total", "TDS Amount", "Other Deduction",
  "Net Receivable", "Status",
]

export function InvoicesPage() {
  const { setup, companies, customers, invoices, template, addCustomers, deleteCustomer, addInvoice, addInvoices, deleteInvoice } = useMvpStore()
  const { can } = useWorkspaceAccess()
  const canManage = can("invoices.manage")
  const [showForm, setShowForm] = useState(false)
  const [entityName, setEntityName] = useState("")
  const [bulkEntityName, setBulkEntityName] = useState("")
  const [customerEntityId, setCustomerEntityId] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [status, setStatus] = useState<"Draft" | "Generated">("Draft")
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([newDraftLine()])
  const [tdsAmount, setTdsAmount] = useState("")
  const [otherDeduction, setOtherDeduction] = useState("")
  const [draftFormError, setDraftFormError] = useState("")
  const [invoiceSaving, setInvoiceSaving] = useState(false)
  const [preview, setPreview] = useState<ImportInvoice[]>([])
  const [pdfPreview, setPdfPreview] = useState<Invoice | null>(null)
  const [customerPreview, setCustomerPreview] = useState<ImportCustomer[]>([])
  const [bulkNewCustomers, setBulkNewCustomers] = useState<ImportCustomer[]>([])
  const [bulkDownloadPending, setBulkDownloadPending] = useState(false)
  const [bulkImportPending, setBulkImportPending] = useState(false)
  const [bulkImportMessage, setBulkImportMessage] = useState("")
  const [bulkImportHasError, setBulkImportHasError] = useState(false)
  const [bulkInvoicesSaved, setBulkInvoicesSaved] = useState(false)
  const [showDownloadChoices, setShowDownloadChoices] = useState(false)
  const [showManualCustomer, setShowManualCustomer] = useState(false)
  const [manualCustomer, setManualCustomer] = useState<ManualCustomer>(emptyManualCustomer)
  const [manualCustomerError, setManualCustomerError] = useState("")
  const [notice, setNotice] = useState("")
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [pendingCustomerDelete, setPendingCustomerDelete] = useState<string | null>(null)
  const [showAllInvoices, setShowAllInvoices] = useState(false)
  const [invoiceSearch, setInvoiceSearch] = useState("")
  const [invoiceDateFilter, setInvoiceDateFilter] = useState("")
  const [invoiceAmountMin, setInvoiceAmountMin] = useState("")
  const [invoiceAmountMax, setInvoiceAmountMax] = useState("")
  const invoiceFileInput = useRef<HTMLInputElement>(null)
  const customerFileInput = useRef<HTMLInputElement>(null)
  const bulkPreviewRef = useRef<HTMLDivElement>(null)
  const selectedEntity = companies.find((company) => company.companyName === entityName)
  const selectedEntityHsnCodes = entityHsnCodes(selectedEntity)
  const selectedBulkEntity = companies.find((company) => company.companyName === bulkEntityName)
  const individualCustomers = customers.filter((customer) => customer.entityId === selectedEntity?.id)
  const bulkCustomers = customers.filter((customer) => customer.entityId === selectedBulkEntity?.id)
  const visibleCustomers = customers.filter((customer) => customer.entityId === customerEntityId)
  const normalizedInvoiceSearch = invoiceSearch.trim().toLowerCase()
  const minimumInvoiceAmount = invoiceAmountMin === "" ? null : Number(invoiceAmountMin)
  const maximumInvoiceAmount = invoiceAmountMax === "" ? null : Number(invoiceAmountMax)
  const hasInvoiceFilters = Boolean(normalizedInvoiceSearch || invoiceDateFilter || invoiceAmountMin || invoiceAmountMax)
  const filteredInvoices = invoices.filter((invoice) => {
    const searchableText = [invoice.sourceNumber, invoice.number, invoice.entityName, invoice.companyName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    if (normalizedInvoiceSearch && !searchableText.includes(normalizedInvoiceSearch)) return false
    if (invoiceDateFilter && invoice.date !== invoiceDateFilter) return false
    if (minimumInvoiceAmount !== null && Number.isFinite(minimumInvoiceAmount) && invoice.amount < minimumInvoiceAmount) return false
    if (maximumInvoiceAmount !== null && Number.isFinite(maximumInvoiceAmount) && invoice.amount > maximumInvoiceAmount) return false
    return true
  })
  const visibleInvoices = showAllInvoices ? filteredInvoices : filteredInvoices.slice(0, 5)
  const showNotice = (text: string, isError = false) => { setNotice(text); setNoticeIsError(isError) }

  const clearInvoiceFilters = () => {
    setInvoiceSearch("")
    setInvoiceDateFilter("")
    setInvoiceAmountMin("")
    setInvoiceAmountMax("")
    setShowAllInvoices(false)
  }

  const parsedLineItems: InvoiceLineItem[] = lineItems.map((item) => ({
    id: item.id,
    description: item.description.trim(),
    hsnSac: item.hsnSac.trim(),
    taxableAmount: Number(item.taxableAmount) || 0,
    cgstAmount: Number(item.cgstAmount) || 0,
    sgstAmount: Number(item.sgstAmount) || 0,
    igstAmount: Number(item.igstAmount) || 0,
  }))
  const draftTotals = calculateInvoiceTotals(parsedLineItems)

  useEffect(() => {
    if (!preview.length || bulkImportPending || bulkImportHasError) return
    bulkPreviewRef.current?.focus({ preventScroll: true })
    bulkPreviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [preview.length, bulkImportPending, bulkImportHasError])

  const draftError = () => {
    if (!entityName || !companyName) return "Select the issuing entity and customer."
    if (!date) return "Select the invoice date."
    if (parsedLineItems.some((item) => !item.description || item.taxableAmount <= 0)) return "Every line item needs a description and taxable amount greater than zero."
    if (parsedLineItems.some((item) => item.hsnSac && !hsnSacPattern.test(item.hsnSac))) return "HSN/SAC must contain 4, 6, or 8 digits."
    if (parsedLineItems.some((item) => item.igstAmount > 0 && (item.cgstAmount > 0 || item.sgstAmount > 0))) return "Use either IGST or CGST + SGST on each line item, not both."
    return ""
  }

  const buildDraftInvoice = (): Invoice => ({
    id: "invoice-preview",
    number: nextInvoiceNumber(setup, invoices),
    entityName,
    customerId: individualCustomers.find((customer) => customer.companyName === companyName)?.id,
    companyName,
    date,
    description: parsedLineItems[0]?.description,
    hsnSac: parsedLineItems[0]?.hsnSac,
    taxableAmount: draftTotals.taxableAmount,
    cgstAmount: draftTotals.cgstAmount,
    sgstAmount: draftTotals.sgstAmount,
    igstAmount: draftTotals.igstAmount,
    amount: draftTotals.amount,
    tdsAmount: Number(tdsAmount) || 0,
    otherDeduction: Number(otherDeduction) || 0,
    netReceivable: draftTotals.amount - (Number(tdsAmount) || 0) - (Number(otherDeduction) || 0),
    lineItems: parsedLineItems,
    status,
  })

  const resetForm = () => {
    setEntityName("")
    setCompanyName("")
    setLineItems([newDraftLine()])
    setTdsAmount("")
    setOtherDeduction("")
    setDraftFormError("")
    setShowForm(false)
  }

  const selectInvoiceEntity = (nextEntityName: string) => {
    const nextEntity = companies.find((company) => company.companyName === nextEntityName)
    const defaultHsnSac = entityHsnCodes(nextEntity)[0] || ""
    setEntityName(nextEntityName)
    setCompanyName("")
    setLineItems((items) => items.map((item) => ({ ...item, hsnSac: defaultHsnSac })))
    setDraftFormError("")
  }

  const save = async () => {
    const error = draftError()
    if (error) {
      setDraftFormError(error)
      return
    }
    const { id: _id, number: _number, ...invoice } = buildDraftInvoice()
    setInvoiceSaving(true)
    setDraftFormError("")
    try {
      await addInvoice(invoice)
      resetForm()
      showNotice("Invoice saved to your workspace.")
    } catch (saveError) {
      setDraftFormError(saveError instanceof Error ? saveError.message : "The invoice could not be saved. Please try again.")
    } finally {
      setInvoiceSaving(false)
    }
  }

  const viewDraft = () => {
    const error = draftError()
    if (error) {
      setDraftFormError(error)
      return
    }
    setPdfPreview(buildDraftInvoice())
    setDraftFormError("")
  }

  const updateLineItem = (itemId: string, field: keyof DraftLineItem, value: string) => {
    setDraftFormError("")
    setLineItems((items) => items.map((item) => {
      if (item.id !== itemId) return item
      const updated = { ...item, [field]: value }
      if (field === "igstAmount" && Number(value) > 0) {
        updated.cgstAmount = ""
        updated.sgstAmount = ""
      }
      if ((field === "cgstAmount" || field === "sgstAmount") && Number(value) > 0) {
        updated.igstAmount = ""
      }
      return updated
    }))
  }

  const downloadPdf = async (invoice: Invoice) => {
    try {
      const invoiceEntity = companies.find((company) => company.companyName === invoice.entityName)
      await downloadInvoicePdf({
        invoice,
        entity: invoiceEntity,
        customer: customers.find((customer) => customer.id === invoice.customerId)
          || customers.find((customer) => customer.entityId === invoiceEntity?.id && customer.companyName === invoice.companyName),
        template,
      })
      showNotice(`${invoice.sourceNumber || invoice.number} downloaded using the selected ${template.preset} template.`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The invoice PDF could not be created.", true)
    }
  }

  const shareInvoiceOnWhatsApp = async (invoice: Invoice) => {
    try {
      const invoiceEntity = companies.find((company) => company.companyName === invoice.entityName)
      const customer = customers.find((item) => item.id === invoice.customerId)
        || customers.find((item) => item.entityId === invoiceEntity?.id && item.companyName === invoice.companyName)
      const result = await sharePdfViaWhatsApp({
        title: `Invoice ${invoice.sourceNumber || invoice.number}`,
        message: `Invoice ${invoice.sourceNumber || invoice.number} from ${invoiceEntity?.companyName || invoice.entityName || "our company"} for ${invoice.companyName}.`,
        createFile: () => createInvoicePdfFile({ invoice, entity: invoiceEntity, customer, template }),
      })
      if (result === "shared") showNotice("Invoice prepared. Choose WhatsApp in the share panel to send the PDF.")
      if (result === "downloaded-and-opened") showNotice("Invoice downloaded and WhatsApp opened. Attach the downloaded PDF to the chat.")
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The invoice could not be shared through WhatsApp.", true)
    }
  }

  const downloadBulkInvoiceZip = async () => {
    if (!selectedBulkEntity || !preview.length) return
    setBulkDownloadPending(true)
    try {
      const files = []
      for (const [index, importedInvoice] of preview.entries()) {
        const invoice: Invoice = {
          ...importedInvoice,
          id: `bulk-invoice-${index}`,
          number: importedInvoice.sourceNumber || `BULK-${index + 1}`,
        }
        const savedCustomer = bulkCustomers.find((customer) => customer.companyName.trim().toLowerCase() === invoice.companyName.trim().toLowerCase())
        const newCustomer = bulkNewCustomers.find((customer) => customer.companyName.trim().toLowerCase() === invoice.companyName.trim().toLowerCase())
        const customer = savedCustomer || (newCustomer ? { ...newCustomer, id: `bulk-customer-${index}` } : undefined)
        files.push(await createInvoicePdfFile({ invoice, entity: selectedBulkEntity, customer, template }))
      }
      const downloadedOn = new Date().toISOString().slice(0, 10)
      downloadZip(files, `Invoices_${cleanInvoiceFileName(selectedBulkEntity.companyName)}_${downloadedOn}.zip`)
      showNotice(`${files.length} invoice PDFs downloaded in one ZIP folder.`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The invoice ZIP could not be created.", true)
    } finally {
      setBulkDownloadPending(false)
    }
  }

  const openInvoiceFilePicker = () => {
    const input = invoiceFileInput.current
    if (!input) return
    input.value = ""
    setBulkImportMessage("")
    setBulkImportHasError(false)
    setPreview([])
    setBulkNewCustomers([])
    setBulkInvoicesSaved(false)
    input.click()
  }

  const importInvoiceFile = async (file: File) => {
    if (!bulkEntityName) {
      showNotice("Select the entity issuing these invoices before uploading the file.", true)
      return
    }
    setBulkImportPending(true)
    setBulkImportHasError(false)
    setBulkImportMessage(`Reading ${file.name}…`)
    setPreview([])
    setBulkNewCustomers([])
    setBulkInvoicesSaved(false)
    try {
      const rows = await readSpreadsheet(file)
      if (!rows.length) {
        setBulkImportHasError(true)
        setBulkImportMessage("The first worksheet has no invoice rows. Use the downloaded BreezyInvoice template and keep Invoice Upload as the first sheet.")
        return
      }
      const newCustomersByName = new Map<string, ImportCustomer>()
      const importedRows = rows.map((row) => {
        const customerName = pickCell(row, "Customer Name", "Company Name")
        const savedCustomer = bulkCustomers.find((customer) => customer.companyName.trim().toLowerCase() === customerName.trim().toLowerCase())
        const suppliedGstin = pickCell(row, "GSTIN").toUpperCase()
        const suppliedPan = pickCell(row, "PAN").toUpperCase()
        const suppliedHsnSac = pickCell(row, "HSN/SAC", "HSN SAC")
        const suppliedBillingAddress = pickCell(row, "Billing Address")
        const suppliedPremisesAddress = pickCell(row, "Premises Address")
        const newCustomerIsValid = Boolean(
          customerName
          && suppliedBillingAddress
          && suppliedPremisesAddress
          && gstinPattern.test(suppliedGstin)
          && panPattern.test(suppliedPan)
          && suppliedGstin.slice(2, 12) === suppliedPan
          && hsnSacPattern.test(suppliedHsnSac)
        )
        if (!savedCustomer && newCustomerIsValid) {
          newCustomersByName.set(customerName.trim().toLowerCase(), {
            entityId: selectedBulkEntity?.id || "",
            companyName: customerName,
            billingAddress: suppliedBillingAddress,
            gstin: suppliedGstin,
            pan: suppliedPan,
            premisesAddress: suppliedPremisesAddress,
            hsnSac: suppliedHsnSac,
          })
        }
        const hsnSac = suppliedHsnSac || savedCustomer?.hsnSac || ""
        const taxableAmount = parseMoney(pickCell(row, "Taxable Amount"))
        const cgstAmount = parseMoney(pickCell(row, "CGST Amount")) || 0
        const sgstAmount = parseMoney(pickCell(row, "SGST Amount")) || 0
        const igstAmount = parseMoney(pickCell(row, "IGST Amount")) || 0
        const suppliedTotal = parseMoney(pickCell(row, "Invoice Total"))
        const amount = suppliedTotal || taxableAmount + cgstAmount + sgstAmount + igstAmount
        const tdsAmount = parseMoney(pickCell(row, "TDS Amount")) || 0
        const otherDeduction = parseMoney(pickCell(row, "Other Deduction")) || 0
        const suppliedNet = parseMoney(pickCell(row, "Net Receivable"))
        return {
          entityName: bulkEntityName,
          customerId: savedCustomer?.id,
          companyName: customerName,
          sourceNumber: pickCell(row, "Invoice Number"),
          date: pickCell(row, "Invoice Date"),
          description: pickCell(row, "Description"),
          hsnSac,
          taxableAmount,
          cgstAmount,
          sgstAmount,
          igstAmount,
          amount,
          tdsAmount,
          otherDeduction,
          netReceivable: suppliedNet || amount - tdsAmount - otherDeduction,
          lineItems: [{
            id: crypto.randomUUID(),
            description: pickCell(row, "Description"),
            hsnSac,
            taxableAmount,
            cgstAmount,
            sgstAmount,
            igstAmount,
          }],
          status: parseDocumentStatus(pickCell(row, "Status")),
          valid: Boolean(savedCustomer || newCustomerIsValid) && hsnSacPattern.test(hsnSac),
        }
      }).filter((row) => row.valid && row.companyName && row.sourceNumber && row.date && Number.isFinite(row.taxableAmount) && row.taxableAmount > 0 && row.amount > 0)
        .map(({ valid: _valid, ...invoice }) => invoice)
      const groupedInvoices = new Map<string, ImportInvoice>()
      importedRows.forEach((row) => {
        const key = `${row.sourceNumber}::${row.companyName.toLowerCase()}::${row.date}`
        const existing = groupedInvoices.get(key)
        if (!existing) {
          groupedInvoices.set(key, row)
          return
        }
        const combinedItems = [...(existing.lineItems || []), ...(row.lineItems || [])]
        const combinedTotals = calculateInvoiceTotals(combinedItems)
        const combinedTds = Math.max(existing.tdsAmount || 0, row.tdsAmount || 0)
        const combinedDeduction = Math.max(existing.otherDeduction || 0, row.otherDeduction || 0)
        groupedInvoices.set(key, {
          ...existing,
          description: combinedItems[0]?.description,
          hsnSac: combinedItems[0]?.hsnSac,
          taxableAmount: combinedTotals.taxableAmount,
          cgstAmount: combinedTotals.cgstAmount,
          sgstAmount: combinedTotals.sgstAmount,
          igstAmount: combinedTotals.igstAmount,
          amount: combinedTotals.amount,
          tdsAmount: combinedTds,
          otherDeduction: combinedDeduction,
          netReceivable: combinedTotals.amount - combinedTds - combinedDeduction,
          lineItems: combinedItems,
        })
      })
      const imported = [...groupedInvoices.values()]
      if (!imported.length) {
        setBulkImportHasError(true)
        setBulkImportMessage(`No valid invoices were found in ${file.name}. All ${rows.length} rows were rejected. Verify customer details, PAN/GSTIN matching, 4/6/8-digit HSN/SAC, invoice number, date, and taxable amount.`)
        return
      }
      const rejectedRows = rows.length - importedRows.length
      setBulkNewCustomers([...newCustomersByName.values()])
      setPreview(imported)
      setBulkInvoicesSaved(false)
      setBulkImportMessage(`${imported.length} invoice${imported.length === 1 ? "" : "s"} loaded from ${file.name}.${rejectedRows ? ` ${rejectedRows} row${rejectedRows === 1 ? " was" : "s were"} skipped.` : ""} Review the preview below, then generate the invoices.`)
      showNotice("")
    } catch (error) {
      setBulkImportHasError(true)
      setBulkImportMessage(error instanceof Error ? `The workbook could not be read: ${error.message}` : "The workbook could not be read. Please upload an .xlsx, .xls, or .csv file.")
    } finally {
      setBulkImportPending(false)
    }
  }

  const downloadBulkWorkbook = async (mode: "existing" | "new") => {
    if (!bulkEntityName || !selectedBulkEntity) {
      showNotice("Select the entity issuing the invoices before downloading a template.", true)
      return
    }
    if (mode === "existing" && !bulkCustomers.length) {
      showNotice("This entity has no saved customers. Add customers first or choose the new-customer template.", true)
      return
    }
    const XLSX = await import("xlsx")

    const headers = [
      "Customer Name", "Billing Address", "GSTIN", "PAN", "Premises Address", "HSN/SAC",
      "Invoice Number", "Invoice Date", "Description", "Taxable Amount", "CGST Amount",
      "SGST Amount", "IGST Amount", "Invoice Total", "TDS Amount", "Other Deduction",
      "Net Receivable", "Status",
    ]
    const today = new Date().toISOString().slice(0, 10)
    const monthCode = today.slice(0, 7).replace("-", "")
    const sourceRows = mode === "existing"
      ? bulkCustomers.map((customer, index) => [
          customer.companyName,
          customer.billingAddress,
          customer.gstin,
          customer.pan,
          customer.premisesAddress,
          customer.hsnSac,
          `BULK-${monthCode}-${String(index + 1).padStart(3, "0")}`,
          today,
          "Services",
          null,
          null,
          null,
          null,
          { t: "n", v: 0, f: `SUM(J${index + 2}:M${index + 2})` },
          null,
          null,
          { t: "n", v: 0, f: `N${index + 2}-O${index + 2}-P${index + 2}` },
          "Draft",
        ])
      : Array.from({ length: 25 }, (_, index) => [
          null, null, null, null, null, null,
          `BULK-${monthCode}-${String(index + 1).padStart(3, "0")}`,
          today,
          "Services",
          null, null, null, null,
          { t: "n", v: 0, f: `SUM(J${index + 2}:M${index + 2})` },
          null,
          null,
          { t: "n", v: 0, f: `N${index + 2}-O${index + 2}-P${index + 2}` },
          "Draft",
        ])

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sourceRows])
    worksheet["!cols"] = [
      { wch: 32 }, { wch: 36 }, { wch: 18 }, { wch: 14 }, { wch: 36 }, { wch: 12 },
      { wch: 22 }, { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 12 },
    ]
    worksheet["!autofilter"] = { ref: `A1:R${sourceRows.length + 1}` }
    worksheet["!freeze"] = { xSplit: 1, ySplit: 1 }

    const instructions = XLSX.utils.aoa_to_sheet([
      ["BreezyInvoice - Bulk Invoice Upload"],
      ["Selected entity", bulkEntityName],
      ["Template type", mode === "existing" ? "Existing customers" : "New customers"],
      [],
      ["Instructions"],
      ["1", mode === "existing"
        ? "Customer details are prefilled from this entity's customer master. Do not change them unless the saved master must be corrected."
        : "Enter the new customer's company name, address, GSTIN, PAN, and HSN/SAC before entering invoice amounts."],
      ["2", "Enter amounts in the blank amount columns. Invoice Total and Net Receivable contain formulas."],
      ["3", "Edit the generated invoice number, date, description, and status when required."],
      ["4", "Use either CGST + SGST or IGST for each invoice, not both."],
      ["5", "Repeat an invoice number on another row when one invoice needs multiple descriptions."],
    ])
    instructions["!cols"] = [{ wch: 18 }, { wch: 110 }]

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoice Upload")
    XLSX.utils.book_append_sheet(workbook, instructions, "Instructions")
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    const safeEntityName = bulkEntityName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()
    link.href = url
    link.download = `breezyinvoice-${safeEntityName}-${mode}-customers.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setShowDownloadChoices(false)
    showNotice(`Excel template downloaded for ${bulkEntityName}.`)
  }

  const importCustomerFile = async (file: File) => {
    if (!customerEntityId) {
      showNotice("Select the entity that owns this customer list before importing customers.", true)
      return
    }
    try {
      const rows = await readSpreadsheet(file)
      const imported = rows.map((row) => {
        const gstin = pickCell(row, "GSTIN").toUpperCase()
        const pan = pickCell(row, "PAN").toUpperCase()
        const hsnSac = pickCell(row, "HSN/SAC", "HSN SAC")
        return {
          entityId: customerEntityId,
          companyName: pickCell(row, "Company Name"),
          billingAddress: pickCell(row, "Billing Address"),
          gstin,
          pan,
          premisesAddress: pickCell(row, "Premises Address"),
          hsnSac,
          valid: gstinPattern.test(gstin) && panPattern.test(pan) && gstin.slice(2, 12) === pan && hsnSacPattern.test(hsnSac),
        }
      }).filter((row) => row.companyName && row.valid)
        .map(({ valid: _valid, ...customer }) => customer)
      if (!imported.length) {
        showNotice("No valid invoice customers found. Check the headings and validate GSTIN, PAN, and HSN/SAC.", true)
        return
      }
      setCustomerPreview(imported)
      showNotice("")
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The customer spreadsheet could not be read.", true)
    }
  }

  const updateManualCustomer = (field: keyof ManualCustomer, value: string) => {
    setManualCustomer((customer) => ({ ...customer, [field]: value }))
    setManualCustomerError("")
  }

  const saveManualCustomer = async () => {
    if (!customerEntityId) {
      setManualCustomerError("Select the entity that owns this customer.")
      return
    }
    const customer = {
      ...manualCustomer,
      companyName: manualCustomer.companyName.trim(),
      billingAddress: manualCustomer.billingAddress.trim(),
      premisesAddress: manualCustomer.premisesAddress.trim(),
      gstin: manualCustomer.gstin.trim().toUpperCase(),
      pan: manualCustomer.pan.trim().toUpperCase(),
      hsnSac: manualCustomer.hsnSac.trim(),
    }
    if (!customer.companyName || !customer.billingAddress || !customer.premisesAddress) {
      setManualCustomerError("Company name, billing address, and premises address are required.")
      return
    }
    if (!gstinPattern.test(customer.gstin)) {
      setManualCustomerError("Enter a valid 15-character GSTIN.")
      return
    }
    if (!panPattern.test(customer.pan)) {
      setManualCustomerError("Enter a valid 10-character PAN.")
      return
    }
    if (customer.gstin.slice(2, 12) !== customer.pan) {
      setManualCustomerError("The PAN does not match the PAN embedded in the GSTIN.")
      return
    }
    if (!hsnSacPattern.test(customer.hsnSac)) {
      setManualCustomerError("HSN/SAC must contain 4, 6, or 8 digits.")
      return
    }
    if (visibleCustomers.some((savedCustomer) =>
      savedCustomer.companyName.trim().toLowerCase() === customer.companyName.toLowerCase()
      || savedCustomer.gstin === customer.gstin
    )) {
      setManualCustomerError("This customer name or GSTIN already exists for the selected entity.")
      return
    }
    try {
      await addCustomers([{ ...customer, entityId: customerEntityId }])
      setManualCustomer(emptyManualCustomer())
      setManualCustomerError("")
      setShowManualCustomer(false)
      showNotice(`${customer.companyName} was added to the selected entity's customer master.`)
    } catch (error) {
      setManualCustomerError(error instanceof Error ? error.message : "The customer could not be saved.")
    }
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Documents"
        title="Invoices"
        description="Maintain invoice customers, create invoices separately, or import a monthly invoice batch."
        actions={canManage ? (
          <>
            <input
              ref={customerFileInput}
              className="hidden"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importCustomerFile(file)
                event.target.value = ""
              }}
            />
            <input
              ref={invoiceFileInput}
              className="hidden"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => {
                const input = event.currentTarget
                const file = input.files?.[0]
                if (!file) return
                void importInvoiceFile(file).finally(() => {
                  input.value = ""
                })
              }}
            />
            <Button disabled={!companies.length || !customers.length} onClick={() => setShowForm((value) => !value)}><Plus />New invoice</Button>
          </>
        ) : null}
      />

      {!canManage ? <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">You have view-only access to invoices. You can search, preview, and download saved invoices, but creating, importing, or deleting records requires invoice management permission.</p> : null}

      {notice && <p role={noticeIsError ? "alert" : "status"} className={noticeIsError ? "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive" : "rounded-lg bg-muted p-3 text-sm text-muted-foreground"}>{notice}</p>}
      {!companies.length && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Create at least one managed Entity. The selected entity will be the invoice issuer.</p>}
      {!customers.length && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Select an entity in the Customer Master section, then add a customer manually or import that entity's customer list.</p>}

      {showForm && canManage && (
        <Card>
          <CardHeader><CardTitle>Create individual invoice</CardTitle><CardDescription>Add multiple descriptions and tax amounts, then preview the selected template before saving or downloading.</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="invoice-entity">Issuing entity</Label>
                <select id="invoice-entity" value={entityName} onChange={(event) => selectInvoiceEntity(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Select entity</option>
                  {companies.map((company) => <option key={company.id}>{company.companyName}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-company">Client company</Label>
                <select id="invoice-company" value={companyName} onChange={(event) => { setCompanyName(event.target.value); setDraftFormError("") }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Select company</option>
                  {individualCustomers.map((customer) => <option key={customer.id}>{customer.companyName}</option>)}
                </select>
                {entityName && !individualCustomers.length && <p className="text-xs text-destructive">This entity has no saved invoice customers yet.</p>}
              </div>
              <div className="space-y-2"><Label htmlFor="invoice-date">Invoice date</Label><Input id="invoice-date" type="date" value={date} onChange={(event) => { setDate(event.target.value); setDraftFormError("") }} /></div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Invoice descriptions</h3>
                  <p className="text-xs text-muted-foreground">Choose an HSN/SAC saved for the issuing entity on each line. Use CGST + SGST for intra-state invoices or IGST for inter-state invoices.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setLineItems((items) => [...items, newDraftLine(selectedEntityHsnCodes[0] || "")])}><Plus />Add description</Button>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <div className="min-w-[980px]">
                  <div className="grid grid-cols-[2fr_110px_repeat(4,130px)_44px] gap-2 bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span>Description</span><span>HSN/SAC</span><span>Taxable amount</span><span>CGST</span><span>SGST</span><span>IGST</span><span />
                  </div>
                  {lineItems.map((item, index) => (
                    <div key={item.id} className="grid grid-cols-[2fr_110px_repeat(4,130px)_44px] gap-2 border-t p-3">
                      <Input aria-label={`Description ${index + 1}`} value={item.description} onChange={(event) => updateLineItem(item.id, "description", event.target.value)} placeholder="Service or item description" />
                      {selectedEntityHsnCodes.length ? <select aria-label={`HSN/SAC ${index + 1}`} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={item.hsnSac} onChange={(event) => updateLineItem(item.id, "hsnSac", event.target.value)}><option value="">Select code</option>{selectedEntityHsnCodes.map((code) => <option key={code} value={code}>{code}</option>)}</select> : <Input aria-label={`HSN/SAC ${index + 1}`} inputMode="numeric" maxLength={8} value={item.hsnSac} onChange={(event) => updateLineItem(item.id, "hsnSac", event.target.value.replace(/\D/g, ""))} placeholder="998222" />}
                      <Input aria-label={`Taxable amount ${index + 1}`} type="number" min="0" step="0.01" value={item.taxableAmount} onChange={(event) => updateLineItem(item.id, "taxableAmount", event.target.value)} placeholder="0.00" />
                      <Input aria-label={`CGST ${index + 1}`} type="number" min="0" step="0.01" value={item.cgstAmount} onChange={(event) => updateLineItem(item.id, "cgstAmount", event.target.value)} placeholder="0.00" />
                      <Input aria-label={`SGST ${index + 1}`} type="number" min="0" step="0.01" value={item.sgstAmount} onChange={(event) => updateLineItem(item.id, "sgstAmount", event.target.value)} placeholder="0.00" />
                      <Input aria-label={`IGST ${index + 1}`} type="number" min="0" step="0.01" value={item.igstAmount} onChange={(event) => updateLineItem(item.id, "igstAmount", event.target.value)} placeholder="0.00" />
                      <Button type="button" size="icon" variant="ghost" disabled={lineItems.length === 1} aria-label={`Remove description ${index + 1}`} onClick={() => setLineItems((items) => items.filter((line) => line.id !== item.id))}><Trash2 /></Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-5 rounded-lg bg-muted/40 p-4 md:grid-cols-[1fr_1fr_1.2fr]">
              <div className="space-y-2"><Label htmlFor="invoice-tds">TDS deduction (₹)</Label><Input id="invoice-tds" type="number" min="0" step="0.01" value={tdsAmount} onChange={(event) => setTdsAmount(event.target.value)} placeholder="0.00" /></div>
              <div className="space-y-2"><Label htmlFor="invoice-other-deduction">Other deduction (₹)</Label><Input id="invoice-other-deduction" type="number" min="0" step="0.01" value={otherDeduction} onChange={(event) => setOtherDeduction(event.target.value)} placeholder="0.00" /></div>
              <div className="space-y-1 text-sm md:text-right">
                <p className="text-muted-foreground">Taxable: ₹{draftTotals.taxableAmount.toLocaleString("en-IN")}</p>
                <p className="text-muted-foreground">Tax: ₹{(draftTotals.cgstAmount + draftTotals.sgstAmount + draftTotals.igstAmount).toLocaleString("en-IN")}</p>
                <p className="text-lg font-semibold">Invoice total: ₹{draftTotals.amount.toLocaleString("en-IN")}</p>
                <p className="font-medium">Net receivable: ₹{Math.max(0, draftTotals.amount - (Number(tdsAmount) || 0) - (Number(otherDeduction) || 0)).toLocaleString("en-IN")}</p>
              </div>
            </div>

            {draftFormError ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive">{draftFormError}</p> : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status === "Generated"} onChange={(event) => setStatus(event.target.checked ? "Generated" : "Draft")} /> Mark as generated</label>
              <div className="flex gap-2"><Button variant="outline" onClick={resetForm} disabled={invoiceSaving}>Cancel</Button><Button variant="outline" onClick={viewDraft} disabled={invoiceSaving}><Eye />Preview invoice</Button><Button onClick={() => void save()} disabled={invoiceSaving}>{invoiceSaving ? <><LoaderCircle className="animate-spin" />Saving…</> : "Save invoice"}</Button></div>
            </div>
          </CardContent>
        </Card>
      )}

      {canManage ? <Card>
        <CardHeader>
          <CardTitle>Bulk invoice generation</CardTitle>
          <CardDescription>Select the entity once, download the format, fill one invoice line item per row, and upload the completed workbook.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,320px)_1fr]">
            <div className="space-y-2">
              <Label htmlFor="bulk-invoice-entity">Entity issuing the invoices</Label>
              <select
                id="bulk-invoice-entity"
                value={bulkEntityName}
                onChange={(event) => {
                  setBulkEntityName(event.target.value)
                  setPreview([])
                  setBulkNewCustomers([])
                  setBulkInvoicesSaved(false)
                  setShowDownloadChoices(false)
                  setBulkImportMessage("")
                  setBulkImportHasError(false)
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select entity</option>
                {companies.map((company) => <option key={company.id}>{company.companyName}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Button variant="outline" disabled={!bulkEntityName} onClick={() => setShowDownloadChoices(true)}><Download />Download Excel template</Button>
              <Button disabled={!bulkEntityName || bulkImportPending} onClick={openInvoiceFilePicker}>
                {bulkImportPending ? <LoaderCircle className="animate-spin" /> : <Upload />}
                {bulkImportPending ? "Reading workbook…" : "Upload invoice workbook"}
              </Button>
            </div>
          </div>
          {bulkImportMessage && (
            <p
              role={bulkImportHasError ? "alert" : "status"}
              aria-live="polite"
              className={`rounded-lg border p-3 text-sm ${bulkImportHasError ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-muted/40 text-foreground"}`}
            >
              {bulkImportMessage}
            </p>
          )}
          <div>
            <p className="mb-2 text-sm font-medium">Required table columns</p>
            <div className="flex flex-wrap gap-2">
              {invoiceColumns.map((column) => <Badge key={column} variant="secondary">{column}</Badge>)}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">For existing customers, the workbook includes the saved company details and only the amount inputs are blank. Choose the new-customer workbook when the customer has not yet been saved. Repeat an invoice number on multiple rows to add multiple descriptions to one invoice.</p>
          {bulkEntityName && !bulkCustomers.length && <p className="text-sm text-destructive">This entity has no existing customers, but you can download and upload the new-customer workbook.</p>}
        </CardContent>
      </Card> : null}

      {canManage && customerPreview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Invoice customer import preview</CardTitle>
            <CardDescription>
              {customerPreview.length} customers ready for {companies.find((company) => company.id === customerEntityId)?.companyName || "the selected entity"}. Headings: Company Name, Billing Address, GSTIN, PAN, Premises Address, HSN/SAC.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>GSTIN</TableHead><TableHead>PAN</TableHead><TableHead>HSN/SAC</TableHead></TableRow></TableHeader>
              <TableBody>{customerPreview.slice(0, 10).map((customer, index) => <TableRow key={`${customer.gstin}-${index}`}><TableCell>{customer.companyName}</TableCell><TableCell className="font-mono text-xs">{customer.gstin}</TableCell><TableCell className="font-mono text-xs">{customer.pan || "Auto-derived"}</TableCell><TableCell>{customer.hsnSac || "—"}</TableCell></TableRow>)}</TableBody>
            </Table>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCustomerPreview([])}>Cancel</Button>
              <Button onClick={async () => {
                const count = customerPreview.length
                try {
                  await addCustomers(customerPreview)
                  setCustomerPreview([])
                  showNotice(`${count} invoice customers imported successfully.`)
                } catch (error) {
                  showNotice(error instanceof Error ? error.message : "The invoice customers could not be imported.", true)
                }
              }}>Import {customerPreview.length} customers</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {canManage && preview.length > 0 && (
        <div ref={bulkPreviewRef} tabIndex={-1} className="scroll-mt-6 outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Bulk invoice preview</CardTitle>
              <CardDescription>
                {preview.length} valid invoices found for {bulkEntityName}.
                {bulkNewCustomers.length ? ` ${bulkNewCustomers.length} new customer${bulkNewCustomers.length === 1 ? "" : "s"} will also be saved for this entity.` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Entity</TableHead><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>{preview.slice(0, 10).map((invoice, index) => <TableRow key={`${invoice.companyName}-${invoice.date}-${index}`}><TableCell>{invoice.entityName}</TableCell><TableCell>{invoice.sourceNumber}</TableCell><TableCell>{invoice.companyName}</TableCell><TableCell>{invoice.date}</TableCell><TableCell>₹{invoice.amount.toLocaleString("en-IN")}</TableCell><TableCell><Badge variant="secondary">{invoice.status}</Badge></TableCell></TableRow>)}</TableBody>
              </Table>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setPreview([]); setBulkNewCustomers([]); setBulkInvoicesSaved(false) }}>{bulkInvoicesSaved ? "Close" : "Cancel"}</Button>
                <Button variant="outline" disabled={bulkDownloadPending} onClick={() => void downloadBulkInvoiceZip()}>
                  <Download />{bulkDownloadPending ? "Preparing ZIP…" : `Download ${preview.length} PDFs (ZIP)`}
                </Button>
                <Button disabled={bulkInvoicesSaved} onClick={async () => {
                  const count = preview.length
                  const customerCount = bulkNewCustomers.length
                  try {
                    if (customerCount) {
                      await addCustomers(bulkNewCustomers)
                      setBulkNewCustomers([])
                    }
                    await addInvoices(preview)
                    setBulkInvoicesSaved(true)
                    showNotice(`${count} invoices generated successfully${customerCount ? ` and ${customerCount} new customers were saved` : ""}. You can now download the complete batch as a ZIP.`)
                  } catch (error) {
                    showNotice(error instanceof Error ? error.message : "The invoice batch could not be saved.", true)
                  }
                }}>
                  {bulkInvoicesSaved ? "Invoices generated" : `Generate ${preview.length} invoices`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Customer master by entity</CardTitle>
          <CardDescription>Select an entity to maintain the customers that entity invoices.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 space-y-2">
              <Label htmlFor="customer-master-entity">Entity</Label>
              <select
                id="customer-master-entity"
                value={customerEntityId}
                onChange={(event) => {
                  setCustomerEntityId(event.target.value)
                  setCustomerPreview([])
                  setShowManualCustomer(false)
                  setManualCustomer(emptyManualCustomer())
                  setManualCustomerError("")
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select entity</option>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.companyName}</option>)}
              </select>
            </div>
            {canManage ? <Button
              disabled={!customerEntityId}
              onClick={() => {
                setShowManualCustomer((visible) => !visible)
                setManualCustomerError("")
              }}
            >
              <Plus />Add customer manually
            </Button> : null}
            {canManage ? <Button variant="outline" disabled={!customerEntityId} onClick={() => customerFileInput.current?.click()}><Upload />Import customers for entity</Button> : null}
          </div>
          {canManage && showManualCustomer && customerEntityId && (
            <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
              <div>
                <h3 className="font-medium">Add customer manually</h3>
                <p className="text-sm text-muted-foreground">This customer will only be available for invoices created by the selected entity.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="manual-customer-name">Company name</Label>
                  <Input id="manual-customer-name" value={manualCustomer.companyName} onChange={(event) => updateManualCustomer("companyName", event.target.value)} placeholder="ABC Customer Private Limited" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-customer-gstin">GSTIN</Label>
                  <Input id="manual-customer-gstin" value={manualCustomer.gstin} onChange={(event) => updateManualCustomer("gstin", event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={15} placeholder="36ABCDE1234F1Z5" className="font-mono uppercase" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-customer-pan">PAN</Label>
                  <Input id="manual-customer-pan" value={manualCustomer.pan} onChange={(event) => updateManualCustomer("pan", event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={10} placeholder="ABCDE1234F" className="font-mono uppercase" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-customer-hsn">Default HSN/SAC</Label>
                  <Input id="manual-customer-hsn" value={manualCustomer.hsnSac} onChange={(event) => updateManualCustomer("hsnSac", event.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={8} placeholder="998222" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="manual-customer-billing-address">Billing address</Label>
                  <Input id="manual-customer-billing-address" value={manualCustomer.billingAddress} onChange={(event) => updateManualCustomer("billingAddress", event.target.value)} placeholder="Billing address shown on the invoice" />
                </div>
                <div className="space-y-2 md:col-span-2 lg:col-span-3">
                  <Label htmlFor="manual-customer-premises-address">Premises address</Label>
                  <Input id="manual-customer-premises-address" value={manualCustomer.premisesAddress} onChange={(event) => updateManualCustomer("premisesAddress", event.target.value)} placeholder="Registered or principal place of business" />
                </div>
              </div>
              {manualCustomerError && <p role="alert" className="text-sm font-medium text-destructive">{manualCustomerError}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowManualCustomer(false)
                    setManualCustomer(emptyManualCustomer())
                    setManualCustomerError("")
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={saveManualCustomer}>Save customer</Button>
              </div>
            </div>
          )}
          {customerEntityId && <p className="text-sm text-muted-foreground">{visibleCustomers.length} customer{visibleCustomers.length === 1 ? "" : "s"} saved for {companies.find((company) => company.id === customerEntityId)?.companyName}.</p>}
          <Table>
            <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>GSTIN</TableHead><TableHead className="hidden md:table-cell">PAN</TableHead><TableHead className="hidden lg:table-cell">Billing address</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {visibleCustomers.length ? visibleCustomers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">{customer.companyName}</TableCell>
                  <TableCell className="font-mono text-xs">{customer.gstin}</TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">{customer.pan || "—"}</TableCell>
                  <TableCell className="hidden max-w-72 truncate lg:table-cell">{customer.billingAddress || "—"}</TableCell>
                  <TableCell className="text-right">
                    {!canManage ? <span className="text-xs text-muted-foreground">View only</span> : pendingCustomerDelete === customer.id ? (
                      <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setPendingCustomerDelete(null)}>Cancel</Button><Button size="sm" variant="destructive" onClick={async () => { try { await deleteCustomer(customer.id); setPendingCustomerDelete(null); showNotice(`${customer.companyName} was removed from the invoice customer master.`) } catch (error) { showNotice(error instanceof Error ? error.message : "The customer could not be deleted.", true) } }}>Confirm delete</Button></div>
                    ) : (
                      <Button size="icon" variant="ghost" aria-label={`Delete invoice customer ${customer.companyName}`} onClick={() => setPendingCustomerDelete(customer.id)}><Trash2 /></Button>
                    )}
                  </TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">{customerEntityId ? "No customers are saved for this entity. Add one manually or import the customer master." : "Select an entity to view its customer list."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Invoice register</CardTitle>
              <CardDescription>
                {hasInvoiceFilters
                  ? `${filteredInvoices.length} of ${invoices.length} invoices match your filters.`
                  : filteredInvoices.length > 5 && !showAllInvoices
                  ? `Showing the latest 5 of ${filteredInvoices.length} invoices.`
                  : `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} maintained in this workspace.`}
              </CardDescription>
            </div>
            {filteredInvoices.length > 5 && (
              <Button variant="outline" size="sm" onClick={() => setShowAllInvoices((showAll) => !showAll)}>
                {showAllInvoices ? "Show latest 5" : `Show all ${filteredInvoices.length}`}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.4fr)_180px_160px_160px_auto]">
            <div className="space-y-2">
              <Label htmlFor="invoice-register-search">Invoice, customer or entity</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="invoice-register-search"
                  value={invoiceSearch}
                  onChange={(event) => { setInvoiceSearch(event.target.value); setShowAllInvoices(false) }}
                  placeholder="Search by name or invoice number"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-register-date">Invoice date</Label>
              <Input id="invoice-register-date" type="date" value={invoiceDateFilter} onChange={(event) => { setInvoiceDateFilter(event.target.value); setShowAllInvoices(false) }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-register-min">Minimum amount</Label>
              <Input id="invoice-register-min" type="number" min="0" step="0.01" value={invoiceAmountMin} onChange={(event) => { setInvoiceAmountMin(event.target.value); setShowAllInvoices(false) }} placeholder="₹0" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-register-max">Maximum amount</Label>
              <Input id="invoice-register-max" type="number" min="0" step="0.01" value={invoiceAmountMax} onChange={(event) => { setInvoiceAmountMax(event.target.value); setShowAllInvoices(false) }} placeholder="Any amount" />
            </div>
            <Button variant="outline" className="self-end" disabled={!hasInvoiceFilters} onClick={clearInvoiceFilters}><X />Clear</Button>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Entity</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {visibleInvoices.length ? visibleInvoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">{invoice.sourceNumber || invoice.number}</TableCell><TableCell>{invoice.entityName || "—"}</TableCell><TableCell>{invoice.companyName}</TableCell><TableCell>{invoice.date}</TableCell><TableCell>₹{invoice.amount.toLocaleString("en-IN")}</TableCell><TableCell><Badge variant={invoice.status === "Draft" ? "secondary" : "outline"}>{invoice.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    {pendingDelete === invoice.id && canManage ? (
                      <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button><Button size="sm" variant="destructive" onClick={async () => { try { await deleteInvoice(invoice.id); setPendingDelete(null); showNotice(`${invoice.number} was deleted.`) } catch (error) { showNotice(error instanceof Error ? error.message : "The invoice could not be deleted.", true) } }}>Confirm delete</Button></div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" aria-label={`Preview ${invoice.sourceNumber || invoice.number}`} title="Preview invoice" onClick={() => setPdfPreview(invoice)}><Eye /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Download ${invoice.sourceNumber || invoice.number} as PDF`} title="Download PDF" onClick={() => void downloadPdf(invoice)}><Download /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Share ${invoice.sourceNumber || invoice.number} through WhatsApp`} title="Share via WhatsApp" onClick={() => void shareInvoiceOnWhatsApp(invoice)}><MessageCircle /></Button>
                        {canManage ? <Button size="icon" variant="ghost" aria-label={`Delete ${invoice.number}`} onClick={() => setPendingDelete(invoice.id)}><Trash2 /></Button> : null}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted-foreground">{hasInvoiceFilters ? "No invoices match these filters." : "Add an invoice separately or import your regular invoice spreadsheet."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pdfPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 md:p-6" role="dialog" aria-modal="true" aria-label="Invoice preview">
          <div className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div>
                <h2 className="font-semibold">Invoice preview</h2>
                <p className="text-sm text-muted-foreground">Selected template: {template.preset}. The downloaded PDF will use this format.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void shareInvoiceOnWhatsApp(pdfPreview)}><MessageCircle />Share via WhatsApp</Button>
                <Button variant="outline" onClick={() => void downloadPdf(pdfPreview)}><Download />Download PDF</Button>
                <Button size="icon" variant="ghost" aria-label="Close invoice preview" onClick={() => setPdfPreview(null)}><X /></Button>
              </div>
            </div>
            <div className="overflow-auto bg-muted/70 p-3 md:p-8">
              <InvoicePreview
                invoice={pdfPreview}
                entity={companies.find((company) => company.companyName === pdfPreview.entityName)}
                customer={customers.find((customer) => customer.id === pdfPreview.customerId)
                  || customers.find((customer) => customer.entityId === companies.find((company) => company.companyName === pdfPreview.entityName)?.id && customer.companyName === pdfPreview.companyName)}
                template={template}
              />
            </div>
          </div>
        </div>
      )}

      {canManage && showDownloadChoices && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="download-template-title">
          <Card className="w-full max-w-2xl shadow-2xl">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle id="download-template-title">Choose customer type</CardTitle>
                  <CardDescription>The Excel file will be prepared for {bulkEntityName} and downloaded with an .xlsx filename.</CardDescription>
                </div>
                <Button size="icon" variant="ghost" aria-label="Close template choices" onClick={() => setShowDownloadChoices(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Button
                variant="outline"
                disabled={!bulkCustomers.length}
                onClick={() => void downloadBulkWorkbook("existing")}
                className="h-auto min-h-32 items-start justify-start whitespace-normal p-5 text-left"
              >
                <span><span className="block font-semibold">Existing customers</span><span className="mt-2 block text-sm font-normal text-muted-foreground">Prefills all {bulkCustomers.length} saved customers for this entity. Only the amount input columns are empty.</span></span>
              </Button>
              <Button
                variant="outline"
                onClick={() => void downloadBulkWorkbook("new")}
                className="h-auto min-h-32 items-start justify-start whitespace-normal p-5 text-left"
              >
                <span><span className="block font-semibold">New customers</span><span className="mt-2 block text-sm font-normal text-muted-foreground">Provides blank customer-detail rows. Valid customers will be saved automatically when invoices are imported.</span></span>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
