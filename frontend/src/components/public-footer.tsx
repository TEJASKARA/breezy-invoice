import { Link } from "react-router-dom"

import { BrandMark } from "@/components/brand-mark"

const policyLinks = [
  { label: "Terms & Conditions", to: "/terms" },
  { label: "Privacy Policy", to: "/privacy" },
  { label: "Contact Us", to: "/contact" },
  { label: "Cancellation & Refunds", to: "/cancellation-refunds" },
]

export function PublicFooter() {
  return (
    <footer className="bg-[#062f5d] text-white">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <BrandMark tone="light" />
          <nav className="flex flex-wrap gap-x-5 gap-y-3 text-xs text-white/70" aria-label="Legal and support">
            {policyLinks.map((link) => (
              <Link key={link.to} to={link.to} className="transition-colors hover:text-white">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-6 border-t border-white/15 pt-5 text-xs text-white/55">
          © 2026 Azorix Technologies Private Limited · Co-developed by <a href="https://rizeforge.in" target="_blank" rel="noreferrer" className="underline decoration-white/35 underline-offset-2 transition-colors hover:text-white">RizeForge</a>
        </div>
      </div>
    </footer>
  )
}
