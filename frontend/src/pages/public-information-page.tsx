import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"
import { PublicFooter } from "@/components/public-footer"

interface InformationSection {
  title: string
  content: ReactNode
}

interface PublicInformationPageProps {
  eyebrow: string
  title: string
  introduction: string
  sections: InformationSection[]
}

function List({ children }: { children: ReactNode }) {
  return <ul className="mt-3 list-disc space-y-2 pl-5 text-[#0b3f77]/70">{children}</ul>
}

function PublicInformationPage({ eyebrow, title, introduction, sections }: PublicInformationPageProps) {
  return (
    <main className="public-light min-h-svh bg-[#f7fafc] text-[#082f5b]">
      <header className="border-b border-[#0b3f77]/10 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 sm:px-8">
          <BrandMark tone="brand" />
          <Link to="/login" className="rounded-lg border border-[#0b3f77] px-4 py-2 text-sm font-medium transition-colors hover:bg-[#0b3f77] hover:text-white">
            Log in
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0b3f77]/50">{eyebrow}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-5 text-base leading-7 text-[#0b3f77]/65">{introduction}</p>
          <p className="mt-3 text-xs text-[#0b3f77]/45">Last updated: 8 September 2026</p>
        </div>

        <div className="mt-10 space-y-5">
          {sections.map((section) => (
            <section key={section.title} className="rounded-2xl border border-[#0b3f77]/12 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-semibold">{section.title}</h2>
              <div className="mt-3 text-sm leading-6 text-[#0b3f77]/70">{section.content}</div>
            </section>
          ))}
        </div>
      </div>

      <PublicFooter />
    </main>
  )
}

const contactLink = <a href="mailto:contact@azorix.com" className="font-medium text-[#0b3f77] underline underline-offset-4">contact@azorix.com</a>

export function TermsPage() {
  return <PublicInformationPage eyebrow="Legal" title="Terms & Conditions" introduction="These terms govern access to and use of ChanaX, a business operations platform provided by Azorix Technologies Private Limited." sections={[
    { title: "Using ChanaX", content: <><p>You must provide accurate account information, keep your login secure and use ChanaX only for lawful business purposes. The workspace owner controls member invitations and permissions and remains responsible for activity within the workspace.</p></> },
    { title: "Plans and credits", content: <><p>ChanaX plans are prepaid for the period shown at checkout. Document credits may be used for invoices or payslips. Quotation credits are separate and may be used only for quotations or proformas. Credits expire at the end of the applicable plan period and cannot be transferred between unrelated workspaces.</p><p className="mt-3">Prices, credit allowances and plan features are displayed before payment. Payment is processed by Razorpay, and credits are activated only after server verification of a successful payment.</p></> },
    { title: "Your records and documents", content: <><p>You retain responsibility for the accuracy, legality and tax treatment of information entered into ChanaX and for documents generated from it. ChanaX assists with business administration but does not provide legal, tax or accounting advice. A proforma or quotation is not a completed sale or tax invoice.</p></> },
    { title: "Acceptable use", content: <List><li>Do not misuse the service, attempt unauthorised access or interfere with its operation.</li><li>Do not upload unlawful, harmful or infringing material.</li><li>Do not use ChanaX to impersonate another person or business.</li><li>Do not share access beyond the seats and permissions available under your plan.</li></List> },
    { title: "Service availability", content: <><p>We work to keep ChanaX available and secure, but uninterrupted operation is not guaranteed. Features may be improved, replaced or discontinued with reasonable notice where practical. Third-party services such as Supabase, Razorpay, WhiteBooks, email providers and hosting services may affect availability.</p></> },
    { title: "Account suspension and deletion", content: <><p>We may restrict accounts used unlawfully, fraudulently or in material breach of these terms. When an owner requests account deletion, access is deactivated and a 30-day recovery period begins. If the request is not cancelled, data is deleted or anonymised subject to legal retention needs and normal encrypted backup expiry. Unused credits are forfeited after permanent deletion.</p></> },
    { title: "Liability", content: <><p>To the extent permitted by law, ChanaX is provided without warranties beyond those expressly stated. Azorix Technologies Private Limited is not responsible for indirect losses, business decisions made from user-entered information, or failures caused by third-party services. Nothing in these terms limits rights that cannot legally be excluded.</p></> },
    { title: "Changes and contact", content: <><p>We may update these terms when the service or legal requirements change. Material changes will be communicated through the website, product or registered email where appropriate. Questions may be sent to {contactLink}.</p></> },
  ]} />
}

