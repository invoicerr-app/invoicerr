import type * as React from "react"

import { cn } from "@/lib/utils"

/** A `<dl>` of label/value pairs, two per row from `sm` up - the read-only twin of `FormSection`'s
 *  two-column field grid, so a record's "view" reads in the same order its form writes it. */
export function DetailList({ children }: { children: React.ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
}

interface DetailItemProps {
  label: React.ReactNode
  /** Rendered as an em dash when empty - a missing value stays a visible "nothing here" rather than
   *  a silently skipped row, so two records always line up term for term. */
  children?: React.ReactNode
  /** Spans the full row (a street address, a description). */
  wide?: boolean
}

export function DetailItem({ label, children, wide }: DetailItemProps) {
  const empty = children === undefined || children === null || children === "" || children === false
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 break-words text-sm text-foreground", empty && "text-muted-foreground")}>
        {empty ? "—" : children}
      </dd>
    </div>
  )
}

interface DetailSectionProps {
  title: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
}

/** A titled block of a record's "view" - same short semibold title as `FormSection`, same divider
 *  between siblings. */
export function DetailSection({ title, aside, children }: DetailSectionProps) {
  return (
    <section className="border-t py-5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}
