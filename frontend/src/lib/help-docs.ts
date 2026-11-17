/**
 * In-app help: short, searchable articles grouped like API documentation.
 * Keep each article focused on one task. Update when a feature changes.
 */

export type HelpBlock =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "note"; text: string }

export type HelpSection = { heading?: string; blocks: HelpBlock[] }
export type HelpArticle = {
  id: string
  group: string
  title: string
  summary: string
  /** Page in the app this article is about, shown as an "Open" link. */
  path?: string
  pathLabel?: string
  keywords: string[]
  sections: HelpSection[]
}

/** A screenshot or diagram shown under a section (heading, or the first section when omitted). */
export type HelpFigure = { src: string; alt: string; section?: string }

const figure = (name: string, alt: string, section?: string): HelpFigure => ({ src: `/help/${name}.webp`, alt, section })

/** Pictures from the ChanaX user guide, by article id. */
export const helpFigures: Record<string, HelpFigure[]> = {
  "sign-in": [figure("login", "Sign-in screen with one field for email or phone, and Continue with Google")],
  "first-setup": [figure("getting-started-flow", "Getting started: sign in, choose role, set up business, add entities, create documents"), figure("choose-role", "How will you use ChanaX: CA / accounting firm, Founder / owner, or Company employee")],
  overview: [figure("overview", "Overview page with counts and recent activity"), figure("product-tour", "Product tour welcome screen", "Take the tour again")],
  entities: [figure("entity-switcher", "Company switcher in the navbar with Add entity and Manage entities", "Switch the working company"), figure("add-company", "Add a company form with GSTIN verification, invoice numbering and HSN/SAC codes", "Add a company")],
  customers: [figure("customers", "Customers page with the Add customer manually form", "Add a customer")],
  "create-invoice": [figure("invoice-flow", "Creating a GST invoice: pick entity, pick customer, add line items, review totals, generate"), figure("invoices-page", "Invoices page with New invoice and the invoice register"), figure("invoice-preview", "Invoice preview with Share and Download PDF", "Statuses"), figure("invoice-register", "Invoice register search and filters", "Find an invoice")],
  "correct-invoice": [figure("correction-flow", "Correcting an issued invoice: open invoice, choose method, give reason, save, replacement")],
  quotations: [figure("quotation-register", "Quotation register with Convert to invoice", "Convert to invoice")],
  "share-documents": [figure("share-invoice", "Share invoice dialog with Email and WhatsApp"), figure("share-quotation", "Share quotation dialog"), figure("share-letter", "Share offer letter on WhatsApp")],
  employees: [figure("add-employee", "Add employee form", "Add one employee"), figure("bulk-employees", "Bulk add employees with the Excel template", "Import many"), figure("salary-components", "Earnings and deductions on an employee's salary", "Salary components")],
  payslips: [figure("create-payslip", "Create individual payslip with salary month and attendance")],
  attendance: [figure("attendance-to-payslips", "From attendance to payslips: add employees, set leave policy, mark attendance, review deductions, generate", "Generate payslips from attendance"), figure("attendance-register", "Employee attendance register with LOP deduction and Preview payslips", "Generate payslips from attendance")],
  "employee-letters": [figure("letter-history", "Employee letter history with download, share and email", "Issue a letter")],
  expenses: [figure("add-expense", "Add expense form with category, amount and bill attachment"), figure("expense-summary", "Expense summary with invoice, payroll and other expenses"), figure("expense-tabs", "Invoice, payroll and other expense tabs")],
  "data-export": [figure("data-export", "Data Export: choose categories, company and dates, download ZIP")],
  tally: [figure("tally-flow", "Exporting to Tally: settings, map ledgers, date range, download XML, import"), figure("tally-settings", "Tally company and ledger settings"), figure("tally-customer-mapping", "Customer ledger mapping"), figure("tally-employee-mapping", "Employee payroll ledger mapping"), figure("tally-download", "Download invoice and payslip Tally XML")],
  templates: [figure("templates", "Templates page with template choices and live preview")],
  team: [figure("team-access", "Add a team member with role and page access", "Invite a team member"), figure("team-members", "Team member list with Edit access", "Invite a team member")],
  "ca-access": [figure("ca-flow", "How a CA gets access: CA signs up, requests access, owner approves, seat is used, CA works", "Business owners: approve a CA"), figure("ca-activity-log", "CA access and activity log", "Business owners: approve a CA")],
  "delete-account": [figure("delete-account", "Delete this ChanaX account")],
  support: [figure("feedback", "Share feedback dialog")],
}

export const helpGroups = [
  "Getting started",
  "Companies and customers",
  "Invoices and quotations",
  "Payroll and HR",
  "Expenses and export",
  "Documents and branding",
  "Account, team and billing",
  "Troubleshooting",
] as const

