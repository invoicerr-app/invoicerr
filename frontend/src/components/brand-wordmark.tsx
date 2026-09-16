import { cn } from "@/lib/utils"

interface BrandWordmarkProps {
  /** `sm` for a footer line ("Powered by …"), `default` for a page or card header. */
  size?: "default" | "sm"
  className?: string
}

/**
 * The product's name set in the heading face — the only brand element the app has today. The
 * `data-slot="brand-mark"` box in front of it is the 24 px seat reserved for the logo mark once one
 * is chosen: it is rendered empty (and hidden while empty, so the wordmark stays optically centred)
 * so that picking a mark later means filling one component, not touching every page that shows the
 * name.
 */
export function BrandWordmark({ size = "default", className }: BrandWordmarkProps) {
  return (
    <span className={cn("inline-flex items-center", size === "sm" ? "gap-1.5" : "gap-2", className)}>
      {size === "default" && (
        <span data-slot="brand-mark" aria-hidden="true" className="size-6 shrink-0 empty:hidden" />
      )}
      <span
        className={cn(
          "font-heading font-semibold tracking-tight text-foreground",
          size === "sm" ? "text-sm" : "text-lg",
        )}
      >
        Invoicerr
      </span>
    </span>
  )
}
