import type { LucideIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

interface EmptyStateProps extends Omit<React.ComponentProps<"div">, "title"> {
  /** The contextual icon — the same one the list's rows or its sidebar entry use, so the empty
   *  screen still reads as "this place", not as a generic placeholder. */
  icon: LucideIcon
  title: string
  description?: string
  /** The ONE thing to do next (a `Button`), or nothing when there is no sensible next step here
   *  (e.g. a country with no obligation at all). */
  action?: React.ReactNode
  /** An optional "read more" link — kept visually secondary, under the action. */
  docHref?: string
  docLabel?: string
  /** `destructive` for a failed load: the disc turns to the soft destructive fill and the block
   *  becomes a live region, so a screen reader hears the failure without being sent to hunt for it. */
  tone?: "default" | "destructive"
  /** `sm` for a block nested inside a settings card, where the full-size disc would outweigh the
   *  card it sits in. */
  size?: "default" | "sm"
}

/**
 * The one empty state every list in this app renders — a first visit, a search that matched
 * nothing, a load that failed — so the four different treatments the audit found ("grey text alone",
 * "centred sentence in a huge card", "icon + bold title", "icon + title + CTA") collapse into one
 * shape a reader learns once. The icon sits in a muted disc rather than floating grey: a disc gives
 * the eye a place to land in an otherwise blank area, which floating strokes do not.
 */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  docHref,
  docLabel,
  tone = "default",
  size = "default",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      role={tone === "destructive" ? "alert" : undefined}
      className={cn(
        "flex flex-col items-center px-6 text-center",
        size === "sm" ? "py-8" : "py-14",
        className,
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-full",
          size === "sm" ? "size-10" : "size-14",
          tone === "destructive"
            ? "bg-destructive-soft text-destructive-soft-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className={size === "sm" ? "size-5" : "size-6"} strokeWidth={1.5} />
      </div>
      <h3 className={cn("font-medium text-foreground text-balance", size === "sm" ? "mt-3 text-sm" : "mt-4")}>
        {title}
      </h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground text-pretty">{description}</p>
      )}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
      {docHref && docLabel && (
        <a
          href={docHref}
          target="_blank"
          rel="noreferrer"
          className="mt-3 rounded-sm text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {docLabel}
        </a>
      )}
    </div>
  )
}

export { EmptyState }
