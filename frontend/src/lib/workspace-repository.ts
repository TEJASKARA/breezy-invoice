import { supabase } from "@/lib/supabase"
import { friendlyWorkspaceError } from "@/lib/workspace-errors"
import type { Company, Customer, Employee, EmployeeLetter, Expense, Invoice, MvpState, Payslip, Proforma, Setup, TemplateSettings } from "@/lib/mvp-store"

type PayloadRow = { id: string; payload: Record<string, unknown> }
type RelatedPayloadRow = PayloadRow & { entity_id: string }
type PayslipPayloadRow = RelatedPayloadRow & { employee_id: string | null }
type ProformaPayloadRow = RelatedPayloadRow & { customer_id: string | null }
type LetterPayloadRow = RelatedPayloadRow & { employee_id: string; letter_type: EmployeeLetter["letterType"] }

function client() {
  if (!supabase) throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.")
  return supabase
}

function withoutKeys<T extends Record<string, unknown>>(value: T, keys: string[]) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

function isMissingExpensesTable(error: { code?: string; message: string } | null) {
  if (!error) return false
  return error.code === "PGRST205" || error.message.includes("breezy_expenses") && error.message.includes("schema cache")
}

function isMissingOptionalTable(error: { code?: string; message: string } | null) {
  if (!error) return false
  return error.code === "PGRST205" || error.code === "42P01" || error.message.includes("schema cache")
}

export type WorkspaceLoadResult = Partial<MvpState> & { workspaceId: string; hasData: boolean }

export async function loadWorkspace(userId: string, preferredWorkspaceId?: string | null): Promise<WorkspaceLoadResult | null> {
  const db = client()
  let membershipQuery = db.from("breezy_workspace_members").select("workspace_id, role").eq("user_id", userId).eq("status", "active")
  if (preferredWorkspaceId) membershipQuery = membershipQuery.eq("workspace_id", preferredWorkspaceId)
  let membershipResult = await membershipQuery.order("created_at").limit(1).maybeSingle()
  throwIfError(membershipResult.error)
  if (!membershipResult.data?.workspace_id) {
    const profileResult = await db.from("profiles").select("account_type").eq("id", userId).maybeSingle()
    throwIfError(profileResult.error)
    if (profileResult.data?.account_type === "ca") return null
    const ensured = await db.rpc("breezy_ensure_my_workspace")
    if (ensured.error) {
      throw new Error(friendlyWorkspaceError(ensured.error))
    }
    membershipResult = await db.from("breezy_workspace_members").select("workspace_id, role").eq("user_id", userId).eq("status", "active").order("created_at").limit(1).maybeSingle()
    throwIfError(membershipResult.error)
  }
  const workspaceId = String(membershipResult.data?.workspace_id || "")
  if (!workspaceId) return null
  const [settingsResult, entitiesResult, customersResult, invoicesResult, proformasResult, employeesResult, payslipsResult, expensesResult, lettersResult] = await Promise.all([
    db.from("breezy_workspace_settings").select("setup, template").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("breezy_entities").select("id, payload").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    db.from("breezy_customers").select("id, entity_id, payload").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    db.from("breezy_invoices").select("id, payload").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    db.from("breezy_proformas").select("id, entity_id, customer_id, payload").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    db.from("breezy_employees").select("id, entity_id, payload").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    db.from("breezy_payslips").select("id, entity_id, employee_id, payload").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    db.from("breezy_expenses").select("id, entity_id, payload").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    db.from("breezy_employee_letters").select("id, entity_id, employee_id, letter_type, payload").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
  ])
  ;[settingsResult, entitiesResult, customersResult, invoicesResult, employeesResult, payslipsResult].forEach((result) => throwIfError(result.error))
  if (!isMissingOptionalTable(proformasResult.error)) throwIfError(proformasResult.error)
  if (!isMissingOptionalTable(lettersResult.error)) throwIfError(lettersResult.error)
  if (!isMissingExpensesTable(expensesResult.error)) throwIfError(expensesResult.error)
  const hasData = membershipResult.data?.role !== "owner" || Boolean(
    settingsResult.data
    || entitiesResult.data?.length
    || customersResult.data?.length
    || invoicesResult.data?.length
    || employeesResult.data?.length
    || payslipsResult.data?.length
    || (!expensesResult.error && expensesResult.data?.length)
  )
  return {
    workspaceId,
    hasData,
    setup: (settingsResult.data?.setup as Setup | null | undefined) ?? null,
    template: (settingsResult.data?.template as TemplateSettings | undefined),
    companies: ((entitiesResult.data || []) as PayloadRow[]).map((row) => ({ ...row.payload, id: row.id }) as Company),
    customers: ((customersResult.data || []) as RelatedPayloadRow[]).map((row) => ({ ...row.payload, id: row.id, entityId: row.entity_id }) as Customer),
    invoices: ((invoicesResult.data || []) as PayloadRow[]).map((row) => ({ ...row.payload, id: row.id }) as Invoice),
    proformas: ((proformasResult.error ? [] : proformasResult.data || []) as ProformaPayloadRow[]).map((row) => ({ ...row.payload, id: row.id, entityId: row.entity_id, customerId: row.customer_id || undefined }) as Proforma),
    employees: ((employeesResult.data || []) as RelatedPayloadRow[]).map((row) => ({ ...row.payload, id: row.id, entityId: row.entity_id }) as Employee),
    payslips: ((payslipsResult.data || []) as PayslipPayloadRow[]).map((row) => ({
      ...row.payload,
      id: row.id,
      entityId: row.entity_id,
      employeeId: row.employee_id || String(row.payload.employeeId || ""),
    }) as Payslip),
    expenses: ((expensesResult.error ? [] : expensesResult.data || []) as RelatedPayloadRow[]).map((row) => ({
      ...row.payload,
      id: row.id,
      entityId: row.entity_id,
    }) as Expense),
    employeeLetters: ((lettersResult.error ? [] : lettersResult.data || []) as LetterPayloadRow[]).map((row) => ({ ...row.payload, id: row.id, entityId: row.entity_id, employeeId: row.employee_id, letterType: row.letter_type }) as EmployeeLetter),
  }
}

