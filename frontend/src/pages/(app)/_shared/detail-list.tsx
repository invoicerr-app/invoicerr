import type * as React from "react"

import { cn } from "@/lib/utils"

interface DetailListProps {
  /** `pair` (default) lays terms out two per row from `sm` up; `single` keeps one per row. */
  columns?: "single" | "pair"
  className?: string
  children: React.ReactNode
}

/** A `<dl>` of label/value pairs — the read-only twin of `FormSection`'s two-column field grid, so
 *  a record's "view" reads in the same order its form writes it. */
export function DetailList({ columns = "pair", className, children }: DetailListProps) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", columns === "pair" && "sm:grid-cols-2", className)}>
      {children}
    </dl>
  )
}

interface DetailItemProps {
  label: React.ReactNode
  /** Rendered as an em dash when empty — a missing value stays a visible "nothing here" rather than
   *  a silently skipped row, so two records always line up term for term. */
  children?: React.ReactNode
  /** Spans the full row (a street address, a description). */
  wide?: boolean
  /** Mono face for identifiers and codes. */
  mono?: boolean
  dataCy?: string
}

export function DetailItem({ label, children, wide, mono, dataCy }: DetailItemProps) {
  const empty = children === undefined || children === null || children === "" || children === false
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")} data-cy={dataCy}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 break-words text-sm text-foreground",
          mono && "font-mono",
          empty && "text-muted-foreground",
        )}
      >
        {empty ? "—" : children}
      </dd>
    </div>
  )
}

interface DetailSectionProps {
  title: React.ReactNode
  aside?: React.ReactNode
  dataCy?: string
  children: React.ReactNode
}

/** A titled block of a record's "view" — same small uppercase title as `FormSection`, same divider
 *  between siblings. */
export function DetailSection({ title, aside, dataCy, children }: DetailSectionProps) {
  return (
    <section className="border-t py-5 first:border-t-0 first:pt-0 last:pb-0" data-cy={dataCy}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}
