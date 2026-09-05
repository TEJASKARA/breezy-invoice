import { useEffect, useState } from "react"
import {
  Building2,
  FileOutput,
  FileText,
  LayoutDashboard,
  ReceiptText,
  Sparkles,
  Users,
  WalletCards,
} from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { WorkspacePermission } from "@/lib/workspace-access-service"

type TourStep = {
  title: string
  description: string
  detail: string
  icon: typeof Sparkles
  permission?: WorkspacePermission
}

const tourSteps: TourStep[] = [
  {
    title: "Welcome to ChanaX",
    description: "Your invoicing and payroll workspace is ready.",
    detail: "This short tour explains where everything lives. You can replay it anytime from your account menu.",
    icon: Sparkles,
  },
  {
    title: "Overview",
    description: "See the health of your workspace at a glance.",
    detail: "The dashboard shows your companies, invoices, employees, recent activity and remaining setup tasks.",
    icon: LayoutDashboard,
  },
  {
    title: "Entities",
    description: "Manage every company you work for.",
    detail: "Create a company once, add its tax and address details, and then use it to issue invoices and manage employees.",
    icon: Building2,
    permission: "entities.read",
  },
  {
    title: "Invoices",
    description: "Create invoices individually or in bulk.",
    detail: "Choose an entity, select or add a customer, enter line items and taxes, preview the result, and download the PDF.",
    icon: ReceiptText,
    permission: "invoices.read",
  },
  {
    title: "Employees & payslips",
    description: "Keep employee salary records and generate payslips.",
    detail: "Add employees manually or through Excel, reuse saved salary details each month, and generate one or many payslips.",
    icon: Users,
    permission: "payslips.read",
  },
  {
    title: "Expenses",
    description: "Record business costs and supporting bills.",
    detail: "Categorise expenses, create your own categories and attach bills so the information is ready for future analysis.",
    icon: WalletCards,
    permission: "expenses.read",
  },
  {
    title: "Data Export",
    description: "Prepare your records for Tally.",
    detail: "Map customer and employee ledger names, choose a date range, and export invoice or payslip accounting data.",
    icon: FileOutput,
    permission: "data_export.read",
  },
  {
    title: "Templates",
    description: "Control how invoices and payslips look.",
    detail: "Choose a design, upload your logo or signature, change colours and text, and use the saved design for downloads.",
    icon: FileText,
    permission: "templates.read",
  },
]

type FirstLoginTourProps = {
  open: boolean
  fullName: string
  can: (permission: WorkspacePermission) => boolean
  onComplete: () => void
}

export function FirstLoginTour({ open, fullName, can, onComplete }: FirstLoginTourProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const visibleSteps = tourSteps.filter((step) => !step.permission || can(step.permission))
  const activeIndex = Math.min(stepIndex, visibleSteps.length - 1)
  const step = visibleSteps[activeIndex]
  const isLastStep = activeIndex === visibleSteps.length - 1
  const Icon = step.icon

  useEffect(() => {
    if (open) setStepIndex(0)
  }, [open])

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby="product-tour-description"
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-2xl outline-none sm:p-8"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Icon className="size-6" aria-hidden="true" />
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              {activeIndex + 1} of {visibleSteps.length}
            </span>
          </div>

          <DialogPrimitive.Title className="text-2xl font-semibold tracking-tight">
            {activeIndex === 0 ? `Welcome, ${fullName.split(" ")[0]}!` : step.title}
          </DialogPrimitive.Title>
          <p className="mt-2 text-base font-medium">{step.description}</p>
          <DialogPrimitive.Description id="product-tour-description" className="mt-2 min-h-16 text-sm leading-6 text-muted-foreground">
            {step.detail}
          </DialogPrimitive.Description>

          <div className="mt-7 flex gap-1.5" aria-label="Tour progress">
            {visibleSteps.map((item, index) => (
              <span
                key={item.title}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  index <= activeIndex ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button variant="ghost" className="sm:mr-auto" onClick={onComplete}>
              Skip tour
            </Button>
            {activeIndex > 0 ? (
              <Button variant="outline" onClick={() => setStepIndex((current) => current - 1)}>
                Back
              </Button>
            ) : null}
            <Button
              onClick={() => {
                if (isLastStep) onComplete()
                else setStepIndex((current) => current + 1)
              }}
            >
              {isLastStep ? "Start using ChanaX" : "Next"}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
