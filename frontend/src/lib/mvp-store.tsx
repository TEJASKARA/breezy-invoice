import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import {
  deleteCompanyRow,
  deleteCustomerRow,
  deleteEmployeeRow,
  deleteExpenseRow,
  deleteInvoiceRow,
  deleteProformaRow,
  deleteEmployeeLetterRow,
  deletePayslipRow,
  loadWorkspace,
  saveFullWorkspace,
  saveWorkspaceSettings,
  upsertCompanies,
  upsertCustomers,
  upsertEmployees,
  upsertExpenses,
  upsertInvoices,
  upsertProformas,
  upsertEmployeeLetters,
  upsertPayslips,
} from "@/lib/workspace-repository"
import { trackAction } from "@/lib/usage-tracking"

export type TallySettings = {
  companyName: string
  salesLedger: string
  cgstLedger: string
  sgstLedger: string
  igstLedger: string
  roundOffLedger: string
  salaryExpenseLedger: string
  pfPayableLedger: string
  esiPayableLedger: string
  professionalTaxPayableLedger: string
  tdsPayableLedger: string
  otherDeductionLedger: string
}
export type Company = { id: string; companyName: string; billingAddress: string; hasGstin?: boolean; gstin: string; pan: string; premisesAddress: string; hsnSac: string; hsnSacCodes?: string[]; invoiceNumbering?: InvoiceNumbering; tallySettings?: TallySettings }
export type Customer = Company & { entityId: string; tallyLedgerName?: string; favorite?: boolean }
export type InvoiceLineItem = {
  id: string
  description: string
  hsnSac: string
  taxableAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
}
export type InvoiceStatus = "Draft" | "Generated" | "Cancelled" | "Amended"
export type InvoiceCorrectionMethod = "cancel_and_replace" | "irn_cancelled_and_replace" | "gstr1_amendment" | "credit_note" | "debit_note"
export type InvoiceCorrection = {
  method: InvoiceCorrectionMethod
  reason: string
  referenceNumber?: string
  recordedAt: string
  replacementInvoiceId?: string
  replacementInvoiceNumber?: string
}
export type Invoice = {
  id: string
  number: string
  entityName?: string
  customerId?: string
  companyName: string
  sourceNumber?: string
  sourceProformaId?: string
  sourceProformaNumber?: string
  date: string
  description?: string
  hsnSac?: string
  taxableAmount?: number
  cgstAmount?: number
  sgstAmount?: number
  igstAmount?: number
  amount: number
  tdsAmount?: number
  otherDeduction?: number
  netReceivable?: number
  lineItems?: InvoiceLineItem[]
  status: InvoiceStatus
  correction?: InvoiceCorrection
  correctsInvoiceId?: string
  correctsInvoiceNumber?: string
}
export type Proforma = Invoice & { entityId: string; validUntil?: string; convertedInvoiceId?: string; convertedInvoiceNumber?: string }
export type PayrollComponent = { id: string; label: string; amount: number }
export type AttendanceHoliday = { id: string; date: string; name: string }
export type AttendanceDayStatus = "present" | "half_day" | "paid_leave" | "unpaid_leave"
export type AttendanceDayRecord = { date: string; status: AttendanceDayStatus }
export type PayslipAttendance = {
  saturdayWeeklyOff: boolean
  sundayWeeklyOff: boolean
  holidays: AttendanceHoliday[]
  halfDays: number
  paidLeaveDays: number
  unpaidLeaveDays: number
  dailyRecords?: AttendanceDayRecord[]
  calendarDays: number
  weeklyOffDays: number
  holidayDays: number
  fullPresentDays: number
  eligiblePaidLeaveDays?: number
  excessLeaveDays?: number
  leaveAllowanceDays?: number
  leaveUsedBefore?: number
  leaveAllowancePeriod?: "monthly" | "yearly"
  lossOfPayDays?: number
  leaveDeductionAmount?: number
}
export type Employee = {
  id: string
  entityId: string
  employeeCode: string
  employeeName: string
  email?: string
  designation: string
  department: string
  pan: string
  uan: string
  esiNumber: string
  bankName: string
  bankAccount: string
  ifsc: string
  employmentStatus: string
  joiningDate: string
  defaultEarnings: PayrollComponent[]
  defaultDeductions: PayrollComponent[]
  overtimeMode?: "hourly" | "daily"
  overtimeRate?: number
  tallyLedgerName?: string
}
export type EmployeeLetter = {
  id: string
  entityId: string
  employeeId: string
  letterType: "offer" | "internship_offer" | "termination"
  title: string
  issueDate: string
  effectiveDate: string
  subject: string
  body: string
  status: "Draft" | "Issued"
  signatureName?: string
  issuedAt?: string
}
export type Payslip = {
  id: string
  entityId: string
  entityName: string
  employeeId: string
  employeeName: string
  employeeCode: string
  designation: string
  department: string
  pan: string
  uan: string
  esiNumber: string
  bankName: string
  bankAccount: string
  ifsc: string
  employmentStatus: string
  month: string
  paymentDate: string
  workingDays: number
  payableDays: number
  attendance?: PayslipAttendance
  extraWork?: { mode: "hourly" | "daily"; units: number; rate: number; amount: number }
  earnings: PayrollComponent[]
  deductions: PayrollComponent[]
  grossPay: number
  totalDeductions: number
  netPay: number
  status: "Draft" | "Generated"
  generatedAt?: string
}
export type Expense = {
  id: string
  entityId: string
  name: string
  category: string
  vendorName: string
  date: string
  amount: number
  paymentStatus: "Paid" | "Pending"
  notes: string
  billPath?: string
  billName?: string
}
export type TemplateTextBlock = {
  id: string
  text: string
  x: number
  y: number
  fontSize: number
  bold: boolean
  color: string
  align: "left" | "center" | "right"
}
export type TemplateElementId = "logo" | "issuer" | "invoiceTitle" | "customer" | "invoiceDetails" | "lineItems" | "totals" | "terms" | "signature"
export type TemplateElementSetting = {
  visible: boolean
  offsetX: number
  offsetY: number
  label: string
}
const defaultTemplateElements = (): Record<TemplateElementId, TemplateElementSetting> => ({
  logo: { visible: true, offsetX: 0, offsetY: 0, label: "Company logo" },
  issuer: { visible: true, offsetX: 0, offsetY: 0, label: "Company details" },
  invoiceTitle: { visible: true, offsetX: 0, offsetY: 0, label: "TAX INVOICE" },
  customer: { visible: true, offsetX: 0, offsetY: 0, label: "Bill to" },
  invoiceDetails: { visible: true, offsetX: 0, offsetY: 0, label: "Invoice details" },
  lineItems: { visible: true, offsetX: 0, offsetY: 0, label: "Item table" },
  totals: { visible: true, offsetX: 0, offsetY: 0, label: "Invoice totals" },
  terms: { visible: true, offsetX: 0, offsetY: 0, label: "Terms & conditions" },
  signature: { visible: true, offsetX: 0, offsetY: 0, label: "Authorised signatory" },
})
export type TemplateSettings = {
  preset: "classic" | "breeze" | "minimal"
  accentColor: string
  logoDataUrl: string | null
  signatureDataUrl: string | null
  signatureMode: "uploaded" | "system" | "none"
  showTerms: boolean
  termsText: string
  customTexts: TemplateTextBlock[]
  fontStyle: "sans" | "serif" | "mono"
  compact: boolean
  elements: Record<TemplateElementId, TemplateElementSetting>
  /** Per-entity overrides keyed by entity (company) id. Entities without an entry use the workspace default. */
  entityTemplates?: Record<string, TemplateSettings>
}
export type InvoiceNumbering = {
  mode: "default" | "continue"
  prefix: string
  /** Fixed text after the running number, e.g. "-A" in INV-25-A. Supports {FY}. */
  suffix?: string
  nextNumber: number
  padding: number
  resetPolicy?: "financial_year" | "never"
  financialYear?: string
}
export type LeavePolicy = {
  period: "monthly" | "yearly"
  allowanceDays: number
}
export type AttendanceDraft = {
  entityId: string
  month: string
  attendance: PayslipAttendance
  employeeRecords: Record<string, AttendanceDayRecord[]>
  updatedAt: string
}
export type Setup = {
  firmName: string
  industry: string
  accountType?: "ca" | "founder" | "employee"
  hasGstin?: boolean
  gstin: string
  pan?: string
  legalName?: string
  tradeName?: string
  gstRegistrationStatus?: string
  mailingAddress: string
  premisesAddress?: string
  invoiceNumbering?: InvoiceNumbering
  leavePolicy?: LeavePolicy
  attendanceDrafts?: Record<string, AttendanceDraft>
}
export type MvpState = { setup: Setup | null; companies: Company[]; customers: Customer[]; invoices: Invoice[]; proformas: Proforma[]; employees: Employee[]; employeeLetters: EmployeeLetter[]; payslips: Payslip[]; expenses: Expense[]; template: TemplateSettings }
type MvpStore = MvpState & {
  loading: boolean
  syncStatus: "local" | "loading" | "saving" | "synced" | "error"
  syncError: string | null
  completeSetup: (setup: Setup) => Promise<void>
  saveAttendanceDraft: (draft: AttendanceDraft) => Promise<void>
  addCompanies: (companies: Omit<Company, "id">[]) => Promise<void>
  updateCompany: (companyId: string, changes: Partial<Omit<Company, "id">>) => Promise<void>
  deleteCompany: (companyId: string) => Promise<void>
  addCustomers: (customers: Omit<Customer, "id">[]) => Promise<void>
  updateCustomer: (customerId: string, changes: Partial<Omit<Customer, "id">>) => Promise<void>
  deleteCustomer: (customerId: string) => Promise<void>
  addInvoice: (invoice: Omit<Invoice, "id" | "number">) => Promise<Invoice>
  addInvoices: (invoices: Omit<Invoice, "id" | "number">[]) => Promise<void>
  updateInvoice: (invoiceId: string, changes: Partial<Omit<Invoice, "id" | "number">>) => Promise<void>
  replaceInvoice: (invoiceId: string, replacement: Omit<Invoice, "id" | "number">, correction: InvoiceCorrection) => Promise<Invoice>
  deleteInvoice: (invoiceId: string) => Promise<void>
  addProforma: (proforma: Omit<Proforma, "id" | "number">) => Promise<void>
  updateProforma: (proformaId: string, changes: Partial<Omit<Proforma, "id">>) => Promise<void>
  deleteProforma: (proformaId: string) => Promise<void>
  addEmployee: (employee: Omit<Employee, "id">) => Promise<string>
  addEmployees: (employees: Omit<Employee, "id">[]) => Promise<void>
  updateEmployee: (employeeId: string, changes: Partial<Omit<Employee, "id">>) => Promise<void>
  deleteEmployee: (employeeId: string) => Promise<void>
  addEmployeeLetter: (letter: Omit<EmployeeLetter, "id">) => Promise<void>
  updateEmployeeLetter: (letterId: string, changes: Partial<Omit<EmployeeLetter, "id">>) => Promise<void>
  deleteEmployeeLetter: (letterId: string) => Promise<void>
  addPayslip: (payslip: Omit<Payslip, "id">) => Promise<void>
  addPayslips: (payslips: Omit<Payslip, "id">[]) => Promise<void>
  updatePayslip: (payslipId: string, changes: Partial<Omit<Payslip, "id">>) => Promise<void>
  deletePayslip: (payslipId: string) => Promise<void>
  addExpense: (expense: Omit<Expense, "id">) => Promise<string>
  updateExpense: (expenseId: string, changes: Partial<Omit<Expense, "id">>) => Promise<void>
  deleteExpense: (expenseId: string) => Promise<void>
  updateTemplate: (template: Partial<TemplateSettings>) => void
  templateFor: (entityId?: string | null) => TemplateSettings
  hasEntityTemplate: (entityId?: string | null) => boolean
  updateEntityTemplate: (entityId: string, template: Partial<TemplateSettings>) => void
  clearEntityTemplate: (entityId: string) => void
}

