import { Wind } from "lucide-react"
import { Link } from "react-router-dom"

import { cn } from "@/lib/utils"

type BrandMarkProps = {
  compact?: boolean
  className?: string
}

export function BrandMark({ compact = false, className }: BrandMarkProps) {
  return (
    <Link
      to="/"
      className={cn("flex items-center gap-2.5 font-semibold tracking-tight", className)}
      aria-label="BreezyInvoice home"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Wind className="size-5" aria-hidden="true" />
      </span>
      {!compact && <span className="text-base">BreezyInvoice</span>}
    </Link>
  )
}
