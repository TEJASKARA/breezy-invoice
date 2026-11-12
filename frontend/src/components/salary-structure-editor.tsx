import type { ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { SalaryLine, SalaryStructure, SalaryStructureSettings } from "@/lib/salary-structure"

const inr = (value: number) => `₹${value.toLocaleString("en-IN")}`
const numberValue = (value: string) => Math.max(0, Number(value) || 0)

/** Rules for splitting CTC into components; used for workspace defaults and per letter. */
export function SalaryStructureEditor({ idPrefix, value, onChange, disabled = false }: { idPrefix: string; value: SalaryStructureSettings; onChange: (next: SalaryStructureSettings) => void; disabled?: boolean }) {
  const set = <K extends keyof SalaryStructureSettings>(key: K, changes: Partial<SalaryStructureSettings[K]> | SalaryStructureSettings[K]) =>
    onChange({ ...value, [key]: typeof changes === "object" ? { ...(value[key] as object), ...changes } : changes })
  const toggle = (key: "conveyance" | "medical" | "statutoryBonus" | "pf" | "esic" | "professionalTax" | "tds" | "gratuity" | "groupInsurance", label: string, extra?: ReactNode) => (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3 text-sm">
      <label className="flex min-w-44 items-center gap-2 font-medium"><input type="checkbox" disabled={disabled} checked={value[key].enabled} onChange={(event) => set(key, { enabled: event.target.checked })} />{label}</label>
      {value[key].enabled ? extra : null}
    </div>
  )
  const amount = (id: string, current: number, onValue: (next: number) => void, suffix: string) => (
    <span className="inline-flex items-center gap-2"><Input id={id} aria-label={suffix} disabled={disabled} className="h-8 w-28" type="number" min="0" step="1" value={current} onChange={(event) => onValue(numberValue(event.target.value))} /><span className="text-xs text-muted-foreground">{suffix}</span></span>
  )
  return <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor={`${idPrefix}-basic`}>Basic (% of CTC)</Label><Input id={`${idPrefix}-basic`} disabled={disabled} type="number" min="0" max="100" step="1" value={value.basicPercentOfCtc} onChange={(event) => onChange({ ...value, basicPercentOfCtc: Math.min(100, numberValue(event.target.value)) })} /></div>
      <div className="space-y-1"><Label htmlFor={`${idPrefix}-hra`}>HRA (% of Basic)</Label><Input id={`${idPrefix}-hra`} disabled={disabled} type="number" min="0" max="100" step="1" value={value.hraPercentOfBasic} onChange={(event) => onChange({ ...value, hraPercentOfBasic: Math.min(100, numberValue(event.target.value)) })} /><p className="text-xs text-muted-foreground">Usually 40% (non-metro) or 50% (metro).</p></div>
    </div>
    <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Allowances</p>
    {toggle("conveyance", "Conveyance allowance", amount(`${idPrefix}-conveyance`, value.conveyance.monthly, (monthly) => set("conveyance", { monthly }), "₹ per month"))}
    {toggle("medical", "Medical allowance", amount(`${idPrefix}-medical`, value.medical.monthly, (monthly) => set("medical", { monthly }), "₹ per month"))}
    {toggle("statutoryBonus", "Statutory bonus", <>{amount(`${idPrefix}-bonus`, value.statutoryBonus.percent, (percent) => set("statutoryBonus", { percent }), "% of Basic (max ₹7,000), only if Basic ≤ ₹21,000")}</>)}
    <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Statutory and other deductions</p>
    {toggle("pf", "Provident Fund (12% + 13%)", <select aria-label="PF calculation" disabled={disabled} className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={value.pf.mode} onChange={(event) => set("pf", { mode: event.target.value as "capped" | "actual" })}><option value="capped">On Basic up to ₹15,000</option><option value="actual">On full Basic</option></select>)}
    {toggle("esic", "ESIC (0.75% + 3.25%)", <span className="text-xs text-muted-foreground">Applied automatically when gross is ₹21,000 or less.</span>)}
    {toggle("professionalTax", "Professional Tax", <span className="flex flex-wrap items-center gap-2">{amount(`${idPrefix}-pt-low`, value.professionalTax.lowerAmount, (lowerAmount) => set("professionalTax", { lowerAmount }), "₹ when gross is above")}{amount(`${idPrefix}-pt-low-limit`, value.professionalTax.lowerLimit, (lowerLimit) => set("professionalTax", { lowerLimit }), "and")}{amount(`${idPrefix}-pt-high`, value.professionalTax.upperAmount, (upperAmount) => set("professionalTax", { upperAmount }), "₹ above")}{amount(`${idPrefix}-pt-high-limit`, value.professionalTax.upperLimit, (upperLimit) => set("professionalTax", { upperLimit }), "(default: Telangana)")}</span>)}
    {toggle("tds", "Income Tax (TDS)", amount(`${idPrefix}-tds`, value.tds.monthly, (monthly) => set("tds", { monthly }), "₹ per month"))}
    <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Employer costs (part of CTC)</p>
    {toggle("gratuity", "Gratuity (4.81% of Basic)")}
    {toggle("groupInsurance", "Group health insurance", amount(`${idPrefix}-insurance`, value.groupInsurance.monthly, (monthly) => set("groupInsurance", { monthly }), "₹ per month"))}
  </div>
}

function Section({ title, lines }: { title: string; lines: SalaryLine[] }) {
  if (!lines.length) return null
  return <>
    <TableRow className="bg-muted/40"><TableCell colSpan={3} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</TableCell></TableRow>
    {lines.map((item) => <TableRow key={item.key}><TableCell>{item.label}</TableCell><TableCell className="text-right tabular-nums">{inr(item.monthly)}</TableCell><TableCell className="text-right tabular-nums">{inr(item.annual)}</TableCell></TableRow>)}
  </>
}

function Total({ label, monthly, strong = false }: { label: string; monthly: number; strong?: boolean }) {
  return <TableRow className={strong ? "font-semibold" : "font-medium"}><TableCell>{label}</TableCell><TableCell className="text-right tabular-nums">{inr(monthly)}</TableCell><TableCell className="text-right tabular-nums">{inr(monthly * 12)}</TableCell></TableRow>
}

export function SalaryBreakdownTable({ structure }: { structure: SalaryStructure }) {
  return <div className="space-y-2">
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader><TableRow><TableHead>Component</TableHead><TableHead className="text-right">Monthly</TableHead><TableHead className="text-right">Annual</TableHead></TableRow></TableHeader>
        <TableBody>
          <Section title="Earnings" lines={structure.earnings} />
          <Total label="Gross salary" monthly={structure.grossMonthly} />
          <Section title="Employee deductions" lines={structure.employeeDeductions} />
          <Total label="Net take-home" monthly={structure.netMonthly} strong />
          <Section title="Employer contributions" lines={structure.employerContributions} />
          <Total label="Total cost to company (CTC)" monthly={structure.monthlyCtc} strong />
        </TableBody>
      </Table>
    </div>
    {structure.warnings.map((warning) => <p key={warning} className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{warning}</p>)}
  </div>
}