const legacyStorageKey = "breezyaccounts-mvp-data"
const MvpContext = createContext<MvpStore | null>(null)
const id = () => crypto.randomUUID()
const defaultTemplate = (): TemplateSettings => ({
  preset: "breeze",
  accentColor: "#2563EB",
  logoDataUrl: null,
  signatureDataUrl: null,
  signatureMode: "system",
  showTerms: true,
  termsText: "Payment is due as agreed with the issuing entity. Thank you for your business.",
  customTexts: [],
  fontStyle: "sans",
  compact: false,
  elements: defaultTemplateElements(),
})

export type InvoiceNumberDigitGroup = { index: number; start: number; end: number; digits: string; looksLikeYear: boolean }

/** Every run of digits in an invoice number, flagging the ones that look like a year or financial year (2025, 2025-26, 25-26). */
export function invoiceNumberDigitGroups(value: string): InvoiceNumberDigitGroup[] {
  const normalized = value.trim()
  const groups: InvoiceNumberDigitGroup[] = [...normalized.matchAll(/\d+/g)].map((match, index) => ({
    index,
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    digits: match[0],
    looksLikeYear: match[0].length === 4 && /^(19|20)\d{2}$/.test(match[0]),
  }))
  // Financial-year ranges such as 2025-26, 25-26 or 2025/26: both halves are years, not the running number.
  for (let i = 0; i < groups.length - 1; i++) {
    const first = groups[i]
    const second = groups[i + 1]
    const separator = normalized.slice(first.end, second.start)
    if (!["-", "/"].includes(separator) || second.digits.length !== 2) continue
    if (first.digits.length !== 2 && first.digits.length !== 4) continue
    if ((Number(first.digits.slice(-2)) + 1) % 100 === Number(second.digits)) {
      first.looksLikeYear = true
      second.looksLikeYear = true
    }
  }
  return groups
}

