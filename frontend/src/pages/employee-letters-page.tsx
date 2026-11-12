import { useEntitySelection } from "@/lib/entity-selection"
import { customerErrorMessage } from "@/lib/customer-errors"
import { useEffect, useMemo, useState } from "react"
import { Download, Mail, MessageCircle, Plus, Trash2 } from "lucide-react"

import { DocumentShareDialog } from "@/components/document-share-dialog"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { createEmployeeLetterPdf, employeeLetterFileName } from "@/lib/employee-letter-pdf"
import { sendDocumentWhatsApp, sendEmployeeLetterEmail } from "@/lib/document-email-api"
import { useMvpStore, type Employee, type EmployeeLetter, type LetterSalary } from "@/lib/mvp-store"
import { SalaryBreakdownTable, SalaryStructureEditor } from "@/components/salary-structure-editor"
import { letterSalaryDisplayOptions, letterSalaryParagraph } from "@/lib/letter-salary"
import { defaultDeductions, defaultEarnings, payrollId, sumPayrollComponents } from "@/lib/payslip-calculations"
import { calculateSalaryStructure, normalizeSalarySettings, salaryStructureToPayroll, type SalaryStructureSettings } from "@/lib/salary-structure"
import { sharePdfViaWhatsApp } from "@/lib/whatsapp-share"
import { useWorkspaceAccess } from "@/lib/workspace-access"
import { canRemoveChanaxBranding } from "@/lib/subscription-entitlements"
import { trackAction } from "@/lib/usage-tracking"

const today = () => new Date().toISOString().slice(0, 10)
const NEW_PERSON = "__new_person__"
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
const letterDetails: Record<EmployeeLetter["letterType"], { subject: string; title: string; label: string }> = {
  offer: { subject: "Employment offer", title: "OFFER LETTER", label: "Offer" },
  internship_offer: { subject: "Internship offer", title: "INTERNSHIP OFFER LETTER", label: "Internship offer" },
  experience: { subject: "Relieving and experience letter", title: "RELIEVING & EXPERIENCE LETTER", label: "Relieving & experience" },
  termination: { subject: "Termination of employment", title: "TERMINATION LETTER", label: "Termination" },
}

function templateBody(type: EmployeeLetter["letterType"], name: string, effectiveDate: string) {
  if (type === "offer") return `Dear ${name},\n\nWe are pleased to offer you employment with our organisation. Your appointment will be effective from ${effectiveDate}. Your role, compensation, benefits and other employment conditions will be governed by the terms agreed with the company.\n\nPlease confirm your acceptance of this offer. We look forward to welcoming you to the team.`
  if (type === "internship_offer") return `Dear ${name},\n\nWe are pleased to offer you an internship with our organisation, effective from ${effectiveDate}. Your internship role, duration, stipend, reporting arrangements and other conditions will be governed by the terms agreed with the company.\n\nPlease confirm your acceptance of this internship offer. We look forward to having you learn and contribute with our team.`
  if (type === "experience") return `To whom it may concern,\n\nThis is to certify that ${name} was employed with our organisation and has been relieved of their duties with effect from ${effectiveDate}, after completing the handover and clearance formalities.\n\nDuring their employment, their conduct and performance were satisfactory. We thank ${name} for their contribution and wish them every success in the future.`
  return `Dear ${name},\n\nThis letter confirms that your employment with the organisation will end effective ${effectiveDate}. Please complete the applicable handover and clearance formalities on or before your final working day.\n\nAny final settlement and employment documents will be processed in accordance with company policy and applicable law.`
}