export function PrivacyPage() {
  return <PublicInformationPage eyebrow="Your information" title="Privacy Policy" introduction="This policy explains what ChanaX collects, why we use it, when it is shared and the choices available to you." sections={[
    { title: "Information we collect", content: <List><li>Account details such as name, email address and authentication information.</li><li>Business, customer, vendor, employee, attendance, expense, invoice, quotation and document information entered by authorised users.</li><li>GSTIN and taxpayer information requested through GST lookup.</li><li>Subscription, credit and payment references. ChanaX does not store complete card, UPI PIN or other payment instrument credentials.</li><li>Technical and security information such as device, browser, login and audit activity.</li><li>Feedback and support communications.</li></List> },
    { title: "How we use information", content: <List><li>Provide, secure and improve ChanaX.</li><li>Authenticate users and apply workspace permissions.</li><li>Generate, store, share and export documents requested by users.</li><li>Verify GST details and cache successful GST lookups to avoid repeated paid API requests.</li><li>Process payments, grant credits, prevent fraud and maintain records.</li><li>Respond to support, privacy and account requests.</li></List> },
    { title: "Service providers and workspace sharing", content: <><p>We use service providers including Supabase for authentication and data services, Razorpay for payment processing, WhiteBooks for GST information, infrastructure providers for hosting, and configured email providers for delivery. They process information only as needed to provide their services.</p><p className="mt-3">Workspace information is visible to members and CA users only according to access granted by the workspace owner or authorised administrator. Owners can change or revoke that access.</p></> },
    { title: "Retention", content: <><p>We keep information while an account is active and as needed to provide the service, meet legal obligations, resolve disputes and prevent fraud. Account deletion has a 30-day recovery period. After that period, personal and operational data is deleted or anonymised unless retention is legally required. Encrypted backups remain until their normal expiry.</p></> },
    { title: "Security", content: <><p>We use access controls, encrypted connections, restricted service credentials and audit records designed to protect information. No internet service can guarantee absolute security, so users should protect their credentials and promptly report suspected unauthorised access.</p></> },
    { title: "Your choices and rights", content: <><p>You can review and update much of your information inside ChanaX. Workspace owners can manage team access, export business data, request account deletion and cancel a pending deletion during the recovery period. You may also ask us to correct or delete personal information, withdraw consent where applicable, or address a privacy concern by contacting {contactLink}. Some information may be retained where required by law.</p></> },
    { title: "Cookies and local storage", content: <><p>ChanaX uses browser storage and authentication technologies needed to keep users signed in, remember preferences and operate securely. We do not use these tools to store payment credentials.</p></> },
    { title: "Updates", content: <><p>We may update this policy as ChanaX or applicable requirements change. Material updates will be communicated through the website, product or registered email where appropriate.</p></> },
  ]} />
}

export function ContactPage() {
  return <PublicInformationPage eyebrow="Support" title="Contact Us" introduction="Contact the ChanaX team for product support, billing questions, privacy requests or account assistance." sections={[
    { title: "Business details", content: <div className="space-y-2"><p><strong>Company:</strong> Azorix Technologies Private Limited</p><p><strong>Product:</strong> ChanaX</p><p><strong>Email:</strong> {contactLink}</p></div> },
    { title: "How we can help", content: <List><li>Account access and workspace setup</li><li>Subscription, credit and payment questions</li><li>GST lookup, invoices, quotations, payroll and exports</li><li>Bug reports and feature requests</li><li>Privacy, data export and account deletion requests</li></List> },
    { title: "Payment support", content: <><p>For payment or refund help, email us with your ChanaX account email, workspace name, payment date, amount and Razorpay payment ID. Never send an OTP, UPI PIN, card PIN or complete payment credentials.</p></> },
    { title: "Response time", content: <><p>We aim to acknowledge support requests within two business days. Payment, privacy and security concerns are prioritised according to urgency.</p></> },
  ]} />
}

export function CancellationRefundsPage() {
  return <PublicInformationPage eyebrow="Billing" title="Cancellation & Refunds" introduction="This policy explains how ChanaX plan cancellation, failed payments and eligible refunds are handled." sections={[
    { title: "Plan cancellation", content: <><p>ChanaX plans are currently prepaid for the selected monthly, quarterly or annual period and do not renew automatically unless a checkout clearly states otherwise. You may stop using the service at any time. Remaining credits continue until the plan expiry date unless the account is permanently deleted.</p></> },
    { title: "Refund eligibility", content: <><p>Contact us within seven days of payment if you were charged more than once for the same purchase, payment succeeded but credits were not delivered, or a technical failure prevented the purchased service from being provided. Other requests may be reviewed individually.</p><p className="mt-3">Refunds are not normally available for credits already used, expired credits, change of mind after material use, or account deletion. Where a partial refund is approved, credits attributable to the refunded amount may be removed proportionally.</p></> },
    { title: "How to request a refund", content: <><p>Email {contactLink} with your account email, workspace name, payment date, amount, reason and Razorpay payment ID. Do not share card details, OTPs, PINs or other payment credentials.</p></> },
    { title: "Processing timeline", content: <><p>We aim to review complete requests within five business days. Approved refunds are initiated to the original payment method. They usually appear within five to seven working days after initiation, although the bank or payment provider may take longer.</p></> },
    { title: "Failed or pending payments", content: <><p>If money is debited but ChanaX does not confirm the payment, wait for the payment status to settle and contact us with the payment reference. Do not make repeated payments unless the earlier attempt is confirmed as failed. Any automatic reversal is controlled by the bank or payment provider.</p></> },
    { title: "Digital delivery", content: <><p>ChanaX is a digital service. There are no physical goods or shipping charges. Purchased credits are delivered electronically to the workspace after successful server verification of the payment.</p></> },
  ]} />
}
