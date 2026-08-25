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
      className={cn("inline-flex items-center", className)}
      aria-label="ChanaX home"
    >
      <img
        src={compact ? "/chanax-icon.png" : "/chanax-wordmark.png"}
        alt={compact ? "" : "ChanaX"}
        className={cn(
          "object-contain",
          compact
            ? "size-9"
            : "h-9 w-auto max-w-[142px] dark:brightness-0 dark:invert",
        )}
      />
    </Link>
  )
}
