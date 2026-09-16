import { Check, Ellipsis } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { type ComponentProps, type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * The ONE grammar every settings tab (and the account pages) is written in, so twenty-one screens
 * that each used to draw their own `h1` (three sizes), their own card header spacing and their own
 * idea of where "Save" goes now read as one place:
 *
 * - `SettingsPage`    — the tab's title + one-line description, an optional header action.
 * - `SettingsSection` — a plain `Card` with a compact header (title, description, an `aside` on the
 *                       right) and an optional footer for the section's actions. Sections render
 *                       their CONTENT only; the frame is never theirs to draw (the same rule
 *                       `components/documents/section-card.tsx` holds for the document page), which
 *                       is what keeps a settings screen from ending up as a card inside a card.
 * - `SettingsFormFooter` + `useSavedFlash` — the right-aligned primary of a form, with the discreet
 *                       "Saved" mark that fades in after a successful write (a toast already fires;
 *                       this is the static cue that stays once the toast is gone).
 * - `SettingsList` / `SettingsListRow` / `SettingsRowMenu` — the same row grammar as the document
 *                       list (`components/documents/document-list.tsx`): a chip, a title, a meta
 *                       line, ONE contextual action and a "⋯" menu for the rest; below `sm` the row
 *                       re-flows into a card through grid order alone, so every `data-cy` exists
 *                       exactly once whatever the viewport.
 */

interface SettingsPageProps {
  title: ReactNode
  description?: ReactNode
  /** The page's own header action (a filled button only when the whole tab has no other primary). */
  actions?: ReactNode
  dataCy?: string
  className?: string
  children: ReactNode
}

export function SettingsPage({
  title,
  description,
  actions,
  dataCy,
  className,
  children,
}: SettingsPageProps) {
  return (
    <div className={cn("grid gap-6", className)} data-cy={dataCy}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight text-balance">{title}</h1>
          {description && (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground text-pretty">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  )
}

interface SettingsSectionProps {
  title?: ReactNode
  description?: ReactNode
  /** Right-aligned companion of the title — a status chip, a small control. */
  aside?: ReactNode
  /** The section's own actions, drawn under a hairline: use `SettingsFormFooter` for a form. */
  footer?: ReactNode
  /** `destructive` frames an irreversible action; `warning` a reversible-but-serious one — the two
   *  severity levels the danger zone keeps (a reset that keeps the account vs one that does not). */
  tone?: "default" | "destructive" | "warning"
  dataCy?: string
  className?: string
  contentClassName?: string
  children?: ReactNode
}

export function SettingsSection({
  title,
  description,
  aside,
  footer,
  tone = "default",
  dataCy,
  className,
  contentClassName,
  children,
}: SettingsSectionProps) {
  const hasHeader = title || description || aside
  return (
    <Card
      className={cn(
        "gap-5 py-5",
        tone === "destructive" && "border-destructive/40",
        tone === "warning" && "border-warning-foreground/30",
        className,
      )}
      data-cy={dataCy}
    >
      {hasHeader && (
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5">
          <div className="min-w-0 flex-1 grid gap-1">
            {title && (
              <CardTitle
                className={cn(
                  "flex flex-wrap items-center gap-2 text-base",
                  tone === "destructive" && "text-destructive",
                  tone === "warning" && "text-warning-foreground",
                )}
              >
                {title}
              </CardTitle>
            )}
            {description && <CardDescription className="text-pretty">{description}</CardDescription>}
          </div>
          {aside && <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>}
        </CardHeader>
      )}
      {children !== undefined && children !== null && children !== false && (
        <CardContent className={cn("px-5", contentClassName)}>{children}</CardContent>
      )}
      {footer && <div className="border-t px-5 pt-4">{footer}</div>}
    </Card>
  )
}

/** A titled group of fields INSIDE a section — a `fieldset` whose legend is a small caps label, so
 *  "Identifiers" or "Peppol routing" read as sub-groups of the company section rather than as a
 *  nested card of their own. */
export function SettingsFieldGroup({
  legend,
  description,
  dataCy,
  className,
  children,
}: {
  legend: ReactNode
  description?: ReactNode
  dataCy?: string
  className?: string
  children: ReactNode
}) {
  return (
    <fieldset className={cn("grid gap-4 border-t pt-4", className)} data-cy={dataCy}>
      <div className="grid gap-1">
        <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {legend}
        </legend>
        {description && <p className="text-xs text-muted-foreground text-pretty">{description}</p>}
      </div>
      {children}
    </fieldset>
  )
}

/**
 * `[saved, flash]`: `flash()` raises `saved` for a short moment after a successful write, long
 * enough to be read, short enough not to lie about a form that has since been edited again. The
 * timer is cleared on unmount so a fast tab switch never sets state on a dead component.
 */
export function useSavedFlash(durationMs = 2400): [boolean, () => void] {
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const flash = useCallback(() => {
    setSaved(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaved(false), durationMs)
  }, [durationMs])
  return [saved, flash]
}

/** The "Saved" mark: always in the DOM (no layout shift when it appears), faded in only while
 *  `visible`, and hidden from assistive tech otherwise — the success toast is what a screen reader
 *  hears; this is the eye's static confirmation. */
export function SavedIndicator({ visible, dataCy }: { visible: boolean; dataCy?: string }) {
  const { t } = useTranslation()
  return (
    <span
      aria-hidden={!visible}
      data-saved={visible ? "true" : undefined}
      data-cy={dataCy}
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground transition-opacity duration-200 ease-out",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <Check className="size-3.5 text-success-foreground" aria-hidden="true" />
      {t("settings.common.saved")}
    </span>
  )
}

/** A form section's footer: an optional hint on the left, the "Saved" mark and the actions on the
 *  right — the ONE filled button of the tab lives here. */
export function SettingsFormFooter({
  saved = false,
  hint,
  dataCy,
  className,
  children,
}: {
  saved?: boolean
  hint?: ReactNode
  dataCy?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-3", className)} data-cy={dataCy}>
      {hint && <p className="mr-auto text-xs text-muted-foreground text-pretty">{hint}</p>}
      <SavedIndicator visible={saved} />
      {children}
    </div>
  )
}

/**
 * A footer that follows the reader down a form too long for one screen (the company tab): sticky
 * at the bottom of the scroll container, on a translucent ground so the last fields stay legible
 * under it. `-mx-*` cancels the page gutter so the hairline runs edge to edge like a real toolbar.
 */
export function SettingsStickyFooter({
  saved = false,
  dataCy,
  children,
}: {
  saved?: boolean
  dataCy?: string
  children: ReactNode
}) {
  return (
    <div
      className="sticky bottom-0 z-10 -mx-4 -mb-6 mt-2 border-t bg-background/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:-mx-6 sm:px-6"
      data-cy={dataCy}
    >
      <div className="flex flex-wrap items-center justify-end gap-3">
        <SavedIndicator visible={saved} />
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Lists

/** The bordered, hairline-divided container every settings list shares. */
export function SettingsList({
  dataCy,
  className,
  children,
  ...props
}: { dataCy?: string; className?: string; children: ReactNode } & Omit<
  ComponentProps<"div">,
  "children" | "className"
>) {
  return (
    <div
      role="list"
      className={cn("divide-y overflow-hidden rounded-lg border bg-card", className)}
      data-cy={dataCy}
      {...props}
    >
      {children}
    </div>
  )
}

/** Shared with the skeleton row so nothing jumps once real rows arrive. */
const LIST_ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"

interface SettingsListRowProps {
  /** Leading decoration — an icon in a muted disc, an avatar, a colour swatch. */
  leading?: ReactNode
  /** The row's status chip(s), drawn inline before the title. */
  badge?: ReactNode
  title: ReactNode
  /** The secondary line: dates, an e-mail, a URL — in the muted colour, wrapping freely. */
  meta?: ReactNode
  /** ONE contextual action (an `outline`/`secondary` button, never `default`). */
  primary?: ReactNode
  /** The "⋯" menu (`SettingsRowMenu`) or any trailing control(s). */
  menu?: ReactNode
  dataCy?: string
  className?: string
  /** Extra content under the whole row (an inline editor, an expanded detail). */
  children?: ReactNode
}

export function SettingsListRow({
  leading,
  badge,
  title,
  meta,
  primary,
  menu,
  dataCy,
  className,
  children,
}: SettingsListRowProps) {
  return (
    <div role="listitem" className={cn("px-4 py-3", className)} data-cy={dataCy}>
      <div className={LIST_ROW_GRID}>
        <div className="order-1 flex min-w-0 items-start gap-3">
          {leading && <div className="mt-0.5 shrink-0">{leading}</div>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {badge}
              <div className="min-w-0 break-words text-sm font-medium text-foreground">{title}</div>
            </div>
            {meta && (
              <div className="mt-0.5 text-xs text-muted-foreground break-words [&_a]:underline-offset-4">
                {meta}
              </div>
            )}
          </div>
        </div>
        {primary && (
          <div className="order-3 col-span-2 flex justify-end sm:order-2 sm:col-span-1">{primary}</div>
        )}
        {menu && <div className="order-2 flex items-center justify-end gap-1 sm:order-3">{menu}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}

/** A loading list shaped like its rows — a chip, two text lines, a button, a menu dot. */
export function SettingsListSkeleton({ rows = 3, dataCy }: { rows?: number; dataCy?: string }) {
  return (
    <SettingsList dataCy={dataCy} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        // Placeholder rows carry no identity for a key to represent; the index is the only handle.
        <div key={index} className="px-4 py-3">
          <div className={LIST_ROW_GRID}>
            <div className="order-1 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-3 w-56" />
            </div>
            <div className="order-3 flex justify-end sm:order-2">
              <Skeleton className="h-8 w-20" />
            </div>
            <div className="order-2 flex justify-end sm:order-3">
              <Skeleton className="size-8" />
            </div>
          </div>
        </div>
      ))}
    </SettingsList>
  )
}

export interface SettingsRowMenuItem {
  label: ReactNode
  icon?: LucideIcon
  onSelect: () => void
  disabled?: boolean
  /** Drawn in the destructive colour and separated from the rest — removals, revocations. */
  destructive?: boolean
  dataCy?: string
}

/**
 * The "⋯" menu of a list row. `Tooltip` wraps the trigger from OUTSIDE (three nested `asChild`
 * Slots onto one real button) rather than through `Button`'s own `tooltip` prop, which would wrap
 * the DOM node in a component `DropdownMenuTrigger asChild` cannot clone — the same constraint
 * `document-list.tsx`'s row menu documents.
 */
export function SettingsRowMenu({
  items,
  label,
  dataCy,
}: {
  items: SettingsRowMenuItem[]
  label?: string
  dataCy?: string
}) {
  const { t } = useTranslation()
  const menuLabel = label ?? t("settings.common.rowMenu")
  const regular = items.filter((item) => !item.destructive)
  const destructive = items.filter((item) => item.destructive)
  if (items.length === 0) return null
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={menuLabel} dataCy={dataCy}>
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{menuLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        data-cy={dataCy ? `${dataCy}-content` : undefined}
      >
        {regular.map((item, index) => (
          <DropdownMenuItem
            // Menu entries are positional by nature (label nodes need not be strings).
            key={index}
            disabled={item.disabled}
            onSelect={item.onSelect}
            data-cy={item.dataCy}
          >
            {item.icon && <item.icon aria-hidden="true" />}
            {item.label}
          </DropdownMenuItem>
        ))}
        {regular.length > 0 && destructive.length > 0 && <DropdownMenuSeparator />}
        {destructive.map((item, index) => (
          <DropdownMenuItem
            key={index}
            variant="destructive"
            disabled={item.disabled}
            onSelect={item.onSelect}
            data-cy={item.dataCy}
          >
            {item.icon && <item.icon aria-hidden="true" />}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A contextual icon in a muted disc — the `leading` slot of a row, or a section's own mark. */
export function SettingsIconDisc({
  icon: Icon,
  tone = "default",
  className,
}: {
  icon: LucideIcon
  tone?: "default" | "success" | "warning" | "destructive"
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 items-center justify-center rounded-full",
        tone === "default" && "bg-muted text-muted-foreground",
        tone === "success" && "bg-success text-success-foreground",
        tone === "warning" && "bg-warning text-warning-foreground",
        tone === "destructive" && "bg-destructive-soft text-destructive-soft-foreground",
        className,
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  )
}