export const helpArticles: HelpArticle[] = [
  // Getting started
  {
    id: "sign-in",
    group: "Getting started",
    title: "Sign in",
    summary: "Use your email, mobile number or Google account from one sign-in screen.",
    keywords: ["login", "log in", "password", "otp", "whatsapp code", "phone", "google", "forgot password", "reset"],
    sections: [
      { blocks: [{ kind: "steps", items: [
        "Open chanax.in and choose Sign in.",
        "Type your email address or mobile number in the single field and click Continue.",
        "Email: enter your password. Mobile: enter the 6-digit code sent to you on WhatsApp.",
        "Or click Continue with Google.",
      ] }] },
      { heading: "Forgot your password", blocks: [
        { kind: "p", text: "Click Forgot password, open the reset email, and choose a new password." },
      ] },
      { heading: "Didn't get the WhatsApp code", blocks: [
        { kind: "list", items: [
          "Check the number includes the right country code.",
          "Wait 30 seconds, then click Resend code.",
          "Codes expire after 10 minutes.",
        ] },
      ] },
    ],
  },
  {
    id: "first-setup",
    group: "Getting started",
    title: "Set up your business",
    summary: "Choose Business or CA, verify your GSTIN, and set your leave policy and invoice numbering.",
    path: "/setup",
    keywords: ["onboarding", "setup", "gstin", "verify", "business", "ca", "industry", "numbering", "first login"],
    sections: [
      { blocks: [{ kind: "steps", items: [
        "Choose how you will use ChanaX: Founder / owner (your own company), CA / accounting firm (client companies), or Company employee (access given by your company's admin).",
        "Answer Does your business have a GSTIN? Yes: enter the 15-character GSTIN and click Verify; ChanaX fills the legal name, trade name, PAN and address. No: enter your business name, optional PAN and address.",
        "Choose your industry.",
        "Set the employee leave policy: paid leave days per month or per year.",
        "Set invoice numbering. To carry on from your current numbers, choose Continue my existing invoice sequence and enter your latest invoice number.",
        "Save. You land on the Overview page.",
      ] }] },
      { heading: "Free credits", blocks: [
        { kind: "table", head: ["Account", "Free credits"], rows: [["New workspace", "20"], ["After GSTIN verification", "60"]] },
      ] },
      { blocks: [{ kind: "note", text: "A GSTIN that is cancelled or suspended on the GST portal can't be verified. Choose No, I do not have a GSTIN for now, and add it in Workspace settings once it is active again." }] },
    ],
  },
  {
    id: "overview",
    group: "Getting started",
    title: "Overview page and product tour",
    summary: "Your home screen: setup progress, quick actions and recent activity.",
    path: "/workspace",
    pathLabel: "Open Overview",
    keywords: ["dashboard", "home", "tour", "setup progress", "recent activity", "theme", "dark mode", "light mode"],
    sections: [
      { blocks: [{ kind: "list", items: [
        "Setup progress: a checklist of what is left to set up.",
        "Quick actions: start a new invoice or import companies.",
        "Recent activity: the latest documents in your workspace.",
      ] }] },
      { heading: "Take the tour again", blocks: [{ kind: "p", text: "Open the account menu (your name, top right) and choose Product tour." }] },
      { heading: "Light or dark theme", blocks: [{ kind: "p", text: "Click the sun or moon icon in the top bar and choose System, Light or Dark." }] },
    ],
  },

  // Companies and customers
  {
    id: "entities",
    group: "Companies and customers",
    title: "Add and switch companies (entities)",
    summary: "An entity is a company that issues documents. One workspace can hold several.",
    keywords: ["entity", "company", "add company", "switch company", "gstin", "add gstin later", "missing gstin", "billing address", "premises", "numbering", "financial year", "reset"],
    sections: [
      { heading: "Switch the working company", blocks: [{ kind: "p", text: "Use the company switcher at the top left of the navbar. Customers, invoices, employees and attendance show only the selected company." }] },
      { heading: "Add a company", blocks: [{ kind: "steps", items: [
        "Open the company switcher and choose Add entity.",
        "Enter the company name, billing address and premises address.",
        "Choose GST registered or Not GST registered. For GST registered, enter the GSTIN and click Verify & fill.",
        "Set invoice numbering: starting number, and whether it resets each financial year.",
        "Click Save company.",
      ] }] },
      { heading: "Add a GSTIN later", blocks: [{ kind: "p", text: "If a company was saved without a GSTIN, open Workspace settings → Companies (entities), or Manage entities, and click Add GSTIN. Verify it, choose whether to use the GST-registered name and address, and save. Existing invoices are not changed." }] },
      { heading: "Rules", blocks: [{ kind: "list", items: [
        "A GSTIN can be registered in only one ChanaX workspace.",
        "The PAN must match the PAN inside the GSTIN.",
        "View-only users can see companies but not change them.",
      ] }] },
    ],
  },
  {
    id: "hsn-sac",
    group: "Companies and customers",
    title: "HSN/SAC codes",
    summary: "Save the codes a company uses; the first one is the default on new invoices.",
    keywords: ["hsn", "sac", "code", "default code", "4 digits", "6 digits", "8 digits"],
    sections: [
      { blocks: [{ kind: "steps", items: [
        "Open the company switcher, choose Manage entities, and open Manage entity HSN/SAC codes.",
        "Add each code. A code must have exactly 4, 6 or 8 digits.",
        "The first code is the default. Click Save HSN/SAC codes.",
      ] }] },
      { blocks: [{ kind: "note", text: "HSN/SAC is optional on non-GST invoices and quotations." }] },
    ],
  },
  {
    id: "customers",
    group: "Companies and customers",
    title: "Customers",
    summary: "Save the parties you bill, one by one or from Excel.",
    path: "/customers",
    pathLabel: "Open Customers",
    keywords: ["customer", "client", "party", "b2b", "b2c", "gstin", "pan", "favourite", "import customers", "excel"],
    sections: [
      { heading: "Add a customer", blocks: [{ kind: "steps", items: [
        "Select the right company in the navbar.",
        "Open Customers and click Add customer manually.",
        "Enter the company name, GSTIN, PAN, HSN/SAC, billing address and premises address. Click Verify next to the GSTIN to fill details automatically.",
        "Click Save customer.",
      ] }] },
      { heading: "B2B and B2C customers", blocks: [
        { kind: "table", head: ["Customer", "Needs"], rows: [
          ["B2B (has a GSTIN)", "Name, GSTIN, PAN and billing address"],
          ["B2C (retail, no GSTIN)", "Name only; GSTIN, PAN and address are optional"],
        ] },
      ] },
      { blocks: [{ kind: "p", text: "You can also add a new customer while creating an invoice, and mark frequent ones with Add to favourites." }] },
    ],
  },

  // Invoices and quotations
  {
    id: "create-invoice",
    group: "Invoices and quotations",
    title: "Create an invoice",
    summary: "Add line items, choose CGST + SGST or IGST, then save a draft or generate.",
    path: "/invoices",
    pathLabel: "Open Invoices",
    keywords: ["invoice", "new invoice", "gst", "cgst", "sgst", "igst", "line item", "tds", "draft", "generate", "tax invoice"],
    sections: [
      { blocks: [{ kind: "steps", items: [
        "Open Invoices and click New invoice.",
        "Choose the customer (existing or new). The invoice number fills in from your company's numbering.",
        "Set the invoice date.",
        "Add line items: description, HSN/SAC and taxable amount. Add more lines as needed.",
        "Choose the tax: CGST + SGST for a sale in your state, or IGST for another state. One tax type applies to the whole invoice.",
        "Enter amounts with or without GST; ChanaX works out the other. Add TDS or other deductions if any.",
        "Click Save as draft, or Generate invoice.",
      ] }] },
      { heading: "Statuses", blocks: [
        { kind: "table", head: ["Status", "Meaning"], rows: [
          ["Draft", "Not final. Edit or delete freely; no credit used."],
          ["Generated", "Final. Uses 1 credit. Preview, PDF and sharing available."],
          ["Cancelled", "Replaced or voided through a correction."],
          ["Amended", "Changed through a GSTR-1 amendment, credit note or debit note."],
        ] },
      ] },
      { heading: "Find an invoice", blocks: [{ kind: "p", text: "Use the search box and filters (company, date, amount). If nothing shows, widen the filters." }] },
    ],
  },
  {
    id: "correct-invoice",
    group: "Invoices and quotations",
    title: "Correct an issued invoice",
    summary: "Never overwrite a generated invoice; record the right correction method instead.",
    path: "/invoices",
    pathLabel: "Open Invoices",
    keywords: ["correct", "cancel", "replace", "credit note", "debit note", "gstr-1", "amendment", "irn", "e-invoice", "mistake", "wrong gstin"],
    sections: [
      { blocks: [{ kind: "p", text: "On the invoice, click Correct issued invoice, choose the method, and enter a clear reason (for example, incorrect customer GSTIN)." }] },
      { heading: "Which method to use", blocks: [
        { kind: "table", head: ["Method", "When"], rows: [
          ["Cancel and replace", "The invoice was never reported on the GST portal and has no IRN."],
          ["IRN cancelled, then replace", "You cancelled the e-invoice IRN within 24 hours. Enter the cancellation acknowledgement."],
          ["GSTR-1 amendment", "Already reported in GSTR-1. Enter the amendment reference."],
          ["Credit note", "To reduce the invoice value. Enter the credit note number."],
          ["Debit note", "To increase the invoice value. Enter the debit note number."],
        ] },
      ] },
      { blocks: [{ kind: "note", text: "ChanaX records the correction; it does not cancel an IRN or file on the GST portal. Do that step with your CA first. A replacement invoice uses 1 credit." }] },
    ],
  },
  {
    id: "bulk-invoices",
    group: "Invoices and quotations",
    title: "Upload invoices in bulk",
    summary: "Import a month of invoices from Excel; taxable value and GST are worked out from the total.",
    path: "/invoices",
    pathLabel: "Open Invoices",
    keywords: ["bulk", "upload", "import", "excel", "xlsx", "csv", "template", "sales register", "b2c", "rejected rows", "duplicate"],
    sections: [
      { blocks: [{ kind: "steps", items: [
        "On Invoices, open Bulk invoice generation and download the Excel template, or use your own sheet.",
        "Fill one line item per row. Repeat an invoice number on several rows for several descriptions.",
        "Click Upload invoice workbook.",
        "Check the preview: ready and rejected rows, tax totals and warnings. Nothing is saved yet.",
        "Click Generate invoices. Download all PDFs as one ZIP.",
      ] }] },
      { heading: "Columns", blocks: [
        { kind: "table", head: ["Column", "Required"], rows: [
          ["Customer Name, Invoice Number, Invoice Date", "Always"],
          ["Invoice Total (with GST) or Taxable Amount", "Always, one of the two"],
          ["GSTIN, Billing Address, HSN/SAC", "B2B rows only (HSN/SAC falls back to the company's code)"],
          ["PAN, Premises Address, Description, CGST/SGST/IGST, TDS, deductions, Status", "Optional"],
        ] },
      ] },
      { heading: "How amounts are worked out", blocks: [
        { kind: "list", items: [
          "CGST, SGST and IGST can be a rate (2.5 or 9%) or a rupee amount.",
          "With only the total: ₹87,000 at 2.5% + 2.5% = ₹82,857.14 taxable + ₹2,071.43 CGST + ₹2,071.43 SGST.",
          "Column names like Total Amount or Taxable Value are recognised.",
        ] },
      ] },
      { heading: "Rows that are rejected", blocks: [{ kind: "list", items: [
        "Invoice number already exists in ChanaX, or reused for a different customer or date in the file.",
        "Missing name, number, date or amount; invalid GSTIN or PAN; HSN/SAC not 4, 6 or 8 digits.",
        "Both IGST and CGST/SGST on one row.",
      ] }] },
    ],
  },
  {
    id: "quotations",
    group: "Invoices and quotations",
    title: "Quotations (proforma)",
    summary: "Send a quotation, then convert it into a tax invoice when the sale is confirmed.",
    path: "/proformas",
    pathLabel: "Open Quotations",
    keywords: ["quotation", "proforma", "estimate", "quote", "convert to invoice", "valid until", "without gst", "include gst", "igst"],
    sections: [
      { blocks: [{ kind: "p", text: "A quotation is not a tax invoice; the PDF says so clearly." }] },
      { heading: "Create a quotation", blocks: [{ kind: "steps", items: [
        "Open Quotations and click New quotation / proforma.",
        "Choose the issuing company and customer.",
        "Set Issue date and Valid until.",
        "Tick or untick Include GST amounts. With GST, choose CGST + SGST or IGST for the whole quotation.",
        "Add description lines with taxable amounts and a GST rate per line.",
        "Click Generate quotation. 1 credit is used.",
      ] }] },
      { heading: "Convert to invoice", blocks: [{ kind: "p", text: "Open the quotation in the register and click Convert to invoice. Review and generate; this uses 1 more credit. The quotation shows Converted." }] },
    ],
  },
  {
    id: "share-documents",
    group: "Invoices and quotations",
    title: "Download and share documents",
    summary: "Send invoices, quotations, payslips and letters by email or WhatsApp, or download the PDF.",
    keywords: ["share", "email", "whatsapp", "send", "pdf", "download", "zip"],
    sections: [
      { blocks: [
        { kind: "table", head: ["Option", "What happens"], rows: [
          ["Email", "Enter the recipient's email. The PDF is sent as an attachment."],
          ["WhatsApp", "Enter the number with country code; ChanaX sends the PDF. Or choose Send from my own WhatsApp."],
          ["Download PDF", "Save it and send it yourself."],
          ["Download ZIP", "For several invoices or payslips at once."],
        ] },
      ] },
      { blocks: [{ kind: "note", text: "Payslips are sent by email only: each employee gets one email with their PDFs. Add an email to the employee's profile first." }] },
    ],
  },

  // Payroll and HR
  {
    id: "employees",
    group: "Payroll and HR",
    title: "Add employees and salary",
    summary: "Save employee and bank details once; payslips reuse them every month.",
    path: "/employees",
    pathLabel: "Open Employees",
    keywords: ["employee", "staff", "salary", "earnings", "deductions", "basic", "hra", "pf", "esi", "uan", "bank", "ifsc", "import employees"],
    sections: [
      { heading: "Add one employee", blocks: [{ kind: "p", text: "Click Add employee and enter code, name, designation, department, joining date, email, PAN, UAN, ESI number and bank details (bank, account number, IFSC). Then set their salary components." }] },
      { heading: "Import many", blocks: [{ kind: "p", text: "Download the employee template, fill it in Excel and upload it. Rows with errors are listed so you can fix them." }] },
      { heading: "Salary components", blocks: [{ kind: "list", items: [
        "Earnings: Basic, HRA, other allowances, bonus or incentive, overtime.",
        "Deductions: PF, ESI, Professional Tax, TDS, loan or advance recovery.",
        "Loss of pay is added automatically from attendance.",
      ] }] },
      { blocks: [{ kind: "note", text: "Hiring someone new? Issue an offer letter with + New person; they are added here with the salary from the letter." }] },
    ],
  },
  {
    id: "payslips",
    group: "Payroll and HR",
    title: "Generate payslips",
    summary: "Create payslips one at a time, in bulk, or straight from attendance.",
    path: "/employees",
    pathLabel: "Open Employees",
    keywords: ["payslip", "salary slip", "pay slip", "bulk payslips", "net pay", "zip", "copy into next month"],
    sections: [
      { blocks: [{ kind: "steps", items: [
        "Choose the company and salary month.",
        "Click Create individual payslip, or generate in bulk. From the Attendance page you can generate for all selected employees.",
        "Use Copy into next month to reuse last month's salary.",
        "Review and generate. Each payslip uses 1 credit.",
        "Preview, download as PDF or ZIP, or email them.",
      ] }] },
      { blocks: [{ kind: "note", text: "An employee can have only one payslip per month. To change one, delete it and generate it again." }] },
    ],
  },
  {
    id: "attendance",
    group: "Payroll and HR",
    title: "Mark attendance",
    summary: "Daily marks feed loss-of-pay on payslips. Every change saves automatically.",
    path: "/attendance",
    pathLabel: "Open Attendance",
    keywords: ["attendance", "present", "absent", "half day", "leave", "holiday", "weekly off", "lop", "loss of pay", "register", "mark all"],
    sections: [
      { heading: "Statuses", blocks: [
        { kind: "table", head: ["Mark", "Counts as"], rows: [
          ["Present", "1 day worked"],
          ["Half-day", "0.5 day worked, 0.5 day loss of pay"],
          ["Paid leave", "Paid, up to the leave allowance"],
          ["Absent / unpaid leave", "Loss of pay"],
          ["Weekly off, Holiday", "Paid; no marking needed"],
        ] },
      ] },
      { heading: "Ways to mark", blocks: [{ kind: "list", items: [
        "Quick entry: one employee, one date, with optional time and remark.",
        "Monthly grid: click any day for an employee.",
        "Attendance by date: Mark unmarked employees present fills everyone not yet marked, keeping existing leave and absences.",
      ] }] },
      { heading: "Work calendar", blocks: [{ kind: "p", text: "Under Work calendar & payroll entry settings, set Saturday and Sunday weekly offs and add holidays. India's national holidays are added automatically." }] },
      { heading: "Generate payslips from attendance", blocks: [{ kind: "steps", items: [
        "Every working day must be marked for the selected employees.",
        "Review present days, leave, LOP deduction and estimated net in the register.",
        "Click Preview payslips, then Generate. They appear on the Employees page.",
      ] }] },
      { blocks: [{ kind: "p", text: "Download the month's register with Download Excel or Download PDF." }] },
    ],
  },
  {
    id: "leave-policy",
    group: "Payroll and HR",
    title: "Leave policy",
    summary: "Set paid leave per month or per year, for everyone or for one employee.",
    path: "/settings/workspace",
    pathLabel: "Open Workspace settings",
    keywords: ["leave", "leave policy", "paid leave", "allowance", "excess leave", "april", "financial year", "per employee", "lop"],
    sections: [
      { heading: "Default for everyone", blocks: [{ kind: "p", text: "Workspace settings → Employee leave policy: choose monthly or yearly and the number of paid days. For a yearly allowance, choose the month the leave year starts (for example April). If nothing is set, 1 day a month applies." }] },
      { heading: "For one employee", blocks: [{ kind: "p", text: "Edit the employee and, under Paid leave, choose Set for this employee. They are labelled Own leave on the Attendance register." }] },
      { heading: "How leave is deducted", blocks: [
        { kind: "p", text: "Leave beyond the allowance, unpaid leave and half-days become loss of pay:" },
        { kind: "note", text: "LOP deduction = monthly gross ÷ calendar days × LOP days. Example: ₹31,000 gross, 31-day month, 1 absent day = ₹1,000." },
      ] },
    ],
  },
  {
    id: "employee-letters",
    group: "Payroll and HR",
    title: "Employee letters and salary breakdown",
    summary: "Offer, internship, relieving & experience and termination letters, with an optional CTC annexure.",
    path: "/employees/letters",
    pathLabel: "Open Employee letters",
    keywords: ["letter", "offer letter", "appointment", "internship", "stipend", "relieving", "experience", "termination", "ctc", "annexure", "salary breakup", "new hire"],
    sections: [
      { heading: "Issue a letter", blocks: [{ kind: "steps", items: [
        "Open Employee letters and choose the employee, or + New person to add someone new.",
        "Choose the letter type, issue date and effective date.",
        "Choose what salary the letter shows (see below).",
        "Edit the wording and subject, add a signatory name if needed.",
        "Click Save issued letter. Download, email or share it from Employee letter history.",
      ] }] },
      { heading: "Salary options", blocks: [
        { kind: "table", head: ["Letter", "Can show"], rows: [
          ["Offer letter", "Annual CTC line, or CTC plus Annexure A salary breakdown"],
          ["Internship offer", "Monthly stipend line"],
          ["Relieving & experience", "Last drawn CTC line, or full breakdown"],
          ["Termination", "Last drawn CTC line, or full breakdown"],
        ] },
        { kind: "p", text: "For offer and internship letters, tick Use this salary for payslips to copy the structure into the employee's salary." },
      ] },
      { heading: "How CTC is split", blocks: [
        { kind: "list", items: [
          "Basic 50% of CTC, HRA 40% of Basic, conveyance, optional medical and statutory bonus.",
          "PF 12% (employee) and 13% (employer) on Basic up to ₹15,000, or on full Basic.",
          "ESIC 0.75% and 3.25% when gross is ₹21,000 or less; Professional Tax by slab; gratuity 4.81% of Basic.",
          "Special allowance balances the total so it always equals the CTC.",
        ] },
        { kind: "p", text: "Example: ₹6,00,000 CTC gives ₹46,847 gross and ₹44,847 take-home a month. Change the default rules in Workspace settings → Salary structure defaults, or per letter under Salary rules for this letter." },
      ] },
    ],
  },

  // Expenses and export
  {
    id: "expenses",
    group: "Expenses and export",
    title: "Record expenses",
    summary: "Track business spending with bills attached, next to invoices and payroll.",
    path: "/expenses",
    pathLabel: "Open Expenses",
    keywords: ["expense", "bill", "receipt", "vendor", "category", "spending", "attach"],
    sections: [
      { blocks: [{ kind: "steps", items: [
        "Open Expenses and click Add expense.",
        "Enter company, expense name, category, date, amount (₹), and optionally vendor and description.",
        "Attach the bill: PDF, JPG, PNG or WebP, up to 5 MB.",
        "Click Save expense.",
      ] }] },
      { blocks: [{ kind: "p", text: "Categories include office expenses, utilities, professional fees, marketing, insurance, repairs, bank charges and miscellaneous, or create your own. Filter by company, category and date; tabs show invoice, payroll and other expenses." }] },
    ],
  },
  {
    id: "data-export",
    group: "Expenses and export",
    title: "Export data",
    summary: "Download invoices, payroll, attendance and expenses as a ZIP of spreadsheets.",
    path: "/tally-export",
    pathLabel: "Open Data Export",
    keywords: ["export", "download", "zip", "excel", "backup", "data"],
    sections: [
      { blocks: [{ kind: "steps", items: [
        "Open Data Export.",
        "Select one or more categories (for example attendance, employee master, expenses and bills, quotations).",
        "Choose the company and date range.",
        "Click Download selected data as ZIP.",
      ] }] },
    ],
  },
  {
    id: "tally",
    group: "Expenses and export",
    title: "Export to Tally",
    summary: "Create Tally XML for sales vouchers and payroll journals.",
    path: "/tally-export",
    pathLabel: "Open Data Export",
    keywords: ["tally", "tallyprime", "xml", "voucher", "ledger", "journal", "import into tally", "mapping"],
    sections: [
      { blocks: [{ kind: "steps", items: [
        "Under Tally settings, enter the Tally company name and the exact ledger names: Sales, Output CGST, Output SGST, Output IGST, Round-off, Salary expense, PF payable, ESI payable, Professional tax payable, TDS payable, Other deduction.",
        "Map each customer to its Tally party ledger: Download mapping Excel, fill it in, upload it back. Do the same for employees.",
        "Choose the company and date range.",
        "Download invoice Tally XML (sales vouchers) or payslip Tally XML (one journal per payslip).",
        "In Tally, import the XML file.",
      ] }] },
      { blocks: [{ kind: "note", text: "Ledger names must match Tally exactly, including spaces and capitals, or the import fails." }] },
    ],
  },

  // Documents and branding
  {
    id: "templates",
    group: "Documents and branding",
    title: "Templates and branding",
    summary: "Choose a design and add your logo, colours, signature, terms and watermark.",
    path: "/settings/templates",
    pathLabel: "Open Templates",
    keywords: ["template", "logo", "brand", "colour", "color", "signature", "watermark", "terms", "design", "font", "chanax branding"],
    sections: [
      { blocks: [{ kind: "list", items: [
        "Pick a template, for example Classic Ledger, Minimal Professional or Modern Breeze.",
        "Set it as the default for all companies, or for one company.",
        "Customise: brand and page colour, logo and signature (PNG or JPG), headings, sections shown, terms and conditions.",
        "Add a watermark such as DRAFT, PAID or CONFIDENTIAL, or custom text you can drag on the page.",
        "Switch the preview between invoice and quotation, then Save changes.",
      ] }] },
      { blocks: [{ kind: "p", text: "Templates apply to invoices, quotations, payslips and employee letters. Eligible paid plans can remove the Created by ChanaX line." }] },
    ],
  },

  // Account, team and billing
  {
    id: "credits-plans",
    group: "Account, team and billing",
    title: "Credits and plans",
    summary: "One credit per invoice, quotation or payslip. Employee letters are free.",
    path: "/pricing",
    pathLabel: "Open Pricing",
    keywords: ["credits", "plan", "pricing", "buy", "razorpay", "payment", "subscription", "balance", "expire", "free credits", "custom plan"],
    sections: [
      { blocks: [{ kind: "p", text: "Your credit balance is shown in the top bar. Drafts don't use credits; a credit is used when a document is generated." }] },
      { heading: "Plans", blocks: [
        { kind: "table", head: ["Plan", "Price (+18% GST)", "Credits"], rows: [
          ["Monthly", "₹199 / month", "400"],
          ["Quarterly", "₹499 / 3 months", "1,250"],
          ["Annual", "₹1,499 / year", "5,200"],
          ["3 Years", "₹3,299 / 3 years", "15,600"],
        ] },
        { kind: "p", text: "Every plan includes the owner plus 2 team accounts. Paid credits expire at the end of the plan period." },
      ] },
      { heading: "Buying", blocks: [{ kind: "list", items: [
        "Only the workspace owner can buy; others can see the balance.",
        "Pay through Razorpay. Credits are added once the payment is verified; closing checkout adds nothing.",
        "Payment history lists every purchase with a downloadable receipt.",
        "Need more? Contact us for a custom plan or a payment link.",
      ] }] },
    ],
  },
  {
    id: "team",
    group: "Account, team and billing",
    title: "Workspace settings and team members",
    summary: "Update business details and give team members access by role.",
    path: "/settings/workspace",
    pathLabel: "Open Workspace settings",
    keywords: ["team", "invite", "member", "role", "admin", "accountant", "hr", "viewer", "permission", "access", "seat", "workspace settings", "subscription code"],
    sections: [
      { heading: "Business details", blocks: [{ kind: "p", text: "Update firm name, address, GST registration, leave policy and salary structure defaults, then click Save workspace settings." }] },
      { heading: "Invite a team member", blocks: [{ kind: "steps", items: [
        "Under Add a team member, enter their email address.",
        "Choose a role: Admin (everything), or Accountant, HR, Viewer or Custom (selected pages).",
        "Click Grant access. They receive an email invitation.",
        "Change a role, disable, restore, or revoke a pending invitation under Edit access.",
      ] }] },
      { blocks: [{ kind: "p", text: "Permissions cover entities, invoices, payslips, expenses, templates and data export, each as view or manage." }] },
    ],
  },
  {
    id: "ca-access",
    group: "Account, team and billing",
    title: "CA access and the CA portal",
    summary: "Let your accountant work in your workspace, or, as a CA, manage client workspaces.",
    keywords: ["ca", "chartered accountant", "accountant", "client", "ca portal", "access request", "subscription code", "approve"],
    sections: [
      { heading: "Business owners: approve a CA", blocks: [{ kind: "p", text: "In Workspace settings, under CA access requests, click Review & approve and choose which pages the CA may use. Approval uses one team seat. The activity log shows what they did." }] },
      { heading: "CAs: use the CA portal", blocks: [{ kind: "list", items: [
        "My firm workspace: your own invoices and payroll with its own credits. Create it once, then Open my workspace.",
        "Client workspaces: every client that approved you. Click Open client workspace.",
        "Request client access: enter the client owner's email or subscription code and send the request.",
      ] }] },
      { blocks: [{ kind: "note", text: "Each client keeps its own subscription, credits and data. Your firm's credits are never used for clients." }] },
    ],
  },
  {
    id: "profile",
    group: "Account, team and billing",
    title: "Your profile",
    summary: "Change your name, email, password or sign-in phone number.",
    path: "/profile",
    pathLabel: "Open Profile",
    keywords: ["profile", "name", "email", "password", "phone", "change number", "account"],
    sections: [
      { blocks: [{ kind: "list", items: [
        "Open the account menu and choose Profile.",
        "Name: edit and save.",
        "Email: add or change it, then confirm from the email we send.",
        "Password: set one to sign in with email and password.",
        "Phone: enter the new number and the WhatsApp code to change your sign-in number.",
      ] }] },
      { blocks: [{ kind: "p", text: "Business details are separate, in Workspace settings." }] },
    ],
  },
  {
    id: "delete-account",
    group: "Account, team and billing",
    title: "Delete your account",
    summary: "Deletion stops access at once, with 30 days to change your mind.",
    path: "/settings/workspace",
    pathLabel: "Open Workspace settings",
    keywords: ["delete", "close account", "remove workspace", "cancel deletion", "recover"],
    sections: [
      { blocks: [{ kind: "list", items: [
        "In Workspace settings, click Delete account and type the confirmation phrase.",
        "Access stops immediately for everyone in the workspace.",
        "Click Cancel deletion within 30 days to restore everything.",
        "After 30 days, data is permanently deleted or anonymised and unused credits are forfeited.",
      ] }] },
    ],
  },
  {
    id: "support",
    group: "Account, team and billing",
    title: "Feedback and support",
    summary: "Tell us what to improve, or contact the ChanaX team.",
    path: "/contact",
    pathLabel: "Open Contact",
    keywords: ["support", "help", "contact", "feedback", "bug", "terms", "privacy", "refund"],
    sections: [
      { blocks: [{ kind: "list", items: [
        "Account menu → Feedback: choose a topic, rate your experience and write a message. Your sign-in email is included.",
        "The Contact page lists support details.",
        "Legal: Terms & Conditions, Privacy Policy, Cancellation & Refunds.",
      ] }] },
    ],
  },

  // Troubleshooting
  {
    id: "troubleshooting",
    group: "Troubleshooting",
    title: "Common problems",
    summary: "Quick fixes for the errors people see most.",
    keywords: ["error", "problem", "not working", "fix", "faq", "can't", "failed", "missing"],
    sections: [
      { blocks: [
        { kind: "table", head: ["Problem", "What to do"], rows: [
          ["Your workspace could not be loaded", "Click Try again, or sign out and sign in again."],
          ["A menu item is missing", "Your role doesn't include that page. Ask the owner or an admin."],
          ["GSTIN verification fails", "Check it is 15 characters and the PAN inside matches. Try again if the lookup service is busy."],
          ["GSTIN is cancelled or suspended", "It can't be verified until it is active on the GST portal. Continue without a GSTIN for now."],
          ["Duplicate GSTIN", "That GSTIN is already used in another ChanaX workspace."],
          ["HSN/SAC rejected", "Use exactly 4, 6 or 8 digits."],
          ["No credits left", "Open Pricing and buy a plan, or ask the owner to."],
          ["Bulk upload rows rejected", "Read the row number and reason in the preview, fix those rows and upload again."],
          ["Payslip skipped", "One already exists for that employee and month."],
          ["Can't generate payslips from attendance", "Some working days are unmarked; the register shows how many."],
          ["Tally import fails", "Ledger names and the Tally company name must match Tally exactly."],
          ["WhatsApp send fails", "Check the number and country code and try again; contact support if it continues."],
          ["Edit a generated invoice", "Only limited fields. Use Correct issued invoice for tax-related mistakes."],
        ] },
      ] },
    ],
  },
]

