import { useState } from "react"
import { Check, Clipboard } from "lucide-react"
import { Button } from "@/components/ui/button"

export function SubscriptionCode({ code, label = "Subscription code" }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  async function copy() {
    setCopyError(false)
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      setCopied(false)
      setCopyError(true)
    }
  }
  return <div className="min-w-0 rounded-lg border bg-muted/30 px-2 py-1">
    <div className="flex items-center gap-2">
      <div className="min-w-0"><p className="text-[10px] leading-4 text-muted-foreground">{label}</p><code className="block max-w-52 select-all break-all text-xs font-semibold" title={code}>{code}</code></div>
      <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => void copy()}>{copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}</Button>
    </div>
    {copied && !copyError ? <span role="status" className="text-[10px] text-muted-foreground">Copied</span> : null}
    {copyError ? <p role="alert" className="max-w-64 text-[10px] text-muted-foreground">Couldn't copy. Select the code to copy it manually.</p> : null}
  </div>
}
