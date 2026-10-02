import type { Company, Payslip, TemplateSettings } from "@/lib/mvp-store"
import { amountInWords, attendancePresentDays, formatSalaryMonth, maskBankAccount } from "@/lib/payslip-calculations"

function money(value: number) {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function PayslipPreview({
  payslip,
  entity,
  template,
}: {
  payslip: Payslip
  entity?: Company
  template: TemplateSettings
}) {
  const fontClass = template.fontStyle === "serif" ? "font-serif" : template.fontStyle === "mono" ? "font-mono" : "font-sans"

  return (
    <article className={`${fontClass} mx-auto min-h-[760px] w-full max-w-[820px] border p-8 text-zinc-900 shadow-sm md:p-12`} style={{ backgroundColor: template.pageColor }}>
      <header className="flex items-start justify-between gap-6 border-b pb-8">
        <div className="flex min-w-0 items-start gap-4">
          {template.logoDataUrl ? (
            <img src={template.logoDataUrl} alt="Company logo" className="h-16 w-16 shrink-0 rounded-lg object-contain" />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg text-2xl font-bold text-white" style={{ backgroundColor: template.accentColor }}>
              {(entity?.companyName || payslip.entityName || "B").charAt(0)}
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold">{entity?.companyName || payslip.entityName || "Issuing entity"}</h2>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">{entity?.billingAddress || entity?.premisesAddress || "Address not provided"}</p>
            {entity?.gstin && <p className="mt-1 text-xs text-zinc-500">GSTIN: {entity.gstin}</p>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <h1 className="text-2xl font-bold" style={{ color: template.accentColor }}>SALARY PAYSLIP</h1>
          <p className="mt-2 text-sm font-semibold">Pay Period: {formatSalaryMonth(payslip.month)}</p>
          {payslip.paymentDate && <p className="mt-1 text-xs text-zinc-500">Payment date: {payslip.paymentDate}</p>}
        </div>
      </header>

      <section className="my-8 grid gap-5 rounded-xl bg-zinc-50 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Employee name</p><p className="mt-1 font-bold">{payslip.employeeName}</p><p className="text-xs text-zinc-500">ID: {payslip.employeeCode || "—"}</p></div>
        <div><p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Job designation</p><p className="mt-1 font-bold">{payslip.designation || "—"}</p><p className="text-xs text-zinc-500">{payslip.department || "Department not provided"}</p></div>
        <div><p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Tax & employment</p><p className="mt-1 font-bold">PAN: {payslip.pan || "—"}</p><p className="text-xs text-zinc-500">{payslip.employmentStatus || "Regular"}</p></div>
        <div><p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Disbursal bank</p><p className="mt-1 font-bold">{payslip.bankName || "—"}</p><p className="text-xs text-zinc-500">A/C: {maskBankAccount(payslip.bankAccount)}</p></div>
      </section>

      {payslip.attendance ? <section className="mb-8 rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-bold uppercase tracking-wider">Attendance</h3><p className="mt-1 text-xs text-zinc-500">Calendar and paid-day summary for this pay period</p></div>{payslip.attendance.holidays.length ? <p className="max-w-md text-right text-xs text-zinc-500">Holidays: {payslip.attendance.holidays.map((holiday) => holiday.name).join(", ")}</p> : null}</div>
        <div className="grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
          <AttendanceValue label="Calendar" value={payslip.attendance.calendarDays} />
          <AttendanceValue label="Working" value={payslip.workingDays} />
          <AttendanceValue label="Present days" value={attendancePresentDays(payslip.attendance)} />
          <AttendanceValue label="Leave taken" value={payslip.attendance.paidLeaveDays} />
          <AttendanceValue label="Loss of pay" value={payslip.attendance.lossOfPayDays ?? payslip.attendance.unpaidLeaveDays} />
          <AttendanceValue label="Payable" value={payslip.payableDays} accent={template.accentColor} />
        </div>
        {payslip.attendance.leaveAllowancePeriod ? <p className="mt-3 text-xs text-zinc-500"><span className="capitalize">{payslip.attendance.leaveAllowancePeriod}</span> leave allowance: {payslip.attendance.leaveAllowanceDays || 0} days · Eligible paid leave: {payslip.attendance.eligiblePaidLeaveDays || 0} · Excess leave: {payslip.attendance.excessLeaveDays || 0} · Attendance deduction: ₹{(payslip.attendance.leaveDeductionAmount || 0).toLocaleString("en-IN")}</p> : null}
      </section> : null}

      <section className="grid gap-8 lg:grid-cols-2">
        <PayrollTable title="Earnings & benefits" items={payslip.earnings} totalLabel="Total Earnings (A)" total={payslip.grossPay} accent={template.accentColor} />
        <PayrollTable title="Deductions & tax withholdings" items={payslip.deductions} totalLabel="Total Deductions (B)" total={payslip.totalDeductions} accent="#e11d48" deductions />
      </section>

      <section className="mt-10 flex flex-col justify-between gap-4 rounded-xl border-2 p-5 sm:flex-row sm:items-end" style={{ borderColor: template.accentColor }}>
        <div><p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Net take-home salary (A − B)</p><p className="mt-1 text-3xl font-bold" style={{ color: template.accentColor }}>{money(payslip.netPay)}</p></div>
        <div className="max-w-md text-left sm:text-right"><p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Net salary in words</p><p className="mt-1 text-sm font-semibold italic">{amountInWords(payslip.netPay)}</p></div>
      </section>

      <footer className="mt-12 flex flex-wrap justify-between gap-4 border-t pt-5 text-xs text-zinc-500">
        <span>Working days: {payslip.workingDays || "—"} · Payable days: {payslip.payableDays || "—"}{payslip.attendance ? ` · Weekly offs: ${payslip.attendance.weeklyOffDays} · Holidays: ${payslip.attendance.holidayDays}` : ""}</span>
        <span>This is a computer-generated payslip.</span>
      </footer>
    </article>
  )
}

function AttendanceValue({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return <div><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</p><p className="mt-1 font-bold" style={{ color: accent }}>{value}</p></div>
}

function PayrollTable({
  title,
  items,
  totalLabel,
  total,
  accent,
  deductions = false,
}: {
  title: string
  items: Payslip["earnings"]
  totalLabel: string
  total: number
  accent: string
  deductions?: boolean
}) {
  return (
    <div>
      <div className="flex items-center justify-between border-b pb-3">
        <h3 className="text-sm font-bold uppercase tracking-wider">{title}</h3>
        <span className="text-xs font-bold" style={{ color: accent }}>IN INR (₹)</span>
      </div>
      <div className="divide-y">
        {items.filter((item) => item.label || item.amount).map((item) => (
          <div key={item.id} className="flex justify-between gap-4 py-3 text-sm">
            <span className="text-zinc-600">{item.label || "Other"}</span>
            <span className="font-semibold" style={{ color: deductions ? accent : undefined }}>{deductions ? "−" : ""}{money(item.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between gap-4 py-4 text-sm font-bold">
          <span>{totalLabel}</span><span style={{ color: accent }}>{money(total)}</span>
        </div>
      </div>
    </div>
  )
}