export async function saveWorkspaceSettings(userId: string, workspaceId: string, setup: Setup | null, template: TemplateSettings) {
  const db = client()
  const updated = await db.from("breezy_workspace_settings").update({ setup, template }).eq("workspace_id", workspaceId).select("workspace_id")
  throwIfError(updated.error)
  if (!updated.data?.length) {
    const { error } = await db.from("breezy_workspace_settings").insert({ user_id: userId, workspace_id: workspaceId, setup, template })
    throwIfError(error)
  }
}

export async function upsertCompanies(userId: string, workspaceId: string, companies: Company[]) {
  if (!companies.length) return
  const { error } = await client().from("breezy_entities").upsert(companies.map((company) => ({
    id: company.id,
    user_id: userId,
    workspace_id: workspaceId,
    payload: withoutKeys(company as unknown as Record<string, unknown>, ["id"]),
  })))
  throwIfError(error)
}

export async function deleteCompanyRow(workspaceId: string, companyId: string) {
  const { error } = await client().from("breezy_entities").delete().eq("workspace_id", workspaceId).eq("id", companyId)
  throwIfError(error)
}

export async function upsertCustomers(userId: string, workspaceId: string, customers: Customer[]) {
  if (!customers.length) return
  const { error } = await client().from("breezy_customers").upsert(customers.map((customer) => ({
    id: customer.id,
    user_id: userId,
    workspace_id: workspaceId,
    entity_id: customer.entityId,
    payload: withoutKeys(customer as unknown as Record<string, unknown>, ["id", "entityId"]),
  })))
  throwIfError(error)
}

export async function deleteCustomerRow(workspaceId: string, customerId: string) {
  const { error } = await client().from("breezy_customers").delete().eq("workspace_id", workspaceId).eq("id", customerId)
  throwIfError(error)
}

export async function upsertInvoices(userId: string, workspaceId: string, invoices: Invoice[]) {
  if (!invoices.length) return
  const { error } = await client().from("breezy_invoices").upsert(invoices.map((invoice) => ({
    id: invoice.id,
    user_id: userId,
    workspace_id: workspaceId,
    customer_id: invoice.customerId || null,
    payload: withoutKeys(invoice as unknown as Record<string, unknown>, ["id"]),
  })))
  throwIfError(error)
}

export async function deleteInvoiceRow(workspaceId: string, invoiceId: string) {
  const { error } = await client().from("breezy_invoices").delete().eq("workspace_id", workspaceId).eq("id", invoiceId)
  throwIfError(error)
}

