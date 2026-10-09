import { customerErrorMessage } from "@/lib/customer-errors"
import { useEffect, useMemo, useRef, useState } from "react"
import { Archive, Download, FileCode2, Loader2, Save, Search, Upload } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type TallySettings, useMvpStore } from "@/lib/mvp-store"
import { pickCell, readSpreadsheet } from "@/lib/spreadsheet"
import { createTallyPayrollXml, createTallySalesXml, downloadXml } from "@/lib/tally-xml"
import { downloadCompleteDataExport, type ExportCategory } from "@/lib/data-export"
import { useWorkspaceAccess } from "@/lib/workspace-access"
import { canRemoveChanaxBranding } from "@/lib/subscription-entitlements"

const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
const today = () => new Date().toISOString().slice(0, 10)
const financialYearStart = () => {
  const now = new Date()
  const year = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear()
  return `${year}-04-01`
}
const safeFileName = (value: string) => value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "company"

function defaultTallySettings(companyName: string): TallySettings {
  return {
    companyName,
    salesLedger: "Sales",
    cgstLedger: "Output CGST",
    sgstLedger: "Output SGST",
    igstLedger: "Output IGST",
    roundOffLedger: "Round Off",
    salaryExpenseLedger: "Salary Expense",
    pfPayableLedger: "PF Payable",
    esiPayableLedger: "ESI Payable",
    professionalTaxPayableLedger: "Professional Tax Payable",
    tdsPayableLedger: "TDS Payable",
    otherDeductionLedger: "Other Payroll Deductions",
  }
}