/** The digit group most likely to be the running number: the last one that is not part of a year. */
export function defaultSequenceGroupIndex(value: string): number | null {
  const groups = invoiceNumberDigitGroups(value)
  if (!groups.length) return null
  const candidate = [...groups].reverse().find((group) => !group.looksLikeYear)
  return (candidate ?? groups[groups.length - 1]).index
}

/**
 * Reads the user's latest invoice number and returns the numbering that continues it.
 * The running number can sit anywhere: rxy_rus25 -> rxy_rus26, INV-25-A -> INV-26-A, RT/001/2025-26 -> RT/002/2025-26.
 * Pass sequenceGroupIndex to choose which digit group is the running number when there are several.
 */
export function parseExistingInvoiceNumber(value: string, sequenceGroupIndex?: number | null): InvoiceNumbering | null {
  const normalized = value.trim()
  const groups = invoiceNumberDigitGroups(normalized)
  if (!groups.length) return null
  const chosenIndex = sequenceGroupIndex ?? defaultSequenceGroupIndex(normalized)
  const group = groups.find((item) => item.index === chosenIndex) ?? groups[groups.length - 1]
  const currentNumber = Number(group.digits)
  if (!Number.isSafeInteger(currentNumber)) return null
  return {
    mode: "continue",
    prefix: normalized.slice(0, group.start),
    suffix: normalized.slice(group.end),
    nextNumber: currentNumber + 1,
    padding: group.digits.length,
  }
}

/** Builds the visible invoice number from a numbering rule. */
export function formatInvoiceNumber(numbering: Pick<InvoiceNumbering, "prefix" | "suffix" | "padding">, sequence: number, financialYear?: string) {
  const fy = financialYear || financialYearFor()
  return `${numbering.prefix.replaceAll("{FY}", fy)}${String(sequence).padStart(numbering.padding, "0")}${(numbering.suffix || "").replaceAll("{FY}", fy)}`
}

function nextDefaultInvoiceNumber(invoices: Invoice[], offset = 0) {
  const year = new Date().getFullYear()
  const prefix = `INV-${year}-`
  const highestNumber = invoices.reduce((highest, invoice) => {
    if (!invoice.number.startsWith(prefix)) return highest
    const sequence = Number(invoice.number.slice(prefix.length))
    return Number.isSafeInteger(sequence) ? Math.max(highest, sequence) : highest
  }, 0)
  return `${prefix}${String(highestNumber + offset + 1).padStart(4, "0")}`
}

export function nextInvoiceNumber(setup: Setup | null, invoices: Invoice[]) {
  const numbering = setup?.invoiceNumbering
  if (numbering?.mode === "continue") {
    return formatInvoiceNumber(numbering, numbering.nextNumber)
  }
  return nextDefaultInvoiceNumber(invoices)
}

function financialYearFor(date = new Date()) {
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
  return `${startYear}-${String(startYear + 1).slice(-2)}`
}

function normalizedCompanyNumbering(company: Company | undefined): InvoiceNumbering | undefined {
  const numbering = company?.invoiceNumbering
  if (!numbering) return undefined
  const currentFinancialYear = financialYearFor()
  if (numbering.resetPolicy === "financial_year" && numbering.financialYear !== currentFinancialYear) {
    return { ...numbering, nextNumber: 1, financialYear: currentFinancialYear }
  }
  return { ...numbering, financialYear: numbering.financialYear || currentFinancialYear }
}

