import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import {
  deleteCompanyRow,
  deleteCustomerRow,
  deleteEmployeeRow,
  deleteExpenseRow,
  deleteInvoiceRow,
  deletePayslipRow,
  loadWorkspace,
  saveFullWorkspace,
  saveWorkspaceSettings,
  upsertCompanies,
  upsertCustomers,
  upsertEmployees,
  upsertExpenses,
  upsertInvoices,
  upsertPayslips,
} from "@/lib/workspace-repository"

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
export type Company = { id: string; companyName: string; billingAddress: string; gstin: string; pan: string; premisesAddress: string; hsnSac: string; tallySettings?: TallySettings }
export type Customer = Company & { entityId: string; tallyLedgerName?: string }
export type InvoiceLineItem = {
  id: string
  description: string
  hsnSac: string
  taxableAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
}
export type Invoice = {
  id: string
  number: string
  entityName?: string
  customerId?: string
  companyName: string
  sourceNumber?: string
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
  status: "Draft" | "Generated"
}
export type PayrollComponent = { id: string; label: string; amount: number }
export type Employee = {
  id: string
  entityId: string
  employeeCode: string
  employeeName: string
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
  tallyLedgerName?: string
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
}
export type InvoiceNumbering = {
  mode: "default" | "continue"
  prefix: string
  nextNumber: number
  padding: number
}
export type Setup = {
  firmName: string
  industry: string
  gstin: string
  mailingAddress: string
  invoiceNumbering?: InvoiceNumbering
}
export type MvpState = { setup: Setup | null; companies: Company[]; customers: Customer[]; invoices: Invoice[]; employees: Employee[]; payslips: Payslip[]; expenses: Expense[]; template: TemplateSettings }
type MvpStore = MvpState & {
  loading: boolean
  syncStatus: "local" | "loading" | "saving" | "synced" | "error"
  syncError: string | null
  completeSetup: (setup: Setup) => Promise<void>
  addCompanies: (companies: Omit<Company, "id">[]) => Promise<void>
  updateCompany: (companyId: string, changes: Partial<Omit<Company, "id">>) => Promise<void>
  deleteCompany: (companyId: string) => Promise<void>
  addCustomers: (customers: Omit<Customer, "id">[]) => Promise<void>
  updateCustomer: (customerId: string, changes: Partial<Omit<Customer, "id">>) => Promise<void>
  deleteCustomer: (customerId: string) => Promise<void>
  addInvoice: (invoice: Omit<Invoice, "id" | "number">) => Promise<void>
  addInvoices: (invoices: Omit<Invoice, "id" | "number">[]) => Promise<void>
  deleteInvoice: (invoiceId: string) => Promise<void>
  addEmployee: (employee: Omit<Employee, "id">) => Promise<string>
  addEmployees: (employees: Omit<Employee, "id">[]) => Promise<void>
  updateEmployee: (employeeId: string, changes: Partial<Omit<Employee, "id">>) => Promise<void>
  deleteEmployee: (employeeId: string) => Promise<void>
  addPayslip: (payslip: Omit<Payslip, "id">) => Promise<void>
  addPayslips: (payslips: Omit<Payslip, "id">[]) => Promise<void>
  updatePayslip: (payslipId: string, changes: Partial<Omit<Payslip, "id">>) => Promise<void>
  deletePayslip: (payslipId: string) => Promise<void>
  addExpense: (expense: Omit<Expense, "id">) => Promise<string>
  updateExpense: (expenseId: string, changes: Partial<Omit<Expense, "id">>) => Promise<void>
  deleteExpense: (expenseId: string) => Promise<void>
  updateTemplate: (template: Partial<TemplateSettings>) => void
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

export function parseExistingInvoiceNumber(value: string): InvoiceNumbering | null {
  const normalized = value.trim()
  const match = normalized.match(/^(.*?)(\d+)$/)
  if (!match) return null
  const currentNumber = Number(match[2])
  if (!Number.isSafeInteger(currentNumber)) return null
  return {
    mode: "continue",
    prefix: match[1],
    nextNumber: currentNumber + 1,
    padding: match[2].length,
  }
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
    return `${numbering.prefix}${String(numbering.nextNumber).padStart(numbering.padding, "0")}`
  }
  return nextDefaultInvoiceNumber(invoices)
}
const emptyState = (): MvpState => ({ setup: null, companies: [], customers: [], invoices: [], employees: [], payslips: [], expenses: [], template: defaultTemplate() })
function normalizeState(saved: Partial<MvpState>): MvpState {
  const restored = {
    ...emptyState(),
    ...saved,
    template: {
      ...defaultTemplate(),
      ...saved.template,
      customTexts: Array.isArray(saved.template?.customTexts) ? saved.template.customTexts : [],
      elements: {
        ...defaultTemplateElements(),
        ...(saved.template?.elements || {}),
      },
    },
  }
  const fallbackEntityId = restored.companies[0]?.id || ""
  const fallbackEntityName = restored.companies[0]?.companyName || ""
  return {
    ...restored,
    expenses: restored.expenses || [],
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
        const remoteState = await loadWorkspace(userId)
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
          throw new Error("No active BreezyInvoice workspace was found for this account.")
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
    addCompanies: async (companies) => {
      const added = companies.map((company) => {
        const gstin = company.gstin.toUpperCase().trim()
        return { ...company, id: id(), gstin, pan: company.pan.trim().toUpperCase() || (gstin.length >= 12 ? gstin.slice(2, 12) : "") }
      })
      await persistAndWait((userId, workspaceId) => upsertCompanies(userId, workspaceId, added))
      commit({ ...stateRef.current, companies: [...added, ...stateRef.current.companies] })
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
      commit({
        ...current,
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
      const added = { ...invoice, id: id(), number: nextInvoiceNumber(current.setup, current.invoices) }
      const nextSetup = current.setup?.invoiceNumbering?.mode === "continue"
        ? { ...current.setup, invoiceNumbering: { ...current.setup.invoiceNumbering, nextNumber: current.setup.invoiceNumbering.nextNumber + 1 } }
        : current.setup
      await persistAndWait(async (userId, workspaceId) => {
        if (nextSetup !== current.setup) await saveWorkspaceSettings(userId, workspaceId, nextSetup, current.template)
        await upsertInvoices(userId, workspaceId, [added])
      })
      commit({ ...stateRef.current, setup: nextSetup, invoices: [added, ...stateRef.current.invoices] })
    },
    addInvoices: async (invoices) => {
      const current = stateRef.current
      const added = invoices.map((invoice, index) => ({ ...invoice, id: id(), number: nextDefaultInvoiceNumber(current.invoices, index) }))
      await persistAndWait((userId, workspaceId) => upsertInvoices(userId, workspaceId, added))
      commit({ ...stateRef.current, invoices: [...added, ...stateRef.current.invoices] })
    },
    deleteInvoice: async (invoiceId) => {
      await persistAndWait((_userId, workspaceId) => deleteInvoiceRow(workspaceId, invoiceId))
      commit({ ...stateRef.current, invoices: stateRef.current.invoices.filter((invoice) => invoice.id !== invoiceId) })
    },
    addEmployee: async (employee) => {
      const employeeId = id()
      const added = { ...employee, id: employeeId }
      await persistAndWait((userId, workspaceId) => upsertEmployees(userId, workspaceId, [added]))
      commit({ ...stateRef.current, employees: [added, ...stateRef.current.employees] })
      return employeeId
    },
    addEmployees: async (employees) => {
      const added = employees.map((employee) => ({ ...employee, id: id() }))
      await persistAndWait((userId, workspaceId) => upsertEmployees(userId, workspaceId, added))
      commit({ ...stateRef.current, employees: [...added, ...stateRef.current.employees] })
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
    addPayslip: async (payslip) => {
      const added = { ...payslip, id: id() }
      await persistAndWait((userId, workspaceId) => upsertPayslips(userId, workspaceId, [added]))
      commit({ ...stateRef.current, payslips: [added, ...stateRef.current.payslips] })
    },
    addPayslips: async (payslips) => {
      const added = payslips.map((payslip) => ({ ...payslip, id: id() }))
      await persistAndWait((userId, workspaceId) => upsertPayslips(userId, workspaceId, added))
      commit({ ...stateRef.current, payslips: [...added, ...stateRef.current.payslips] })
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
  }), [state, loading, syncStatus, syncError])
  return <MvpContext.Provider value={value}>{children}</MvpContext.Provider>
}
export function useMvpStore() { const store = useContext(MvpContext); if (!store) throw new Error("useMvpStore must be used inside MvpStoreProvider"); return store }
