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
import { useMvpStore, type EmployeeLetter } from "@/lib/mvp-store"
import { sharePdfViaWhatsApp } from "@/lib/whatsapp-share"
import { useWorkspaceAccess } from "@/lib/workspace-access"
import { canRemoveChanaxBranding } from "@/lib/subscription-entitlements"
import { trackAction } from "@/lib/usage-tracking"

const today = () => new Date().toISOString().slice(0, 10)
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
const letterDetails: Record<EmployeeLetter["letterType"], { subject: string; title: string; label: string }> = {
  offer: { subject: "Employment offer", title: "OFFER LETTER", label: "Offer" },
  internship_offer: { subject: "Internship offer", title: "INTERNSHIP OFFER LETTER", label: "Internship offer" },
  termination: { subject: "Termination of employment", title: "TERMINATION LETTER", label: "Termination" },
}

function templateBody(type: EmployeeLetter["letterType"], name: string, effectiveDate: string) {
  if (type === "offer") return `Dear ${name},\n\nWe are pleased to offer you employment with our organisation. Your appointment will be effective from ${effectiveDate}. Your role, compensation, benefits and other employment conditions will be governed by the terms agreed with the company.\n\nPlease confirm your acceptance of this offer. We look forward to welcoming you to the team.`
  if (type === "internship_offer") return `Dear ${name},\n\nWe are pleased to offer you an internship with our organisation, effective from ${effectiveDate}. Your internship role, duration, stipend, reporting arrangements and other conditions will be governed by the terms agreed with the company.\n\nPlease confirm your acceptance of this internship offer. We look forward to having you learn and contribute with our team.`
  return `Dear ${name},\n\nThis letter confirms that your employment with the organisation will end effective ${effectiveDate}. Please complete the applicable handover and clearance formalities on or before your final working day.\n\nAny final settlement and employment documents will be processed in accordance with company policy and applicable law.`
}

