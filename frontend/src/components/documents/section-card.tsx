import type * as React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface SectionCardProps {
  title: React.ReactNode
  /** Right-aligned companion of the title — a badge, a small control. */
  aside?: React.ReactNode
  dataCy?: string
  className?: string
  children: React.ReactNode
}

/**
 * The ONE frame every side section of the document detail page uses (totals, settlement, legal
 * archive, conformity, reconciliation): a plain `Card` with a compact header, so the sections read
 * as siblings rather than five hand-rolled `rounded-lg border p-4` boxes each spacing its heading a
 * little differently. Sections render their CONTENT only; the frame is never theirs to draw — that is
 * what keeps a section from ever ending up as a card inside a card when a screen places it in one.
 */
export function SectionCard({ title, aside, dataCy, className, children }: SectionCardProps) {
  return (
    <Card className={cn("gap-4 py-5", className)} data-cy={dataCy}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-5">
        <CardTitle className="text-sm">{title}</CardTitle>
        {aside}
      </CardHeader>
      <CardContent className="px-5">{children}</CardContent>
    </Card>
  )
}