export function TallyExportPage() {
  const { companies, customers, invoices, proformas, employees, payslips, expenses, setup, templateFor, updateCompany, updateCustomer, updateEmployee } = useMvpStore()
  const { can, subscription } = useWorkspaceAccess()
  const canManage = can("data_export.manage")
  const brandingCanBeRemoved = canRemoveChanaxBranding(subscription)
  const [selectedEntityId, setSelectedEntityId] = useState(companies[0]?.id || "")
  const [dateFrom, setDateFrom] = useState(financialYearStart())
  const [dateTo, setDateTo] = useState(today())
  const [customerSearch, setCustomerSearch] = useState("")
  const [employeeSearch, setEmployeeSearch] = useState("")
  const [settings, setSettings] = useState<TallySettings>(defaultTallySettings(companies[0]?.companyName || ""))
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [exportingArchive, setExportingArchive] = useState(false)
  const [archiveCategories, setArchiveCategories] = useState<ExportCategory[]>(["invoices", "expenses", "employees", "attendance", "payslips"])
  const customerMappingInput = useRef<HTMLInputElement>(null)
  const employeeMappingInput = useRef<HTMLInputElement>(null)

  const entity = companies.find((company) => company.id === selectedEntityId)
  const entityCustomers = customers.filter((customer) => customer.entityId === selectedEntityId)
  const entityEmployees = employees.filter((employee) => employee.entityId === selectedEntityId)

  useEffect(() => {
    if (!entity) return
    setSettings({ ...defaultTallySettings(entity.companyName), ...entity.tallySettings })
  }, [entity])

  const generatedInvoices = useMemo(() => invoices.filter((invoice) => {
    const belongsToEntity = invoice.entityName === entity?.companyName
    return belongsToEntity && invoice.status === "Generated" && invoice.date >= dateFrom && invoice.date <= dateTo
  }), [invoices, entity?.companyName, dateFrom, dateTo])

  const generatedPayslips = useMemo(() => payslips.filter((payslip) => {
    const recordDate = payslip.paymentDate || `${payslip.month}-01`
    return payslip.entityId === selectedEntityId && payslip.status === "Generated" && recordDate >= dateFrom && recordDate <= dateTo
  }), [payslips, selectedEntityId, dateFrom, dateTo])
  const selectedProformas = useMemo(() => proformas.filter((item) => item.entityId === selectedEntityId && item.date >= dateFrom && item.date <= dateTo), [proformas, selectedEntityId, dateFrom, dateTo])
  const selectedExpenses = useMemo(() => expenses.filter((item) => item.entityId === selectedEntityId && item.date >= dateFrom && item.date <= dateTo), [expenses, selectedEntityId, dateFrom, dateTo])

  const visibleCustomers = entityCustomers.filter((customer) => [customer.companyName, customer.gstin, customer.tallyLedgerName || ""].some((value) => value.toLowerCase().includes(customerSearch.trim().toLowerCase())))
  const visibleEmployees = entityEmployees.filter((employee) => [employee.employeeName, employee.employeeCode, employee.tallyLedgerName || ""].some((value) => value.toLowerCase().includes(employeeSearch.trim().toLowerCase())))
  const mappedCustomers = entityCustomers.filter((customer) => customer.tallyLedgerName?.trim()).length
  const mappedEmployees = entityEmployees.filter((employee) => employee.tallyLedgerName?.trim()).length

  const clearMessages = () => { setNotice(""); setError("") }

  const changeEntity = (entityId: string) => {
    setSelectedEntityId(entityId)
    setCustomerSearch("")
    setEmployeeSearch("")
    clearMessages()
  }

  const saveSettings = async () => {
    clearMessages()
    if (!canManage) { setError("You have view-only access to Data Export."); return }
    if (!entity) return
    if (Object.values(settings).some((value) => !value.trim())) {
      setError("Complete every Tally company and ledger field before saving.")
      return
    }
    try {
      await updateCompany(entity.id, { tallySettings: settings })
      setNotice(`Tally settings saved for ${entity.companyName}.`)
    } catch (saveError) {
      setError(customerErrorMessage(saveError, "The Tally settings could not be saved."))
    }
  }

  const downloadCustomerMapping = async () => {
    if (!entityCustomers.length) { setError("This entity has no invoice customers to map."); return }
    const XLSX = await import("xlsx")
    const rows = entityCustomers.map((customer) => ({
      "Customer ID": customer.id,
      "Customer Company Name": customer.companyName,
      GSTIN: customer.gstin,
      "Tally Ledger Name": customer.tallyLedgerName || customer.companyName,
    }))
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(rows)
    worksheet["!cols"] = [{ wch: 38 }, { wch: 34 }, { wch: 18 }, { wch: 34 }]
    XLSX.utils.book_append_sheet(workbook, worksheet, "Customer Ledgers")
    XLSX.writeFile(workbook, `ChanaX-${safeFileName(entity?.companyName || "")}-customer-ledgers.xlsx`, { compression: true })
  }

  const downloadEmployeeMapping = async () => {
    if (!entityEmployees.length) { setError("This entity has no employees to map."); return }
    const XLSX = await import("xlsx")
    const rows = entityEmployees.map((employee) => ({
      "Employee ID": employee.id,
      "Employee Code": employee.employeeCode,
      "Employee Name": employee.employeeName,
      "Email": employee.email || "",
      "Tally Ledger Name": employee.tallyLedgerName || employee.employeeName,
    }))
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(rows)
    worksheet["!cols"] = [{ wch: 38 }, { wch: 18 }, { wch: 30 }, { wch: 34 }]
    XLSX.utils.book_append_sheet(workbook, worksheet, "Employee Ledgers")
    XLSX.writeFile(workbook, `ChanaX-${safeFileName(entity?.companyName || "")}-employee-ledgers.xlsx`, { compression: true })
  }

  const importCustomerMapping = async (file: File) => {
    clearMessages()
    if (!canManage) { setError("You do not have permission to import ledger mappings."); return }
    try {
      const rows = await readSpreadsheet(file)
      let updated = 0
      const writes: Promise<void>[] = []
      rows.forEach((row) => {
        const id = pickCell(row, "Customer ID")
        const companyName = pickCell(row, "Customer Company Name", "Company Name")
        const ledgerName = pickCell(row, "Tally Ledger Name", "Ledger Name")
        const customer = entityCustomers.find((item) => item.id === id) || entityCustomers.find((item) => item.companyName.toLowerCase() === companyName.toLowerCase())
        if (!customer || !ledgerName) return
        writes.push(updateCustomer(customer.id, { tallyLedgerName: ledgerName }))
        updated += 1
      })
      await Promise.all(writes)
      if (updated) setNotice(`${updated} customer ledger mapping${updated === 1 ? "" : "s"} saved from ${file.name}.`)
      else setError("No valid customer ledger mappings were found in this workbook.")
    } catch (importError) {
      setError(customerErrorMessage(importError, "The customer ledger workbook could not be read."))
    }
  }

  const importEmployeeMapping = async (file: File) => {
    clearMessages()
    if (!canManage) { setError("You do not have permission to import ledger mappings."); return }
    try {
      const rows = await readSpreadsheet(file)
      let updated = 0
      const writes: Promise<void>[] = []
      rows.forEach((row) => {
        const id = pickCell(row, "Employee ID")
        const code = pickCell(row, "Employee Code")
        const ledgerName = pickCell(row, "Tally Ledger Name", "Ledger Name")
        const employee = entityEmployees.find((item) => item.id === id) || entityEmployees.find((item) => item.employeeCode.toLowerCase() === code.toLowerCase())
        if (!employee || !ledgerName) return
        writes.push(updateEmployee(employee.id, { tallyLedgerName: ledgerName }))
        updated += 1
      })
      await Promise.all(writes)
      if (updated) setNotice(`${updated} employee ledger mapping${updated === 1 ? "" : "s"} saved from ${file.name}.`)
      else setError("No valid employee ledger mappings were found in this workbook.")
    } catch (importError) {
      setError(customerErrorMessage(importError, "The employee ledger workbook could not be read."))
    }
  }

  const exportInvoices = () => {
    clearMessages()
    if (!canManage) { setError("You do not have permission to create Tally exports."); return }
    if (!generatedInvoices.length) { setError("No generated invoices were found for this entity and date range."); return }
    const xml = createTallySalesXml({ companyName: settings.companyName, invoices: generatedInvoices, customers: entityCustomers, settings })
    downloadXml(xml, `Tally-Sales-${safeFileName(entity?.companyName || "")}-${dateFrom}-to-${dateTo}.xml`)
    setNotice(`${generatedInvoices.length} sales voucher${generatedInvoices.length === 1 ? "" : "s"} exported for Tally.`)
  }

  const exportPayslips = () => {
    clearMessages()
    if (!canManage) { setError("You do not have permission to create Tally exports."); return }
    if (!generatedPayslips.length) { setError("No generated payslips were found for this entity and date range."); return }
    const xml = createTallyPayrollXml({ companyName: settings.companyName, payslips: generatedPayslips, employees: entityEmployees, settings })
    downloadXml(xml, `Tally-Payroll-${safeFileName(entity?.companyName || "")}-${dateFrom}-to-${dateTo}.xml`)
    setNotice(`${generatedPayslips.length} payroll journal voucher${generatedPayslips.length === 1 ? "" : "s"} exported for Tally.`)
  }

  const exportCompleteArchive = async () => {
    clearMessages()
    if (!canManage) { setError("You do not have permission to create data exports."); return }
    if (!entity || !archiveCategories.length) { setError("Select at least one export category."); return }
    setExportingArchive(true)
    try {
      const fileCount = await downloadCompleteDataExport({
        entity,
        customers: entityCustomers,
        employees: entityEmployees,
        invoices: generatedInvoices,
        proformas: selectedProformas,
        payslips: generatedPayslips,
        expenses: selectedExpenses,
        setup,
        template: templateFor(entity.id),
        canRemoveBranding: brandingCanBeRemoved,
        tallySettings: settings,
        categories: archiveCategories,
        dateFrom,
        dateTo,
      })
      setNotice(`Complete export prepared with ${fileCount} file${fileCount === 1 ? "" : "s"}.`)
    } catch (archiveError) {
      setError(customerErrorMessage(archiveError, "The complete export could not be prepared."))
    } finally {
      setExportingArchive(false)
    }
  }

  if (!companies.length) return <Card><CardHeader><CardTitle>Add an entity first</CardTitle><CardDescription>Tally exports require an entity with invoices or payslips.</CardDescription></CardHeader></Card>

  return <div className="space-y-7">
    <PageHeader eyebrow="Accounting export" title="Data Export" description="Map ChanaX names to existing Tally ledgers and export generated invoices and payslips as importable voucher XML." />

    {!canManage ? <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">You have view-only access. Ledger edits, mapping uploads, and XML generation require Data Export management permission.</p> : null}

    <Card>
      <CardHeader><CardTitle>Export a particular entity</CardTitle><CardDescription>Select the entity and reporting period. Invoice exports will include only invoices issued by this entity.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2"><Label htmlFor="tally-entity">Export entity</Label><select id="tally-entity" className={selectClass} value={selectedEntityId} onChange={(event) => changeEntity(event.target.value)}>{companies.map((company) => <option key={company.id} value={company.id}>{company.companyName}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="tally-from">From date</Label><Input id="tally-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="tally-to">To date</Label><Input id="tally-to" type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} /></div>
      </CardContent>
    </Card>

    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{notice}</p>}

    <Card>
      <CardHeader><CardTitle>Selected entity export</CardTitle><CardDescription>Choose the records you need. ChanaX will create one ZIP containing data only for {entity?.companyName || "the selected entity"} within this date range.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ["invoices", "Invoices", `${generatedInvoices.length} generated`],
            ["proformas", "Proforma invoices", `${selectedProformas.length} saved`],
            ["expenses", "Expenses & bills", `${selectedExpenses.length} expenses`],
            ["employees", "Employee master", `${entityEmployees.length} employees`],
            ["attendance", "Attendance", "Daily records in Excel"],
            ["payslips", "Payslips", `${generatedPayslips.length} generated`],
          ] as [ExportCategory, string, string][]).map(([value, label, detail]) => {
            const checked = archiveCategories.includes(value)
            return <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${checked ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}>
              <input className="mt-1 size-4" type="checkbox" checked={checked} onChange={() => setArchiveCategories((current) => checked ? current.filter((item) => item !== value) : [...current, value])} />
              <span><span className="block text-sm font-medium">{label}</span><span className="text-xs text-muted-foreground">{detail}</span></span>
            </label>
          })}
        </div>
        <Button className="w-full sm:w-auto" disabled={!canManage || exportingArchive || !archiveCategories.length} onClick={() => void exportCompleteArchive()}>
          {exportingArchive ? <Loader2 className="animate-spin" /> : <Archive />} {exportingArchive ? "Preparing ZIP…" : "Download selected data as ZIP"}
        </Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Tally company and ledger settings</CardTitle><CardDescription>These names must exactly match masters that already exist inside Tally. Settings are saved separately for each entity.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          {(Object.entries(settings) as [keyof TallySettings, string][]).map(([key, value]) => <div key={key} className="space-y-2"><Label htmlFor={`tally-${key}`}>{settingLabel(key)}</Label><Input id={`tally-${key}`} value={value} onChange={(event) => setSettings({ ...settings, [key]: event.target.value })} /></div>)}
        </div>
        <div className="flex justify-end"><Button disabled={!canManage} onClick={() => void saveSettings()}><Save />Save Tally settings</Button></div>
      </CardContent>
    </Card>

    <LedgerMappingCard
      title="Invoice customer ledger mapping"
      description="Map each customer’s legal or display name to the exact party ledger already used in Tally."
      mapped={mappedCustomers}
      total={entityCustomers.length}
      search={customerSearch}
      setSearch={setCustomerSearch}
      downloadMapping={() => void downloadCustomerMapping()}
      inputRef={customerMappingInput}
      importMapping={importCustomerMapping}
    >
      <Table><TableHeader><TableRow><TableHead>Customer company</TableHead><TableHead>GSTIN</TableHead><TableHead>Tally ledger name</TableHead></TableRow></TableHeader><TableBody>{visibleCustomers.length ? visibleCustomers.map((customer) => <TableRow key={customer.id}><TableCell className="font-medium">{customer.companyName}</TableCell><TableCell>{customer.gstin || "—"}</TableCell><TableCell><LedgerNameInput disabled={!canManage} initialValue={customer.tallyLedgerName || customer.companyName} onSave={async (value) => { if (!canManage) return; try { await updateCustomer(customer.id, { tallyLedgerName: value }); setNotice(`Ledger mapping saved for ${customer.companyName}.`) } catch (saveError) { setError(customerErrorMessage(saveError, "The ledger mapping could not be saved.")) } }} ariaLabel={`Tally ledger for ${customer.companyName}`} /></TableCell></TableRow>) : <TableRow><TableCell colSpan={3} className="h-28 text-center text-muted-foreground">No customers match this search.</TableCell></TableRow>}</TableBody></Table>
    </LedgerMappingCard>

    <LedgerMappingCard
      title="Employee payroll ledger mapping"
      description="Map each employee to the exact payable or employee ledger used in Tally payroll accounting."
      mapped={mappedEmployees}
      total={entityEmployees.length}
      search={employeeSearch}
      setSearch={setEmployeeSearch}
      downloadMapping={() => void downloadEmployeeMapping()}
      inputRef={employeeMappingInput}
      importMapping={importEmployeeMapping}
    >
      <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Code</TableHead><TableHead>Tally ledger name</TableHead></TableRow></TableHeader><TableBody>{visibleEmployees.length ? visibleEmployees.map((employee) => <TableRow key={employee.id}><TableCell className="font-medium">{employee.employeeName}</TableCell><TableCell>{employee.employeeCode}</TableCell><TableCell><LedgerNameInput disabled={!canManage} initialValue={employee.tallyLedgerName || employee.employeeName} onSave={async (value) => { if (!canManage) return; try { await updateEmployee(employee.id, { tallyLedgerName: value }); setNotice(`Ledger mapping saved for ${employee.employeeName}.`) } catch (saveError) { setError(customerErrorMessage(saveError, "The ledger mapping could not be saved.")) } }} ariaLabel={`Tally ledger for ${employee.employeeName}`} /></TableCell></TableRow>) : <TableRow><TableCell colSpan={3} className="h-28 text-center text-muted-foreground">No employees match this search.</TableCell></TableRow>}</TableBody></Table>
    </LedgerMappingCard>

    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>Invoice sales vouchers</CardTitle><CardDescription>Accounting-invoice Sales vouchers for generated invoices in the selected date range.</CardDescription></div><Badge variant="outline">{generatedInvoices.length}</Badge></div></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Party, Sales, CGST, SGST, IGST and round-off ledger entries are included where applicable.</p><Button className="w-full" disabled={!canManage || !generatedInvoices.length} onClick={exportInvoices}><FileCode2 />Download invoice Tally XML</Button></CardContent></Card>
      <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>Payslip journal vouchers</CardTitle><CardDescription>Salary expense, employee payable and statutory-deduction Journal vouchers.</CardDescription></div><Badge variant="outline">{generatedPayslips.length}</Badge></div></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Each generated payslip becomes one balanced Journal voucher using the mapped employee ledger.</p><Button className="w-full" disabled={!canManage || !generatedPayslips.length} onClick={exportPayslips}><FileCode2 />Download payslip Tally XML</Button></CardContent></Card>
    </div>

    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Before importing, back up the Tally company and confirm that every referenced ledger already exists. Test the XML in a development or copied Tally company first.</p>
  </div>
}