export function EmployeeLettersPage() {
  const { companies, employees, employeeLetters, templateFor, addEmployeeLetter, deleteEmployeeLetter } = useMvpStore()
  const { can, workspace, subscription } = useWorkspaceAccess()
  const canManage = can("payslips.manage")
  const brandingCanBeRemoved = canRemoveChanaxBranding(subscription)
  const activeEmployees = useMemo(() => employees.filter((employee) => !companies.find((company) => company.id === employee.entityId)?.transferredAt), [employees, companies])
  const [employeeId, setEmployeeId] = useState(activeEmployees[0]?.id || "")
  const employee = employees.find((item) => item.id === employeeId)
  const entity = companies.find((item) => item.id === employee?.entityId)
  const [letterType, setLetterType] = useState<EmployeeLetter["letterType"]>("offer")
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
    if (activeEmployees.some((employee) => employee.id === employeeId) || !activeEmployees.length) return
    const firstEmployee = activeEmployees[0]
    setEmployeeId(firstEmployee.id)
    setBody(templateBody(letterType, firstEmployee.employeeName, effectiveDate))
  }, [employeeId, activeEmployees, letterType, effectiveDate])

  const selectEmployee = (id: string) => { setEmployeeId(id); const selected = employees.find((item) => item.id === id); setBody(templateBody(letterType, selected?.employeeName || "Employee", effectiveDate)) }
  const selectType = (type: EmployeeLetter["letterType"]) => { setLetterType(type); setSubject(letterDetails[type].subject); setBody(templateBody(type, employee?.employeeName || "Employee", effectiveDate)) }

  async function save() {
    setError(""); setNotice("")
    if (!canManage) return setError("You do not have permission to issue employee letters.")
    if (!employee || !entity || entity.transferredAt) return setError("Select an employee with an active issuing entity.")
    if (!subject.trim() || body.trim().length < 20) return setError("Add a subject and complete letter content.")
    try {
      await addEmployeeLetter({ entityId: entity.id, employeeId: employee.id, letterType, title: letterDetails[letterType].title, issueDate, effectiveDate, subject: subject.trim(), body: body.trim(), status: "Issued", signatureName: signatureName.trim(), issuedAt: new Date().toISOString() })
      setNotice(`${letterDetails[letterType].label} letter saved under ${employee.employeeName}.`)
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "The letter could not be saved.") }
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
      const message = caught instanceof Error ? caught.message : "The employee letter could not be sent on WhatsApp."
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
      setError(caught instanceof Error ? caught.message : "The employee letter email could not be prepared.")
    } finally { setEmailingLetterId(null) }
  }

  return <div className="space-y-7">
    <PageHeader eyebrow="Employee documents" title="Employment letters" description="Create offer, internship offer and termination letters with your saved company branding and signature." />
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{notice}</p> : null}
    <Card><CardHeader><CardTitle>Create employee letter</CardTitle><CardDescription>Start with the standard wording, then edit every line for the employee.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4"><div className="space-y-2"><Label htmlFor="letter-employee">Employee</Label><select id="letter-employee" className={selectClass} value={employeeId} onChange={(event) => selectEmployee(event.target.value)}>{activeEmployees.map((item) => <option key={item.id} value={item.id}>{item.employeeName} · {item.employeeCode}</option>)}</select></div><div className="space-y-2"><Label htmlFor="letter-type">Letter type</Label><select id="letter-type" className={selectClass} value={letterType} onChange={(event) => selectType(event.target.value as EmployeeLetter["letterType"])}><option value="offer">Offer letter</option><option value="internship_offer">Internship offer letter</option><option value="termination">Termination letter</option></select></div><div className="space-y-2"><Label htmlFor="letter-issue-date">Issue date</Label><Input id="letter-issue-date" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="letter-effective-date">Effective date</Label><Input id="letter-effective-date" type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></div></div>
      <div className="space-y-2"><Label htmlFor="letter-subject">Subject</Label><Input id="letter-subject" value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="letter-body">Letter content</Label><textarea id="letter-body" className="min-h-72 w-full rounded-md border border-input bg-background p-3 text-sm leading-6" value={body} onChange={(event) => setBody(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="letter-signatory">Signatory name (optional)</Label><Input id="letter-signatory" value={signatureName} onChange={(event) => setSignatureName(event.target.value)} placeholder={`For ${entity?.companyName || "company"}`} /></div>
      <div className="flex justify-end"><Button disabled={!canManage || !employee} onClick={() => void save()}><Plus />Save issued letter</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Employee letter history</CardTitle><CardDescription>All saved letters remain visible here and can be downloaded, shared or emailed again.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Letter</TableHead><TableHead>Employee</TableHead><TableHead>Issue date</TableHead><TableHead>Effective date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{employeeLetters.length ? employeeLetters.map((letter) => { const target = employees.find((item) => item.id === letter.employeeId); return <TableRow key={letter.id}><TableCell><p className="font-medium">{letter.title}</p><p className="text-xs text-muted-foreground">{letter.subject}</p></TableCell><TableCell>{target?.employeeName || "Employee unavailable"}</TableCell><TableCell>{letter.issueDate}</TableCell><TableCell>{letter.effectiveDate}</TableCell><TableCell><Badge variant="outline">{letter.status}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Download PDF" aria-label="Download employee letter" onClick={() => void download(letter)}><Download /></Button><Button size="icon" variant="ghost" title="Share via WhatsApp" aria-label="Share employee letter via WhatsApp" onClick={() => setShareLetterTarget(letter)}><MessageCircle /></Button><Button size="icon" variant="ghost" title="Email PDF" aria-label="Email employee letter PDF" disabled={emailingLetterId !== null} onClick={() => void email(letter)}><Mail />{emailingLetterId === letter.id ? <span className="sr-only">Sending</span> : null}</Button><Button size="icon" variant="ghost" title="Delete letter" aria-label="Delete employee letter" disabled={!canManage || Boolean(companies.find((company) => company.id === letter.entityId)?.transferredAt)} onClick={() => void deleteEmployeeLetter(letter.id)}><Trash2 /></Button></div></TableCell></TableRow> }) : <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No employee letters have been saved yet.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
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