/** The number the next invoice issued by this entity will get (falls back to the workspace numbering). */
export function nextInvoiceNumberForEntity(company: Company | undefined, setup: Setup | null, invoices: Invoice[]) {
  const numbering = normalizedCompanyNumbering(company)
  if (!numbering) return nextInvoiceNumber(setup, invoices)
  return formatInvoiceNumber(numbering, numbering.nextNumber, numbering.financialYear)
}
const numberFromCompany = nextInvoiceNumberForEntity

function advanceCompanyNumbering(company: Company, issuedNumbers: string[]) {
  const numbering = normalizedCompanyNumbering(company)
  if (!numbering) return company
  const fy = numbering.financialYear || financialYearFor()
  const resolvedPrefix = numbering.prefix.replaceAll("{FY}", fy)
  const resolvedSuffix = (numbering.suffix || "").replaceAll("{FY}", fy)
  const highestIssued = issuedNumbers.reduce((highest, value) => {
    if (!value.startsWith(resolvedPrefix) || !value.endsWith(resolvedSuffix)) return highest
    const sequence = value.slice(resolvedPrefix.length, value.length - resolvedSuffix.length)
    if (!/^\d+$/.test(sequence)) return highest
    return Math.max(highest, Number(sequence))
  }, numbering.nextNumber - 1)
  return {
    ...company,
    invoiceNumbering: { ...numbering, nextNumber: Math.max(numbering.nextNumber, highestIssued + 1) },
  }
}
function normalizeTemplate(saved: Partial<TemplateSettings> | undefined | null): TemplateSettings {
  const { entityTemplates: _ignored, ...rest } = saved || {}
  return {
    ...defaultTemplate(),
    ...rest,
    customTexts: Array.isArray(saved?.customTexts) ? saved.customTexts : [],
    elements: {
      ...defaultTemplateElements(),
      ...(saved?.elements || {}),
    },
  }
}

/** Standalone copy of a template without the per-entity map, safe to store as an entity override. */
function baseTemplate(template: TemplateSettings): TemplateSettings {
  const normalized = normalizeTemplate(template)
  return {
    ...normalized,
    customTexts: normalized.customTexts.map((block) => ({ ...block })),
    elements: Object.fromEntries(Object.entries(normalized.elements).map(([key, value]) => [key, { ...value }])) as TemplateSettings["elements"],
  }
}

function normalizeWorkspaceTemplate(saved: Partial<TemplateSettings> | undefined | null): TemplateSettings {
  const entityTemplates = Object.fromEntries(
    Object.entries(saved?.entityTemplates || {})
      .filter(([, value]) => value && typeof value === "object")
      .map(([entityId, value]) => [entityId, normalizeTemplate(value)]),
  )
  return { ...normalizeTemplate(saved), entityTemplates }
}

const emptyState = (): MvpState => ({ setup: null, companies: [], customers: [], invoices: [], proformas: [], employees: [], employeeLetters: [], payslips: [], expenses: [], template: defaultTemplate() })
function normalizeState(saved: Partial<MvpState>): MvpState {
  const restored = {
    ...emptyState(),
    ...saved,
    template: normalizeWorkspaceTemplate(saved.template),
  }
  const fallbackEntityId = restored.companies[0]?.id || ""
  const fallbackEntityName = restored.companies[0]?.companyName || ""
  return {
    ...restored,
    companies: restored.companies.map((company) => ({
      ...company,
      hsnSacCodes: [...new Set([...(company.hsnSacCodes || []), company.hsnSac].filter(Boolean))],
    })),
    expenses: restored.expenses || [],
    proformas: restored.proformas || [],
    employeeLetters: restored.employeeLetters || [],
    customers: restored.customers.map((customer) => ({ ...customer, entityId: customer.entityId || fallbackEntityId })),
    employees: (restored.employees || []).map((employee) => ({
      ...employee,
      entityId: employee.entityId || fallbackEntityId,
      defaultEarnings: employee.defaultEarnings || [],
      defaultDeductions: employee.defaultDeductions || [],
    })),
    payslips: restored.payslips.map((payslip) => {
      const legacy = payslip as Payslip & { netPay: number }
      const earnings = legacy.earnings?.length ? legacy.earnings : [{ id: id(), label: "Salary", amount: legacy.netPay || 0 }]
      const deductions = legacy.deductions || []
      const grossPay = legacy.grossPay ?? earnings.reduce((sum, item) => sum + item.amount, 0)
      const totalDeductions = legacy.totalDeductions ?? deductions.reduce((sum, item) => sum + item.amount, 0)
      return {
        ...legacy,
        entityId: legacy.entityId || fallbackEntityId,
        entityName: legacy.entityName || fallbackEntityName,
        employeeId: legacy.employeeId || "",
        employeeCode: legacy.employeeCode || "",
        designation: legacy.designation || "",
        department: legacy.department || "",
        pan: legacy.pan || "",
        uan: legacy.uan || "",
        esiNumber: legacy.esiNumber || "",
        bankName: legacy.bankName || "",
        bankAccount: legacy.bankAccount || "",
        ifsc: legacy.ifsc || "",
        employmentStatus: legacy.employmentStatus || "Regular",
        paymentDate: legacy.paymentDate || "",
        workingDays: legacy.workingDays || 0,
        payableDays: legacy.payableDays || 0,
        earnings,
        deductions,
        grossPay,
        totalDeductions,
        netPay: legacy.netPay ?? grossPay - totalDeductions,
      }
    }),
  }
}

function readState(storageKey: string): MvpState {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(storageKey) ?? "") as Partial<MvpState>)
  } catch {
    return emptyState()
  }
}