function settingLabel(key: keyof TallySettings) {
  const labels: Record<keyof TallySettings, string> = {
    companyName: "Tally company name",
    salesLedger: "Sales ledger",
    cgstLedger: "Output CGST ledger",
    sgstLedger: "Output SGST ledger",
    igstLedger: "Output IGST ledger",
    roundOffLedger: "Round-off ledger",
    salaryExpenseLedger: "Salary expense ledger",
    pfPayableLedger: "PF payable ledger",
    esiPayableLedger: "ESI payable ledger",
    professionalTaxPayableLedger: "Professional tax payable ledger",
    tdsPayableLedger: "TDS payable ledger",
    otherDeductionLedger: "Other deduction ledger",
  }
  return labels[key]
}

function LedgerNameInput({ initialValue, onSave, ariaLabel, disabled = false }: { initialValue: string; onSave: (value: string) => Promise<void>; ariaLabel: string; disabled?: boolean }) {
  const [value, setValue] = useState(initialValue)
  useEffect(() => setValue(initialValue), [initialValue])
  return <Input disabled={disabled} aria-label={ariaLabel} value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => { const cleaned = value.trim(); if (cleaned && cleaned !== initialValue) void onSave(cleaned) }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }} />
}

function LedgerMappingCard({ title, description, mapped, total, search, setSearch, downloadMapping, inputRef, importMapping, children }: { title: string; description: string; mapped: number; total: number; search: string; setSearch: (value: string) => void; downloadMapping: () => void; inputRef: React.RefObject<HTMLInputElement | null>; importMapping: (file: File) => Promise<void>; children: React.ReactNode }) {
  return <Card>
    <CardHeader><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div><Badge variant="secondary">{mapped} of {total} customized</Badge></div></CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names or ledger mappings…" /></div>
        <Button variant="outline" onClick={downloadMapping}><Download />Download mapping Excel</Button>
        <input ref={inputRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importMapping(file); event.target.value = "" }} />
        <Button variant="outline" onClick={() => inputRef.current?.click()}><Upload />Upload mapping Excel</Button>
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border">{children}</div>
      <p className="text-xs text-muted-foreground">To change one ledger separately, edit its field and press Enter or click outside it. If no custom mapping is saved, ChanaX uses the current customer or employee name.</p>
    </CardContent>
  </Card>
}
