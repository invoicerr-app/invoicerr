import { BrandMark } from "@/components/brand-mark"
import { cn } from "@/lib/utils"

interface BrandWordmarkProps {
  /** `sm` for a footer line ("Powered by …"), `default` for a page or card header. */
  size?: "default" | "sm"
  className?: string
}

/**
 * The product's name set in the heading face, with the mark ("07 Faille" — see `BrandMark`'s own
 * header) in the `data-slot="brand-mark"` seat in front of it — 24 px at `default`, 16 px at `sm`
 * (the "Powered by" footer line). Neither the mark nor the wordmark span sets its own color: `body`
 * already carries `text-foreground` (`index.css`), and `currentColor` on the mark's fill inherits
 * whatever ancestor sets — so a single className flip on the outer span (the `PublicPageShell`
 * footer's `text-muted-foreground`) recolors both together, never just the text.
 */
export function BrandWordmark({ size = "default", className }: BrandWordmarkProps) {
  return (
    <span className={cn("inline-flex items-center", size === "sm" ? "gap-1.5" : "gap-2", className)}>
      <BrandMark className={size === "sm" ? "size-4" : "size-6"} data-slot="brand-mark" />
      <span
        className={cn("font-heading font-semibold tracking-tight", size === "sm" ? "text-sm" : "text-lg")}
      >
        Invoicerr
      </span>
    </span>
  )
}