/** The readable text of an article: summary and sections, for snippets. */
export function helpArticleContent(article: HelpArticle) {
  const parts: string[] = [article.summary]
  for (const section of article.sections) {
    if (section.heading) parts.push(section.heading)
    for (const block of section.blocks) {
      if (block.kind === "p" || block.kind === "note") parts.push(block.text)
      else if (block.kind === "table") parts.push(...block.head, ...block.rows.flat())
      else parts.push(...block.items)
    }
  }
  return parts.join(" ")
}

/** Everything searchable in an article, including its title, group and keywords. */
export function helpArticleText(article: HelpArticle) {
  return [article.title, article.group, ...article.keywords, helpArticleContent(article)].join(" ")
}

export type HelpSearchResult = { article: HelpArticle; score: number; snippet: string }

/** Ranks articles by how well they match every word of the query. */
export function searchHelp(query: string, articles: HelpArticle[] = helpArticles): HelpSearchResult[] {
  const words = query.toLowerCase().split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}%₹/-]/gu, "")).filter(Boolean)
  if (!words.length) return []
  const results: HelpSearchResult[] = []
  for (const article of articles) {
    const title = article.title.toLowerCase()
    const keywords = article.keywords.join(" ").toLowerCase()
    const summary = article.summary.toLowerCase()
    const body = helpArticleText(article).toLowerCase()
    let score = 0
    let all = true
    for (const word of words) {
      if (!body.includes(word)) { all = false; break }
      if (title.includes(word)) score += 10
      if (keywords.includes(word)) score += 6
      if (summary.includes(word)) score += 3
      score += 1
    }
    if (!all) continue
    if (title.includes(query.toLowerCase().trim())) score += 15
    // Quote the article's own words around the first match; fall back to its summary.
    const content = helpArticleContent(article)
    const found = content.toLowerCase().indexOf(words[0])
    const start = Math.max(0, found - 50)
    const snippet = found < 0 ? article.summary : `${start > 0 ? "…" : ""}${content.slice(start, found + 110).trim()}${found + 110 < content.length ? "…" : ""}`
    results.push({ article, score, snippet })
  }
  return results.sort((left, right) => right.score - left.score || left.article.title.localeCompare(right.article.title))
}
