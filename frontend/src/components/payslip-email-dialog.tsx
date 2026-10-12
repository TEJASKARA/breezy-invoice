import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, LoaderCircle, Mail, TriangleAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { customerErrorMessage } from "@/lib/customer-errors"
import type { Employee, Payslip } from "@/lib/mvp-store"
import { formatSalaryMonth } from "@/lib/payslip-calculations"

export const MAX_PAYSLIPS_PER_EMAIL = 24

type GroupStatus = { state: "idle" | "sending" | "sent" | "failed"; message?: string }
export type PayslipEmailGroup = { employeeId: string; employeeName: string; email: string; payslips: Payslip[] }

export function PayslipEmailDialog({
  open,
  payslips,
  employees,
  onClose,
  onSend,
  onFinished,
}: {
  open: boolean
  payslips: Payslip[]
  employees: Employee[]
  onClose: () => void
  /** Sends one email to one employee carrying all of their payslips. Resolves with a confirmation message. */
  onSend: (group: PayslipEmailGroup) => Promise<string>
  /** Called after a send run with the payslip IDs that were emailed. */
  onFinished?: (sentPayslipIds: string[]) => void
}) {
  const groups = useMemo(() => {
    const byEmployee = new Map<string, PayslipEmailGroup>()
    for (const payslip of [...payslips].sort((a, b) => a.month.localeCompare(b.month))) {
      const employee = employees.find((item) => item.id === payslip.employeeId)
      const group = byEmployee.get(payslip.employeeId) || {
        employeeId: payslip.employeeId,
        employeeName: employee?.employeeName || payslip.employeeName,
        email: employee?.email?.trim().toLowerCase() || "",
        payslips: [],
      }
      group.payslips.push(payslip)
      byEmployee.set(payslip.employeeId, group)
    }
    return [...byEmployee.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName))
  }, [payslips, employees])
  const [statuses, setStatuses] = useState<Record<string, GroupStatus>>({})
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!open) return
    setStatuses({})
    setRunning(false)
  }, [open])

  if (!open) return null

  const sendable = groups.filter((group) => group.email && group.payslips.length <= MAX_PAYSLIPS_PER_EMAIL && statuses[group.employeeId]?.state !== "sent")
  const missingEmail = groups.filter((group) => !group.email)
  const allDone = groups.length > 0 && sendable.length === 0 && Object.values(statuses).some((status) => status.state === "sent")

  const sendAll = async () => {
    setRunning(true)
    const sentIds: string[] = []
    for (const group of sendable) {
      setStatuses((current) => ({ ...current, [group.employeeId]: { state: "sending" } }))
      try {
        const message = await onSend(group)
        sentIds.push(...group.payslips.map((payslip) => payslip.id))
        setStatuses((current) => ({ ...current, [group.employeeId]: { state: "sent", message } }))
      } catch (error) {
        setStatuses((current) => ({ ...current, [group.employeeId]: { state: "failed", message: customerErrorMessage(error, "The email could not be sent.") } }))
      }
    }
    setRunning(false)
    onFinished?.(sentIds)
  }

  const payslipCount = groups.reduce((total, group) => total + group.payslips.length, 0)

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="payslip-email-title">
    <Card className="flex max-h-[90vh] w-full max-w-lg flex-col shadow-2xl">
      <CardHeader className="relative pr-14">
        <CardTitle id="payslip-email-title">Email {payslipCount === 1 ? "payslip" : `${payslipCount} payslips`}</CardTitle>
        <CardDescription>Each employee receives one email with all of their selected payslips attached, sent to the email saved on their employee record.</CardDescription>
        <Button className="absolute right-4 top-4" size="icon" variant="ghost" aria-label="Close" disabled={running} onClick={onClose}><X /></Button>
      </CardHeader>
      <CardContent className="space-y-4 overflow-y-auto">
        <ul className="divide-y rounded-lg border">
          {groups.map((group) => {
            const status = statuses[group.employeeId]
            const tooMany = group.payslips.length > MAX_PAYSLIPS_PER_EMAIL
            return <li key={group.employeeId} className="flex items-start gap-3 p-3 text-sm">
              <span className="mt-0.5 shrink-0">
                {status?.state === "sending" ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  : status?.state === "sent" ? <CheckCircle2 className="size-4 text-emerald-600" />
                  : status?.state === "failed" || !group.email || tooMany ? <TriangleAlert className="size-4 text-amber-600" />
                  : <Mail className="size-4 text-muted-foreground" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{group.employeeName}</span>
                <span className="block truncate text-xs text-muted-foreground">{group.email || "No email saved"} · {group.payslips.map((payslip) => formatSalaryMonth(payslip.month)).join(", ")}</span>
                {!group.email ? <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">Add an email address to this employee (Edit employee) to send their payslips.</span> : null}
                {tooMany ? <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">Select up to {MAX_PAYSLIPS_PER_EMAIL} payslips per employee in one email.</span> : null}
                {status?.message ? <span className={`mt-1 block text-xs ${status.state === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{status.message}</span> : null}
              </span>
            </li>
          })}
        </ul>
        {missingEmail.length ? <p className="text-xs text-muted-foreground">{missingEmail.length} employee{missingEmail.length === 1 ? " has" : "s have"} no email saved and will be skipped.</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={running} onClick={onClose}>{allDone ? "Done" : "Cancel"}</Button>
          {!allDone ? <Button disabled={running || sendable.length === 0} onClick={() => void sendAll()}>
            {running ? <LoaderCircle className="animate-spin" /> : <Mail />}
            {running ? "Sending…" : sendable.length === 1 ? `Send email to ${sendable[0].employeeName}` : `Send ${sendable.length} emails`}
          </Button> : null}
        </div>
      </CardContent>
    </Card>
  </div>
}
