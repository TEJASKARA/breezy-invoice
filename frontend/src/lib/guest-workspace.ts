import type { MvpState } from "./mvp-store.tsx"

/**
 * A visitor's free-tools data moved into their new workspace: company,
 * customers, employees, letters, branding and attendance. Invoices,
 * quotations and payslips made as a guest are not copied, because saving
 * them would use the new account's credits.
 */
export function mergeGuestWorkspace(workspace: MvpState, guestData: MvpState): MvpState {
  const setup = workspace.setup
    ? { ...workspace.setup, attendanceDrafts: { ...(guestData.setup?.attendanceDrafts || {}), ...(workspace.setup.attendanceDrafts || {}) }, salaryStructure: workspace.setup.salaryStructure || guestData.setup?.salaryStructure, leavePolicy: workspace.setup.leavePolicy || guestData.setup?.leavePolicy }
    : guestData.setup
  return {
    ...workspace,
    setup,
    companies: guestData.companies,
    customers: guestData.customers,
    employees: guestData.employees,
    employeeLetters: guestData.employeeLetters,
    template: guestData.template,
  }
}