export function MvpStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MvpState>(emptyState)
  const [storageKey, setStorageKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<MvpStore["syncStatus"]>(supabase ? "loading" : "local")
  const [syncError, setSyncError] = useState<string | null>(null)
  const stateRef = useRef(state)
  const userIdRef = useRef<string | null>(null)
  const workspaceIdRef = useRef<string | null>(null)
  const loadSequence = useRef(0)
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve())

  const commit = (next: MvpState) => {
    stateRef.current = next
    setState(next)
  }

  const persist = (operation: (userId: string, workspaceId: string) => Promise<void>) => {
    const userId = userIdRef.current
    const workspaceId = workspaceIdRef.current
    if (!userId || !workspaceId || !supabase) {
      setSyncStatus("local")
      return
    }
    setSyncStatus("saving")
    setSyncError(null)
    const task = persistenceQueue.current
      .catch(() => undefined)
      .then(() => operation(userId, workspaceId))
    persistenceQueue.current = task
    void task
      .then(() => setSyncStatus("synced"))
      .catch((error: unknown) => {
        setSyncStatus("error")
        setSyncError(error instanceof Error ? error.message : "Supabase could not save this change.")
      })
  }

  const persistAndWait = async (operation: (userId: string, workspaceId: string) => Promise<void>) => {
    const userId = userIdRef.current
    const workspaceId = workspaceIdRef.current
    if (!userId || !workspaceId || !supabase) {
      throw new Error("Your workspace is still loading. Please wait a moment and try again.")
    }
    setSyncStatus("saving")
    setSyncError(null)
    const task = persistenceQueue.current
      .catch(() => undefined)
      .then(() => operation(userId, workspaceId))
    persistenceQueue.current = task
    try {
      await task
      setSyncStatus("synced")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Supabase could not save this change."
      setSyncStatus("error")
      setSyncError(message)
      throw new Error(message)
    }
  }

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      setSyncStatus("local")
      setSyncError("Supabase is not configured. Changes are only cached in this browser.")
      return
    }
    const hydrate = async (userId: string | null) => {
      const sequence = ++loadSequence.current
      userIdRef.current = userId
      if (!userId) {
        workspaceIdRef.current = null
        commit(emptyState())
        setStorageKey(null)
        setSyncStatus("local")
        setSyncError(null)
        setLoading(false)
        return
      }
      setLoading(true)
      setSyncStatus("loading")
      setSyncError(null)
      const userCacheKey = `breezyaccounts-mvp-data:${userId}`
      const hasOwnData = localStorage.getItem(userCacheKey) !== null
      const legacyData = localStorage.getItem(legacyStorageKey)
      const cachedState = hasOwnData ? readState(userCacheKey) : legacyData ? readState(legacyStorageKey) : emptyState()
      try {
        const preferredWorkspaceId = window.localStorage.getItem(`chanax-active-workspace:${userId}`)
        const remoteState = await loadWorkspace(userId, preferredWorkspaceId)
        if (sequence !== loadSequence.current) return
        if (remoteState) {
          const { workspaceId, hasData, ...workspaceData } = remoteState
          workspaceIdRef.current = workspaceId
          const workspaceCacheKey = `breezyinvoice-workspace:${workspaceId}`
          const workspaceCache = localStorage.getItem(workspaceCacheKey) ? readState(workspaceCacheKey) : cachedState
          if (hasData) commit(normalizeState(workspaceData))
          else {
            commit(workspaceCache)
            await saveFullWorkspace(userId, workspaceId, workspaceCache)
          }
          setStorageKey(workspaceCacheKey)
        } else {
          commit(cachedState)
          throw new Error("No active ChanaX workspace was found for this account.")
        }
        if (!hasOwnData && legacyData) localStorage.removeItem(legacyStorageKey)
        setSyncStatus("synced")
      } catch (error) {
        if (sequence !== loadSequence.current) return
        commit(cachedState)
        setSyncStatus("error")
        setSyncError(error instanceof Error ? error.message : "Supabase workspace data could not be loaded.")
      } finally {
        if (sequence === loadSequence.current) {
          setLoading(false)
        }
      }
    }
    void supabase.auth.getSession().then(({ data }) => hydrate(data.session?.user.id ?? null))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => void hydrate(session?.user.id ?? null))
    })
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => { if (storageKey && !loading) localStorage.setItem(storageKey, JSON.stringify(state)) }, [state, storageKey, loading])
  const value = useMemo<MvpStore>(() => ({
    ...state,
    loading,
    syncStatus,
    syncError,
    completeSetup: async (setup) => {
      const next = { ...stateRef.current, setup }
      await persistAndWait((userId, workspaceId) => saveWorkspaceSettings(userId, workspaceId, setup, next.template))
      commit(next)
    },
    saveAttendanceDraft: async (draft) => {
      const current = stateRef.current
      if (!current.setup) throw new Error("Complete your firm setup before saving attendance.")
      const key = `${draft.entityId}:${draft.month}`
      const nextSetup = { ...current.setup, attendanceDrafts: { ...(current.setup.attendanceDrafts || {}), [key]: draft } }
      await persistAndWait((userId, workspaceId) => saveWorkspaceSettings(userId, workspaceId, nextSetup, current.template))
      commit({ ...stateRef.current, setup: nextSetup })
      trackAction("attendance_saved")
    },
    addCompanies: async (companies) => {
      const added = companies.map((company) => {
        const gstin = company.gstin.toUpperCase().trim()
        return { ...company, id: id(), gstin, pan: company.pan.trim().toUpperCase() || (gstin.length >= 12 ? gstin.slice(2, 12) : "") }
      })
      await persistAndWait((userId, workspaceId) => upsertCompanies(userId, workspaceId, added))
      commit({ ...stateRef.current, companies: [...added, ...stateRef.current.companies] })
      trackAction("entity_created", { count: added.length })
    },
    updateCompany: async (companyId, changes) => {
      const existing = stateRef.current.companies.find((company) => company.id === companyId)
      if (!existing) return
      const updated = { ...existing, ...changes }
      await persistAndWait((userId, workspaceId) => upsertCompanies(userId, workspaceId, [updated]))
      commit({ ...stateRef.current, companies: stateRef.current.companies.map((company) => company.id === companyId ? updated : company) })
    },
    deleteCompany: async (companyId) => {
      await persistAndWait((_userId, workspaceId) => deleteCompanyRow(workspaceId, companyId))
      const current = stateRef.current
      let nextTemplate = current.template
      if (current.template.entityTemplates?.[companyId]) {
        const { [companyId]: _removed, ...remaining } = current.template.entityTemplates
        nextTemplate = { ...current.template, entityTemplates: remaining }
        persist((userId, workspaceId) => saveWorkspaceSettings(userId, workspaceId, current.setup, nextTemplate))
      }
      commit({
        ...current,
        template: nextTemplate,
        companies: current.companies.filter((company) => company.id !== companyId),
        customers: current.customers.filter((customer) => customer.entityId !== companyId),
        employees: current.employees.filter((employee) => employee.entityId !== companyId),
        payslips: current.payslips.filter((payslip) => payslip.entityId !== companyId),
        expenses: current.expenses.filter((expense) => expense.entityId !== companyId),
      })
    },
    addCustomers: async (customers) => {
      const added = customers.map((customer) => {
        const gstin = customer.gstin.toUpperCase().trim()
        return { ...customer, id: id(), gstin, pan: customer.pan.trim().toUpperCase() || (gstin.length >= 12 ? gstin.slice(2, 12) : "") }
      })
      await persistAndWait((userId, workspaceId) => upsertCustomers(userId, workspaceId, added))
      commit({ ...stateRef.current, customers: [...added, ...stateRef.current.customers] })
      trackAction("customer_created", { count: added.length })
    },
    updateCustomer: async (customerId, changes) => {
      const existing = stateRef.current.customers.find((customer) => customer.id === customerId)
      if (!existing) return
      const updated = { ...existing, ...changes }
      await persistAndWait((userId, workspaceId) => upsertCustomers(userId, workspaceId, [updated]))
      commit({ ...stateRef.current, customers: stateRef.current.customers.map((customer) => customer.id === customerId ? updated : customer) })
    },
    deleteCustomer: async (customerId) => {
      await persistAndWait((_userId, workspaceId) => deleteCustomerRow(workspaceId, customerId))
      commit({ ...stateRef.current, customers: stateRef.current.customers.filter((customer) => customer.id !== customerId) })
    },
    addInvoice: async (invoice) => {
      const current = stateRef.current
      const company = current.companies.find((candidate) => candidate.companyName === invoice.entityName)
      const issuedNumber = numberFromCompany(company, current.setup, current.invoices)
      const added = { ...invoice, id: id(), number: issuedNumber }
      const updatedCompany = company ? advanceCompanyNumbering(company, [issuedNumber]) : undefined
      const nextCompanies = updatedCompany
        ? current.companies.map((candidate) => candidate.id === updatedCompany.id ? updatedCompany : candidate)
        : current.companies
      const nextSetup = !company && current.setup?.invoiceNumbering?.mode === "continue"
        ? { ...current.setup, invoiceNumbering: { ...current.setup.invoiceNumbering, nextNumber: current.setup.invoiceNumbering.nextNumber + 1 } }
        : current.setup
      await persistAndWait(async (userId, workspaceId) => {
        if (nextSetup !== current.setup) await saveWorkspaceSettings(userId, workspaceId, nextSetup, current.template)
        if (updatedCompany) await upsertCompanies(userId, workspaceId, [updatedCompany])
        await upsertInvoices(userId, workspaceId, [added])
      })
      commit({ ...stateRef.current, setup: nextSetup, companies: nextCompanies, invoices: [added, ...stateRef.current.invoices] })
      trackAction("invoice_created")
      return added
    },
    addInvoices: async (invoices) => {
      const current = stateRef.current
      const counters = new Map<string, number>()
      const added = invoices.map((invoice, index) => {
        const company = current.companies.find((candidate) => candidate.companyName === invoice.entityName)
        if (!company) return { ...invoice, id: id(), number: nextDefaultInvoiceNumber(current.invoices, index) }
        const numbering = normalizedCompanyNumbering(company)
        if (!numbering) return { ...invoice, id: id(), number: nextDefaultInvoiceNumber(current.invoices, index) }
        const offset = counters.get(company.id) || 0
        counters.set(company.id, offset + 1)
        return { ...invoice, id: id(), number: formatInvoiceNumber(numbering, numbering.nextNumber + offset, numbering.financialYear) }
      })
      const nextCompanies = current.companies.map((company) => {
        const related = added.filter((invoice) => invoice.entityName === company.companyName)
        if (!related.length) return company
        return advanceCompanyNumbering(company, related.flatMap((invoice) => [invoice.number, invoice.sourceNumber || ""]).filter(Boolean))
      })
      const changedCompanies = nextCompanies.filter((company, index) => company !== current.companies[index])
      await persistAndWait(async (userId, workspaceId) => {
        if (changedCompanies.length) await upsertCompanies(userId, workspaceId, changedCompanies)
        await upsertInvoices(userId, workspaceId, added)
      })
      commit({ ...stateRef.current, companies: nextCompanies, invoices: [...added, ...stateRef.current.invoices] })
      trackAction("invoices_bulk_imported", { count: added.length })
    },
    updateInvoice: async (invoiceId, changes) => {
      const existing = stateRef.current.invoices.find((invoice) => invoice.id === invoiceId)
      if (!existing) throw new Error("The invoice could not be found.")
      const updated = { ...existing, ...changes, id: existing.id, number: existing.number }
      await persistAndWait((userId, workspaceId) => upsertInvoices(userId, workspaceId, [updated]))
      commit({ ...stateRef.current, invoices: stateRef.current.invoices.map((invoice) => invoice.id === invoiceId ? updated : invoice) })
      trackAction("invoice_updated", { invoice_id: invoiceId })
    },
    replaceInvoice: async (invoiceId, replacement, correction) => {
      const current = stateRef.current
      const original = current.invoices.find((invoice) => invoice.id === invoiceId)
      if (!original) throw new Error("The original invoice could not be found.")
      if (original.status === "Draft") throw new Error("Draft invoices should be edited instead of replaced.")
      if (original.status === "Cancelled") throw new Error("This invoice has already been cancelled.")
      const company = current.companies.find((candidate) => candidate.companyName === replacement.entityName)
      const issuedNumber = numberFromCompany(company, current.setup, current.invoices)
      const added: Invoice = {
        ...replacement,
        id: id(),
        number: issuedNumber,
        correctsInvoiceId: original.id,
        correctsInvoiceNumber: original.sourceNumber || original.number,
      }
      const correctedOriginal: Invoice = {
        ...original,
        status: "Cancelled",
        correction: {
          ...correction,
          replacementInvoiceId: added.id,
          replacementInvoiceNumber: added.number,
        },
      }
      const updatedCompany = company ? advanceCompanyNumbering(company, [issuedNumber]) : undefined
      const nextCompanies = updatedCompany
        ? current.companies.map((candidate) => candidate.id === updatedCompany.id ? updatedCompany : candidate)
        : current.companies
      const nextSetup = !company && current.setup?.invoiceNumbering?.mode === "continue"
        ? { ...current.setup, invoiceNumbering: { ...current.setup.invoiceNumbering, nextNumber: current.setup.invoiceNumbering.nextNumber + 1 } }
        : current.setup
      await persistAndWait(async (userId, workspaceId) => {
        if (nextSetup !== current.setup) await saveWorkspaceSettings(userId, workspaceId, nextSetup, current.template)
        if (updatedCompany) await upsertCompanies(userId, workspaceId, [updatedCompany])
        await upsertInvoices(userId, workspaceId, [correctedOriginal, added])
      })
      commit({
        ...stateRef.current,
        setup: nextSetup,
        companies: nextCompanies,
        invoices: [added, ...stateRef.current.invoices.map((invoice) => invoice.id === invoiceId ? correctedOriginal : invoice)],
      })
      trackAction("invoice_corrected", { invoice_id: invoiceId, replacement_invoice_id: added.id, method: correction.method })
      return added
    },
    deleteInvoice: async (invoiceId) => {
      const existing = stateRef.current.invoices.find((invoice) => invoice.id === invoiceId)
      if (!existing) throw new Error("The invoice could not be found.")
      if (existing.status !== "Draft") throw new Error("Issued invoices cannot be deleted. Use Correct invoice to preserve the audit trail.")
      await persistAndWait((_userId, workspaceId) => deleteInvoiceRow(workspaceId, invoiceId))
      commit({ ...stateRef.current, invoices: stateRef.current.invoices.filter((invoice) => invoice.id !== invoiceId) })
      trackAction("invoice_deleted")
    },
    addProforma: async (proforma) => {
      const current = stateRef.current
      const prefix = `QTN-${new Date().getFullYear()}-`
      const highest = current.proformas.reduce((value, item) => {
        const sequence = item.entityId === proforma.entityId && item.number.startsWith(prefix) ? Number(item.number.slice(prefix.length)) : 0
        return Number.isSafeInteger(sequence) ? Math.max(value, sequence) : value
      }, 0)
      const added: Proforma = { ...proforma, id: id(), number: `${prefix}${String(highest + 1).padStart(4, "0")}` }
      await persistAndWait((userId, workspaceId) => upsertProformas(userId, workspaceId, [added]))
      commit({ ...stateRef.current, proformas: [added, ...stateRef.current.proformas] })
      trackAction("quotation_created")
    },
    updateProforma: async (proformaId, changes) => {
      const existing = stateRef.current.proformas.find((item) => item.id === proformaId)
      if (!existing) return
      const updated = { ...existing, ...changes }
      await persistAndWait((userId, workspaceId) => upsertProformas(userId, workspaceId, [updated]))
      commit({ ...stateRef.current, proformas: stateRef.current.proformas.map((item) => item.id === proformaId ? updated : item) })
    },
    deleteProforma: async (proformaId) => {
      await persistAndWait((_userId, workspaceId) => deleteProformaRow(workspaceId, proformaId))
      commit({ ...stateRef.current, proformas: stateRef.current.proformas.filter((item) => item.id !== proformaId) })
    },
    addEmployee: async (employee) => {
      const employeeId = id()
      const added = { ...employee, id: employeeId }
      await persistAndWait((userId, workspaceId) => upsertEmployees(userId, workspaceId, [added]))
      commit({ ...stateRef.current, employees: [added, ...stateRef.current.employees] })
      trackAction("employee_created")
      return employeeId
    },
    addEmployees: async (employees) => {
      const added = employees.map((employee) => ({ ...employee, id: id() }))
      await persistAndWait((userId, workspaceId) => upsertEmployees(userId, workspaceId, added))
      commit({ ...stateRef.current, employees: [...added, ...stateRef.current.employees] })
      trackAction("employees_imported", { count: added.length })
    },
    updateEmployee: async (employeeId, changes) => {
      const existing = stateRef.current.employees.find((employee) => employee.id === employeeId)
      if (!existing) return
      const updated = { ...existing, ...changes }
      await persistAndWait((userId, workspaceId) => upsertEmployees(userId, workspaceId, [updated]))
      commit({ ...stateRef.current, employees: stateRef.current.employees.map((employee) => employee.id === employeeId ? updated : employee) })
    },
    deleteEmployee: async (employeeId) => {
      await persistAndWait((_userId, workspaceId) => deleteEmployeeRow(workspaceId, employeeId))
      commit({ ...stateRef.current, employees: stateRef.current.employees.filter((employee) => employee.id !== employeeId) })
    },
    addEmployeeLetter: async (letter) => {
      const added: EmployeeLetter = { ...letter, id: id() }
      await persistAndWait((userId, workspaceId) => upsertEmployeeLetters(userId, workspaceId, [added]))
      commit({ ...stateRef.current, employeeLetters: [added, ...stateRef.current.employeeLetters] })
      trackAction("employee_letter_created", { letter_type: added.letterType })
    },
    updateEmployeeLetter: async (letterId, changes) => {
      const existing = stateRef.current.employeeLetters.find((letter) => letter.id === letterId)
      if (!existing) return
      const updated = { ...existing, ...changes }
      await persistAndWait((userId, workspaceId) => upsertEmployeeLetters(userId, workspaceId, [updated]))
      commit({ ...stateRef.current, employeeLetters: stateRef.current.employeeLetters.map((letter) => letter.id === letterId ? updated : letter) })
    },
    deleteEmployeeLetter: async (letterId) => {
      await persistAndWait((_userId, workspaceId) => deleteEmployeeLetterRow(workspaceId, letterId))
      commit({ ...stateRef.current, employeeLetters: stateRef.current.employeeLetters.filter((letter) => letter.id !== letterId) })
    },
    addPayslip: async (payslip) => {
      const added = { ...payslip, id: id() }
      await persistAndWait((userId, workspaceId) => upsertPayslips(userId, workspaceId, [added]))
      commit({ ...stateRef.current, payslips: [added, ...stateRef.current.payslips] })
      trackAction("payslip_created")
    },
    addPayslips: async (payslips) => {
      const added = payslips.map((payslip) => ({ ...payslip, id: id() }))
      await persistAndWait((userId, workspaceId) => upsertPayslips(userId, workspaceId, added))
      commit({ ...stateRef.current, payslips: [...added, ...stateRef.current.payslips] })
      trackAction("payslips_bulk_created", { count: added.length })
    },
    updatePayslip: async (payslipId, changes) => {
      const existing = stateRef.current.payslips.find((payslip) => payslip.id === payslipId)
      if (!existing) return
      const updated = { ...existing, ...changes }
      await persistAndWait((userId, workspaceId) => upsertPayslips(userId, workspaceId, [updated]))
      commit({ ...stateRef.current, payslips: stateRef.current.payslips.map((payslip) => payslip.id === payslipId ? updated : payslip) })
    },
    deletePayslip: async (payslipId) => {
      await persistAndWait((_userId, workspaceId) => deletePayslipRow(workspaceId, payslipId))
      commit({ ...stateRef.current, payslips: stateRef.current.payslips.filter((payslip) => payslip.id !== payslipId) })
    },
    addExpense: async (expense) => {
      const expenseId = id()
      const added = { ...expense, id: expenseId }
      await persistAndWait((userId, workspaceId) => upsertExpenses(userId, workspaceId, [added]))
      commit({ ...stateRef.current, expenses: [added, ...stateRef.current.expenses] })
      trackAction("expense_created")
      return expenseId
    },
    updateExpense: async (expenseId, changes) => {
      const existing = stateRef.current.expenses.find((expense) => expense.id === expenseId)
      if (!existing) return
      const updated = { ...existing, ...changes }
      await persistAndWait((userId, workspaceId) => upsertExpenses(userId, workspaceId, [updated]))
      commit({ ...stateRef.current, expenses: stateRef.current.expenses.map((expense) => expense.id === expenseId ? updated : expense) })
    },
    deleteExpense: async (expenseId) => {
      await persistAndWait((_userId, workspaceId) => deleteExpenseRow(workspaceId, expenseId))
      commit({ ...stateRef.current, expenses: stateRef.current.expenses.filter((expense) => expense.id !== expenseId) })
    },
    updateTemplate: (template) => {
      const updatedTemplate = { ...stateRef.current.template, ...template }
      const next = { ...stateRef.current, template: updatedTemplate }
      commit(next)
      persist((userId, workspaceId) => saveWorkspaceSettings(userId, workspaceId, next.setup, updatedTemplate))
    },
    templateFor: (entityId) => {
      const entityTemplate = entityId ? state.template.entityTemplates?.[entityId] : undefined
      return baseTemplate(entityTemplate || state.template)
    },
    hasEntityTemplate: (entityId) => Boolean(entityId && state.template.entityTemplates?.[entityId]),
    updateEntityTemplate: (entityId, changes) => {
      const current = stateRef.current
      const existing = current.template.entityTemplates?.[entityId]
      const updatedEntityTemplate = { ...(existing ? baseTemplate(existing) : baseTemplate(current.template)), ...changes }
      delete updatedEntityTemplate.entityTemplates
      const updatedTemplate = { ...current.template, entityTemplates: { ...(current.template.entityTemplates || {}), [entityId]: updatedEntityTemplate } }
      const next = { ...current, template: updatedTemplate }
      commit(next)
      persist((userId, workspaceId) => saveWorkspaceSettings(userId, workspaceId, next.setup, updatedTemplate))
    },
    clearEntityTemplate: (entityId) => {
      const current = stateRef.current
      if (!current.template.entityTemplates?.[entityId]) return
      const { [entityId]: _removed, ...remaining } = current.template.entityTemplates
      const updatedTemplate = { ...current.template, entityTemplates: remaining }
      const next = { ...current, template: updatedTemplate }
      commit(next)
      persist((userId, workspaceId) => saveWorkspaceSettings(userId, workspaceId, next.setup, updatedTemplate))
    },
  }), [state, loading, syncStatus, syncError])
  return <MvpContext.Provider value={value}>{children}</MvpContext.Provider>
}
export function useMvpStore() { const store = useContext(MvpContext); if (!store) throw new Error("useMvpStore must be used inside MvpStoreProvider"); return store }
