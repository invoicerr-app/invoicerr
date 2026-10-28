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

/** A sheet and a pencil drawn from tokens, so it reads in both themes. */
function SheetAndPencil() {
  return (
    <svg
      width="136"
      height="96"
      viewBox="20 4 136 112"
      fill="none"
      aria-hidden="true"
      className="text-primary"
    >
      <g transform="rotate(-4 81 62)">
        <rect
          x="38"
          y="10"
          width="86"
          height="104"
          rx="6"
          fill="var(--paper-bg)"
          stroke="var(--border)"
          strokeWidth="2"
        />
        <path d="M52 34h38M52 48h58M52 62h50" stroke="var(--border)" strokeWidth="3" strokeLinecap="round" />
        <path d="M62 100h44" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g transform="rotate(32 122 70)">
        <rect x="112" y="26" width="12" height="62" rx="3" fill="currentColor" />
        <path d="M112 88h12l-6 14z" fill="var(--foreground)" />
        <rect x="112" y="26" width="12" height="9" rx="3" fill="var(--accent)" />
      </g>
    </svg>
  )
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
      {tone === "default" && size === "default" ? (
        <SheetAndPencil />
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            "flex items-center justify-center rounded-full",
            size === "sm" ? "size-10" : "size-14",
            tone === "destructive" ? "bg-warning text-warning-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className={size === "sm" ? "size-5" : "size-6"} strokeWidth={1.75} />
        </div>
      )}
      <h2
        className={cn(
          "text-foreground text-balance",
          size === "sm" ? "mt-3 font-sans text-sm font-semibold" : "mt-4 text-[22px] leading-tight",
        )}
      >
        {title}
      </h2>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink-2 text-pretty">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
      {docHref && docLabel && (
        <a
          href={docHref}
          target="_blank"
          rel="noreferrer"
          className="focus-ring mt-3 rounded-sm text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          {docLabel}
        </a>
      )}
    </div>
  )
}

export { EmptyState }
