import { Ellipsis, Search } from "lucide-react"
import type * as React from "react"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * The list grammar every data screen shares with the document list (components/documents/
 * document-list.tsx): a header with a search box, filter chips carrying counts and ONE filled
 * "New …" button; rows made of an identity block, a figures slot in the mono face, one contextual
 * outline action and a "more" menu; a skeleton shaped like a row. Below `sm` the same DOM re-flows
 * into a card per element through grid `order`/`col-span` alone, so every `data-cy` exists exactly
 * once whatever the viewport. The document list keeps its own copy of these pieces because its
 * rows are driven by descriptors; the shapes here are the plain-data twin.
 */

/** A row's grid — see `ListRow` on why the desktop columns beyond the first are `auto`. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:gap-4"

interface ListSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  dataCy?: string
  className?: string
}

/** The header's search box — icon inside, `type="search"` so the browser offers its own clear. */
export function ListSearch({ value, onChange, placeholder, dataCy, className }: ListSearchProps) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full pl-9"
        data-cy={dataCy}
      />
    </div>
  )
}

interface FilterChipProps {
  label: string
  count?: number
  active: boolean
  onClick: () => void
  dataCy?: string
  /** A state (not a category) shows a coloured dot before its label: `success` for the live one,
   *  `muted` for the dormant one. A category (a role, a type) carries no dot at all — colour
   *  means "state" here and nowhere else, which is what the old three-coloured chips lost. */
  tone?: "success" | "muted" | "warning"
}

const DOT_CLASSES: Record<NonNullable<FilterChipProps["tone"]>, string> = {
  success: "bg-success-foreground",
  muted: "bg-muted-foreground",
  warning: "bg-warning-foreground",
}

/** One filter as a pressed/unpressed pill — a real `<button aria-pressed>`, never a `Badge` with
 *  an onClick. Active = filled with the foreground ink, not the primary blue, so the header keeps a
 *  single blue control. */
export function FilterChip({ label, count, active, onClick, dataCy, tone }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/70",
      )}
      data-cy={dataCy}
    >
      {tone && (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", active ? "bg-background/80" : DOT_CLASSES[tone])}
        />
      )}
      <span>{label}</span>
      {count !== undefined && (
        <span className={cn("tabular-nums text-xs", active ? "text-background/70" : "text-muted-foreground")}>
          {count}
        </span>
      )}
    </button>
  )
}

interface FilterChipGroupProps {
  label: string
  dataCy?: string
  children: React.ReactNode
}

/** A single scrolling line of chips on a phone rather than a wrapping cloud: `-mx-6 px-6` lets the
 *  pills run to the card's edge and the scroll start where the header's padding starts. */
export function FilterChipGroup({ label, dataCy, children }: FilterChipGroupProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-6 flex gap-2 overflow-x-auto px-6 py-0.5 [scrollbar-width:none]"
      data-cy={dataCy}
    >
      {children}
    </div>
  )
}

interface ListRowProps {
  /** Title line + secondary line: name, badges, then the meta. */
  identity: React.ReactNode
  /** Figures for the row (a price, a rate, counts) — right-aligned on a desktop, under the identity
   *  on a phone. Rendered in the mono face by the caller (`amount`). */
  figures?: React.ReactNode
  /** The ONE contextual action — an `outline` button. */
  primary?: React.ReactNode
  /** The "more" menu (`ListRowMenu`), or any small control cluster. */
  menu?: React.ReactNode
  /** The whole row opens the record for a pointer; keyboard users reach the same through the
   *  title control the caller renders inside `identity`. */
  onOpen?: () => void
  selected?: boolean
  dataCy?: string
  className?: string
}

/**
 * One record as a row. Desktop: identity · figures · primary · menu on one line; phone: identity
 * and menu on the first line, figures and primary on the second. Every control slot stops its
 * clicks from bubbling to the row's own `onOpen` — an action and "open this record" are two
 * different intents.
 */
export function ListRow({
  identity,
  figures,
  primary,
  menu,
  onOpen,
  selected,
  dataCy,
  className,
}: ListRowProps) {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation()
  return (
    <div
      className={cn(
        "px-4 py-3 transition-colors duration-150 sm:px-6",
        onOpen && "cursor-pointer hover:bg-accent/40",
        selected && "bg-accent/50",
        className,
      )}
      onClick={onOpen}
      aria-selected={selected}
      data-cy={dataCy}
    >
      <div className={ROW_GRID}>
        <div className="order-1 min-w-0">{identity}</div>
        <div
          className={cn(
            "order-3 text-sm text-foreground sm:order-2 sm:text-right",
            !figures && "hidden sm:block",
          )}
        >
          {figures}
        </div>
        <div
          className={cn("order-4 flex justify-end sm:order-3", !primary && "hidden sm:flex")}
          onClick={stop}
          onKeyDown={stop}
        >
          {primary}
        </div>
        <div
          className={cn("order-2 flex items-center justify-end gap-1 sm:order-4", !menu && "hidden sm:flex")}
          onClick={stop}
          onKeyDown={stop}
        >
          {menu}
        </div>
      </div>
    </div>
  )
}

interface ListRowMenuProps {
  /** The accessible name of the trigger ("More actions"). */
  label: string
  dataCy?: string
  contentDataCy?: string
  children: React.ReactNode
}

/** The row's "⋯" menu. `Tooltip` wraps the trigger from OUTSIDE (nested `asChild` Slots onto one
 *  real `<button>`) rather than through `Button`'s own `tooltip` prop, which would wrap the DOM node
 *  in a component `DropdownMenuTrigger asChild` cannot clone. */
export function ListRowMenu({ label, dataCy, contentDataCy, children }: ListRowMenuProps) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={label} dataCy={dataCy}>
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-48" data-cy={contentDataCy}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A skeleton row shaped like `ListRow` — badge, two text lines, a figure, a button, the menu dot
 *  — so nothing jumps once real rows arrive. */
function ListSkeletonRow() {
  return (
    <div className="px-4 py-3 sm:px-6" aria-hidden="true">
      <div className={ROW_GRID}>
        <div className="order-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-14 rounded-md" />
          </div>
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="order-3 h-4 w-20 sm:order-2 sm:justify-self-end" />
        <Skeleton className="order-4 h-8 w-16 justify-self-end sm:order-3" />
        <Skeleton className="order-2 size-9 justify-self-end rounded-md sm:order-4" />
      </div>
    </div>
  )
}

/** Literal siblings rather than a `.map` over a placeholder array: a loading placeholder has no
 *  identity for a key to carry. */
export function ListSkeleton({ dataCy }: { dataCy?: string }) {
  return (
    <div className="divide-y" data-cy={dataCy}>
      <ListSkeletonRow />
      <ListSkeletonRow />
      <ListSkeletonRow />
    </div>
  )
}

/** Placeholder pills where the chips will land, so the header keeps its height and the rows below
 *  don't drop by a line once the counts arrive. */
export function FilterChipSkeleton() {
  return (
    <div className="flex gap-2 py-0.5" aria-hidden="true">
      <Skeleton className="h-8 w-16 rounded-full" />
      <Skeleton className="h-8 w-20 rounded-full" />
      <Skeleton className="h-8 w-20 rounded-full" />
    </div>
  )
}