export function EmployeeLettersPage() {
  const { selectedEntityId } = useEntitySelection()
  const { setup, companies, employees, employeeLetters, templateFor, addEmployee, updateEmployee, addEmployeeLetter, deleteEmployeeLetter } = useMvpStore()
  const { can, workspace, subscription } = useWorkspaceAccess()
  const canManage = can("payslips.manage")
  const brandingCanBeRemoved = canRemoveChanaxBranding(subscription)
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.entityId === selectedEntityId && !companies.find((company) => company.id === employee.entityId)?.transferredAt), [employees, companies, selectedEntityId])
  const visibleLetters = employeeLetters.filter((letter) => letter.entityId === selectedEntityId)
  const [letterType, setLetterType] = useState<EmployeeLetter["letterType"]>("offer")
  const [employeeId, setEmployeeId] = useState(activeEmployees[0]?.id || NEW_PERSON)
  const isNewPerson = employeeId === NEW_PERSON
  const employee = isNewPerson ? undefined : employees.find((item) => item.id === employeeId)
  const entity = companies.find((item) => item.id === (employee?.entityId || selectedEntityId))
  const [newPerson, setNewPerson] = useState({ employeeName: "", employeeCode: "", email: "", designation: "", department: "" })
  const recipientName = isNewPerson ? newPerson.employeeName.trim() || "Employee" : employee?.employeeName || "Employee"
  const [salaryDisplay, setSalaryDisplay] = useState<LetterSalary["display"]>("breakdown")
  const [annualCtc, setAnnualCtc] = useState("")
  const [monthlyStipend, setMonthlyStipend] = useState("")
  const [salarySettings, setSalarySettings] = useState<SalaryStructureSettings>(() => normalizeSalarySettings(setup?.salaryStructure))
  const [applyToPayroll, setApplyToPayroll] = useState(true)
  const resetSalary = (type: EmployeeLetter["letterType"], person?: Employee) => {
    setSalaryDisplay(type === "offer" ? "breakdown" : type === "internship_offer" ? "line" : "none")
    const currentGross = person ? sumPayrollComponents(person.defaultEarnings) : 0
    setAnnualCtc(person?.annualCtc ? String(person.annualCtc) : type === "offer" || !currentGross ? "" : String(currentGross * 12))
    setMonthlyStipend(person && type === "internship_offer" && currentGross ? String(currentGross) : "")
    setSalarySettings(normalizeSalarySettings(person?.salaryStructure || setup?.salaryStructure))
    setApplyToPayroll(true)
  }
  const ctcValue = Math.max(0, Math.round(Number(annualCtc) || 0))
  const stipendValue = Math.max(0, Math.round(Number(monthlyStipend) || 0))
  const salaryStructure = useMemo(() => calculateSalaryStructure(ctcValue, salarySettings), [ctcValue, salarySettings])
  const letterSalary: LetterSalary | undefined = salaryDisplay === "none" ? undefined
    : letterType === "internship_offer" ? { display: "line", monthlyStipend: stipendValue }
    : { display: salaryDisplay, annualCtc: ctcValue, settings: salarySettings }
  const salaryPreview = letterSalaryParagraph(letterType, letterSalary)
  const canApplyToPayroll = (letterType === "offer" && ctcValue > 0) || (letterType === "internship_offer" && stipendValue > 0)
  const payrollChanges = (): Partial<Omit<Employee, "id">> => letterType === "internship_offer"
    ? { defaultEarnings: [{ id: payrollId(), label: "Stipend", amount: stipendValue }], defaultDeductions: [], annualCtc: stipendValue * 12 }
    : { ...salaryStructureToPayroll(salaryStructure, payrollId), annualCtc: ctcValue, salaryStructure: salarySettings }
  const [issueDate, setIssueDate] = useState(today())
  const [effectiveDate, setEffectiveDate] = useState(today())
  const [subject, setSubject] = useState("Employment offer")
  const [body, setBody] = useState(templateBody("offer", employee?.employeeName || "Employee", today()))
  const [signatureName, setSignatureName] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [emailingLetterId, setEmailingLetterId] = useState<string | null>(null)
  const [shareLetterTarget, setShareLetterTarget] = useState<EmployeeLetter | null>(null)

  useEffect(() => {
    if (employeeId === NEW_PERSON || activeEmployees.some((employee) => employee.id === employeeId)) return
    if (!activeEmployees.length) { setEmployeeId(NEW_PERSON); return }
    const firstEmployee = activeEmployees[0]
    setEmployeeId(firstEmployee.id)
    setBody(templateBody(letterType, firstEmployee.employeeName, effectiveDate))
  }, [employeeId, activeEmployees, letterType, effectiveDate])

  const selectEmployee = (id: string) => { setEmployeeId(id); const selected = employees.find((item) => item.id === id); setBody(templateBody(letterType, id === NEW_PERSON ? newPerson.employeeName.trim() || "Employee" : selected?.employeeName || "Employee", effectiveDate)); resetSalary(letterType, selected) }
  const selectType = (type: EmployeeLetter["letterType"]) => { setLetterType(type); setSubject(letterDetails[type].subject); setBody(templateBody(type, recipientName, effectiveDate)); resetSalary(type, employee) }

  async function save() {
    setError(""); setNotice("")
    if (!canManage) return setError("You do not have permission to issue employee letters.")
    if (!entity || entity.transferredAt) return setError("Select an active issuing entity from the navbar.")
    if (!isNewPerson && !employee) return setError("Select an employee or add a new person.")
    const newName = newPerson.employeeName.trim()
    const newCode = newPerson.employeeCode.trim().toUpperCase()
    if (isNewPerson && (!newName || !newCode)) return setError("Enter the new person's name and employee code.")
    if (isNewPerson && employees.some((item) => item.entityId === entity.id && item.employeeCode.toUpperCase() === newCode)) return setError("This employee code already exists for this entity.")
    if (isNewPerson && newPerson.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newPerson.email.trim())) return setError("Enter a valid email address or leave it blank.")
    if (!subject.trim() || body.trim().length < 20) return setError("Add a subject and complete letter content.")
    if (salaryDisplay !== "none" && !letterSalaryParagraph(letterType, letterSalary)) return setError(letterType === "internship_offer" ? "Enter the monthly stipend, or choose not to mention it." : "Enter the annual CTC, or choose not to mention salary.")
    const updatePayroll = applyToPayroll && canApplyToPayroll
    try {
      let targetId = employee?.id || ""
      if (isNewPerson) {
        targetId = await addEmployee({
          entityId: entity.id, employeeCode: newCode, employeeName: newName, email: newPerson.email.trim().toLowerCase(), designation: newPerson.designation.trim(), department: newPerson.department.trim(),
          pan: "", uan: "", esiNumber: "", bankName: "", bankAccount: "", ifsc: "",
          employmentStatus: letterType === "internship_offer" ? "Intern" : "Regular Full-time", joiningDate: letterType === "offer" || letterType === "internship_offer" ? effectiveDate : "",
          defaultEarnings: defaultEarnings(), defaultDeductions: defaultDeductions(), overtimeMode: "hourly", overtimeRate: 0,
          ...(updatePayroll ? payrollChanges() : {}),
        })
      } else if (updatePayroll) await updateEmployee(targetId, payrollChanges())
      await addEmployeeLetter({ entityId: entity.id, employeeId: targetId, letterType, title: letterDetails[letterType].title, issueDate, effectiveDate, subject: subject.trim(), body: body.trim(), status: "Issued", signatureName: signatureName.trim(), issuedAt: new Date().toISOString(), ...(letterSalary ? { salary: letterSalary } : {}) })
      if (isNewPerson) { setEmployeeId(targetId); setNewPerson({ employeeName: "", employeeCode: "", email: "", designation: "", department: "" }) }
      setNotice(`${letterDetails[letterType].label} letter saved under ${isNewPerson ? newName : employee?.employeeName}.${isNewPerson ? " They were added to Employees." : ""}${updatePayroll ? " Their payslip salary now uses this structure." : ""}`)
    } catch (saveError) { setError(customerErrorMessage(saveError, "The letter could not be saved.")) }
  }

  async function documentFor(letter: EmployeeLetter) {
    const targetEmployee = employees.find((item) => item.id === letter.employeeId)
    if (!targetEmployee) throw new Error("The linked employee could not be found.")
    return { doc: await createEmployeeLetterPdf({ letter, employee: targetEmployee, entity: companies.find((item) => item.id === letter.entityId), template: templateFor(letter.entityId), canRemoveBranding: brandingCanBeRemoved }), employee: targetEmployee }
  }
  async function download(letter: EmployeeLetter) { const { doc, employee: target } = await documentFor(letter); doc.save(employeeLetterFileName(letter, target)); trackAction("employee_letter_pdf_downloaded", { letter_type: letter.letterType }) }
  async function share(letter: EmployeeLetter) { const target = employees.find((item) => item.id === letter.employeeId); if (!target) return; await sharePdfViaWhatsApp({ title: letter.title, message: `${letter.title} for ${target.employeeName}.`, createFile: async () => { const { doc } = await documentFor(letter); return { name: employeeLetterFileName(letter, target), data: new Uint8Array(doc.output("arraybuffer")) } } }) }
  async function sendOnWhatsApp(letter: EmployeeLetter, toNumber: string) {
    setError(""); setNotice("")
    if (!workspace?.id) throw new Error("Your workspace is still loading. Please try again.")
    const targetEntity = companies.find((item) => item.id === letter.entityId)
    try {
      const { doc, employee: target } = await documentFor(letter)
      const result = await sendDocumentWhatsApp({
        workspaceId: workspace.id,
        documentId: letter.id,
        toNumber,
        documentType: "employee_letter",
        documentNumber: `${letter.title}-${letter.issueDate}`,
        message: `${letter.title} for ${target.employeeName} from ${targetEntity?.companyName || "ChanaX"}.`,
        filename: employeeLetterFileName(letter, target),
        pdf: new Uint8Array(doc.output("arraybuffer")),
      })
      setNotice(result)
    } catch (caught) {
      const message = customerErrorMessage(caught, "The employee letter could not be sent on WhatsApp.")
      setError(message)
      throw new Error(message)
    }
  }
  async function email(letter: EmployeeLetter) {
    setError(""); setNotice("")
    const target = employees.find((item) => item.id === letter.employeeId)
    const targetEntity = companies.find((item) => item.id === letter.entityId)
    if (!target?.email) return setError(`Add an email address to ${target?.employeeName || "this employee"}'s profile before sending the email.`)
    if (!workspace?.id) return setError("Your workspace is still loading. Please try again.")
    setEmailingLetterId(letter.id)
    try {
      const { doc } = await documentFor(letter)
      const fileName = employeeLetterFileName(letter, target)
      const result = await sendEmployeeLetterEmail({
        workspaceId: workspace.id,
        letterId: letter.id,
        toEmail: target.email,
        employeeName: target.employeeName,
        subject: `${letter.title} - ${target.employeeName}`,
        message: `Hello ${target.employeeName},\n\nPlease find your employment letter attached.\n\nRegards,\n${targetEntity?.companyName || "ChanaX"}`,
        filename: fileName,
        pdf: new Uint8Array(doc.output("arraybuffer")),
      })
      setNotice(result)
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return
      setError(customerErrorMessage(caught, "The employee letter email could not be prepared."))
    } finally { setEmailingLetterId(null) }
  }

  return <div className="space-y-7">
    <PageHeader eyebrow="Employee documents" title="Employment letters" description="Create offer, internship offer, relieving & experience and termination letters with your saved company branding and signature." />
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{notice}</p> : null}
    <Card><CardHeader><CardTitle>Create employee letter</CardTitle><CardDescription>Start with the standard wording, then edit every line for the employee.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4"><div className="space-y-2"><Label htmlFor="letter-employee">Employee</Label><select id="letter-employee" className={selectClass} value={employeeId} onChange={(event) => selectEmployee(event.target.value)}>{activeEmployees.map((item) => <option key={item.id} value={item.id}>{item.employeeName} · {item.employeeCode}</option>)}<option value={NEW_PERSON}>+ New person (add as employee)</option></select></div><div className="space-y-2"><Label htmlFor="letter-type">Letter type</Label><select id="letter-type" className={selectClass} value={letterType} onChange={(event) => selectType(event.target.value as EmployeeLetter["letterType"])}><option value="offer">Offer letter</option><option value="internship_offer">Internship offer letter</option><option value="experience">Relieving & experience letter</option><option value="termination">Termination letter</option></select></div><div className="space-y-2"><Label htmlFor="letter-issue-date">Issue date</Label><Input id="letter-issue-date" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="letter-effective-date">Effective date</Label><Input id="letter-effective-date" type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></div></div>
      {isNewPerson ? <div className="space-y-3 rounded-xl border bg-muted/20 p-4"><p className="text-sm font-medium">New person: they are added to Employees when the letter is saved</p><div className="grid gap-4 md:grid-cols-5">
        <div className="space-y-2"><Label htmlFor="new-person-name">Name *</Label><Input id="new-person-name" value={newPerson.employeeName} onChange={(event) => { const employeeName = event.target.value; setNewPerson({ ...newPerson, employeeName }); setBody(templateBody(letterType, employeeName.trim() || "Employee", effectiveDate)) }} placeholder="Rahul Sharma" /></div>
        <div className="space-y-2"><Label htmlFor="new-person-code">Employee code *</Label><Input id="new-person-code" value={newPerson.employeeCode} onChange={(event) => setNewPerson({ ...newPerson, employeeCode: event.target.value })} placeholder="EMP-010" /></div>
        <div className="space-y-2"><Label htmlFor="new-person-email">Email</Label><Input id="new-person-email" type="email" value={newPerson.email} onChange={(event) => setNewPerson({ ...newPerson, email: event.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="new-person-designation">Designation</Label><Input id="new-person-designation" value={newPerson.designation} onChange={(event) => setNewPerson({ ...newPerson, designation: event.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="new-person-department">Department</Label><Input id="new-person-department" value={newPerson.department} onChange={(event) => setNewPerson({ ...newPerson, department: event.target.value })} /></div>
      </div></div> : null}
      <section className="space-y-4 rounded-xl border p-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2"><Label htmlFor="letter-salary-display">{letterType === "internship_offer" ? "Stipend in letter" : "Salary in letter"}</Label><select id="letter-salary-display" className={selectClass} value={salaryDisplay} onChange={(event) => setSalaryDisplay(event.target.value as LetterSalary["display"])}>{letterSalaryDisplayOptions(letterType).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
          {letterType === "internship_offer"
            ? <div className="space-y-2"><Label htmlFor="letter-stipend">Monthly stipend (₹)</Label><Input id="letter-stipend" type="number" min="0" step="1" value={monthlyStipend} onChange={(event) => setMonthlyStipend(event.target.value)} placeholder="15000" /></div>
            : <div className="space-y-2"><Label htmlFor="letter-ctc">{letterType === "offer" ? "Annual CTC (₹)" : "Last drawn annual CTC (₹)"}</Label><Input id="letter-ctc" type="number" min="0" step="1000" value={annualCtc} onChange={(event) => setAnnualCtc(event.target.value)} placeholder="600000" />{salaryStructure.netMonthly > 0 ? <p className="text-xs text-muted-foreground">Gross ₹{salaryStructure.grossMonthly.toLocaleString("en-IN")} · take-home ₹{salaryStructure.netMonthly.toLocaleString("en-IN")} a month</p> : null}</div>}
          {canApplyToPayroll ? <label className="flex items-start gap-2 self-end pb-2 text-sm"><input type="checkbox" className="mt-0.5" checked={applyToPayroll} onChange={(event) => setApplyToPayroll(event.target.checked)} /><span>Use this {letterType === "internship_offer" ? "stipend" : "salary"} for {recipientName}’s payslips</span></label> : null}
        </div>
        {salaryPreview ? <p className="rounded-lg bg-muted/40 p-3 text-sm"><span className="font-medium">Added to the letter: </span>{salaryPreview}</p> : null}
        {letterType !== "internship_offer" && ctcValue > 0 && (salaryDisplay === "breakdown" || (letterType === "offer" && applyToPayroll)) ? <SalaryBreakdownTable structure={salaryStructure} /> : null}
        {letterType !== "internship_offer" && (salaryDisplay !== "none" || (letterType === "offer" && applyToPayroll)) ? <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Salary rules for this letter</summary><p className="mt-2 text-xs text-muted-foreground">Starts from the workspace defaults (Workspace settings). Changes here apply only to this letter{letterType === "offer" ? " and, if selected, this person’s payslips" : ""}.</p><div className="mt-3"><SalaryStructureEditor idPrefix="letter-salary" value={salarySettings} onChange={setSalarySettings} /></div></details> : null}
      </section>
      <div className="space-y-2"><Label htmlFor="letter-subject">Subject</Label><Input id="letter-subject" value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="letter-body">Letter content</Label><textarea id="letter-body" className="min-h-72 w-full rounded-md border border-input bg-background p-3 text-sm leading-6" value={body} onChange={(event) => setBody(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="letter-signatory">Signatory name (optional)</Label><Input id="letter-signatory" value={signatureName} onChange={(event) => setSignatureName(event.target.value)} placeholder={`For ${entity?.companyName || "company"}`} /></div>
      <div className="flex justify-end"><Button disabled={!canManage || (!employee && !isNewPerson)} onClick={() => void save()}><Plus />Save issued letter</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Employee letter history</CardTitle><CardDescription>All saved letters remain visible here and can be downloaded, shared or emailed again.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Letter</TableHead><TableHead>Employee</TableHead><TableHead>Issue date</TableHead><TableHead>Effective date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{visibleLetters.length ? visibleLetters.map((letter) => { const target = employees.find((item) => item.id === letter.employeeId); return <TableRow key={letter.id}><TableCell><p className="font-medium">{letter.title}</p><p className="text-xs text-muted-foreground">{letter.subject}</p></TableCell><TableCell>{target?.employeeName || "Employee unavailable"}</TableCell><TableCell>{letter.issueDate}</TableCell><TableCell>{letter.effectiveDate}</TableCell><TableCell><Badge variant="outline">{letter.status}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Download PDF" aria-label="Download employee letter" onClick={() => void download(letter)}><Download /></Button><Button size="icon" variant="ghost" title="Share via WhatsApp" aria-label="Share employee letter via WhatsApp" onClick={() => setShareLetterTarget(letter)}><MessageCircle /></Button><Button size="icon" variant="ghost" title="Email PDF" aria-label="Email employee letter PDF" disabled={emailingLetterId !== null} onClick={() => void email(letter)}><Mail />{emailingLetterId === letter.id ? <span className="sr-only">Sending</span> : null}</Button><Button size="icon" variant="ghost" title="Delete letter" aria-label="Delete employee letter" disabled={!canManage || Boolean(companies.find((company) => company.id === letter.entityId)?.transferredAt)} onClick={() => void deleteEmployeeLetter(letter.id)}><Trash2 /></Button></div></TableCell></TableRow> }) : <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No employee letters have been saved yet.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    <DocumentShareDialog
      open={Boolean(shareLetterTarget)}
      title={shareLetterTarget ? shareLetterTarget.title.toLowerCase() : "employee letter"}
      onClose={() => setShareLetterTarget(null)}
      onWhatsApp={async () => {
        if (!shareLetterTarget) return
        await share(shareLetterTarget)
        setShareLetterTarget(null)
      }}
      onWhatsAppSend={async (number) => {
        if (!shareLetterTarget) return
        await sendOnWhatsApp(shareLetterTarget, number)
        setShareLetterTarget(null)
      }}
    />
  </div>
}