export async function upsertProformas(userId: string, workspaceId: string, proformas: Proforma[]) {
  if (!proformas.length) return
  const { error } = await client().from("breezy_proformas").upsert(proformas.map((proforma) => ({
    id: proforma.id, user_id: userId, workspace_id: workspaceId, entity_id: proforma.entityId || null,
    customer_id: proforma.customerId || null,
    payload: withoutKeys(proforma as unknown as Record<string, unknown>, ["id", "entityId", "customerId"]),
  })))
  throwIfError(error)
}

export async function deleteProformaRow(workspaceId: string, proformaId: string) {
  const { error } = await client().from("breezy_proformas").delete().eq("workspace_id", workspaceId).eq("id", proformaId)
  throwIfError(error)
}

export async function upsertEmployees(userId: string, workspaceId: string, employees: Employee[]) {
  if (!employees.length) return
  const { error } = await client().from("breezy_employees").upsert(employees.map((employee) => ({
    id: employee.id,
    user_id: userId,
    workspace_id: workspaceId,
    entity_id: employee.entityId,
    payload: withoutKeys(employee as unknown as Record<string, unknown>, ["id", "entityId"]),
  })))
  throwIfError(error)
}

export async function deleteEmployeeRow(workspaceId: string, employeeId: string) {
  const { error } = await client().from("breezy_employees").delete().eq("workspace_id", workspaceId).eq("id", employeeId)
  throwIfError(error)
}

export async function upsertEmployeeLetters(userId: string, workspaceId: string, letters: EmployeeLetter[]) {
  if (!letters.length) return
  const { error } = await client().from("breezy_employee_letters").upsert(letters.map((letter) => ({
    id: letter.id, user_id: userId, workspace_id: workspaceId, entity_id: letter.entityId,
    employee_id: letter.employeeId, letter_type: letter.letterType,
    payload: withoutKeys(letter as unknown as Record<string, unknown>, ["id", "entityId", "employeeId", "letterType"]),
  })))
  throwIfError(error)
}

export async function deleteEmployeeLetterRow(workspaceId: string, letterId: string) {
  const { error } = await client().from("breezy_employee_letters").delete().eq("workspace_id", workspaceId).eq("id", letterId)
  throwIfError(error)
}

export async function upsertPayslips(userId: string, workspaceId: string, payslips: Payslip[]) {
  if (!payslips.length) return
  const { error } = await client().from("breezy_payslips").upsert(payslips.map((payslip) => ({
    id: payslip.id,
    user_id: userId,
    workspace_id: workspaceId,
    entity_id: payslip.entityId,
    employee_id: payslip.employeeId || null,
    payload: withoutKeys(payslip as unknown as Record<string, unknown>, ["id", "entityId", "employeeId"]),
  })))
  throwIfError(error)
}

export async function deletePayslipRow(workspaceId: string, payslipId: string) {
  const { error } = await client().from("breezy_payslips").delete().eq("workspace_id", workspaceId).eq("id", payslipId)
  throwIfError(error)
}

export async function upsertExpenses(userId: string, workspaceId: string, expenses: Expense[]) {
  if (!expenses.length) return
  const { error } = await client().from("breezy_expenses").upsert(expenses.map((expense) => ({
    id: expense.id,
    user_id: userId,
    workspace_id: workspaceId,
    entity_id: expense.entityId,
    payload: withoutKeys(expense as unknown as Record<string, unknown>, ["id", "entityId"]),
  })))
  throwIfError(error)
}

export async function deleteExpenseRow(workspaceId: string, expenseId: string) {
  const { error } = await client().from("breezy_expenses").delete().eq("workspace_id", workspaceId).eq("id", expenseId)
  throwIfError(error)
}

export async function saveFullWorkspace(userId: string, workspaceId: string, state: MvpState) {
  await saveWorkspaceSettings(userId, workspaceId, state.setup, state.template)
  await upsertCompanies(userId, workspaceId, state.companies)
  await Promise.all([
    upsertCustomers(userId, workspaceId, state.customers),
    upsertInvoices(userId, workspaceId, state.invoices),
    upsertProformas(userId, workspaceId, state.proformas),
    upsertEmployees(userId, workspaceId, state.employees),
    upsertEmployeeLetters(userId, workspaceId, state.employeeLetters),
  ])
  await upsertPayslips(userId, workspaceId, state.payslips)
  await upsertExpenses(userId, workspaceId, state.expenses)
}
