import type * as React from "react"
import { useEffect, useState } from "react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * Tracks whether a scroll container still has content below its visible edge - the one fact a
 * dialog footer needs to decide whether to draw its "there is more" fade. Re-measured on scroll, on
 * resize, and whenever the container's own content grows (a conditional section appearing).
 *
 * Takes the ELEMENT (from a callback ref held in state), not a ref object: dialog content mounts
 * through a Radix portal one commit after the component itself, so an effect keyed on a plain ref
 * sees `null` on its only run and never measures anything.
 */
function useHasContentBelow(el: HTMLDivElement | null) {
  const [hasMore, setHasMore] = useState(false)
  useEffect(() => {
    if (!el) return
    const measure = () => setHasMore(el.scrollHeight - el.clientHeight - el.scrollTop > 1)
    measure()
    el.addEventListener("scroll", measure, { passive: true })
    // Feature-detected: jsdom (the unit-test runtime) has no ResizeObserver; the cue then degrades
    // to "measured on scroll only" rather than crashing the dialog.
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure)
    observer?.observe(el)
    for (const child of el.children) observer?.observe(child)
    return () => {
      el.removeEventListener("scroll", measure)
      observer?.disconnect()
    }
  }, [el])
  return hasMore
}

interface FormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  /** The footer's controls - ONE `default` button (the primary action), the rest `outline`. */
  footer: React.ReactNode
  dataCy?: string
  /** A width class for the dialog (`sm:max-w-2xl` by default). */
  className?: string
  children: React.ReactNode
}

/**
 * The client view dialog's shell (client-view.tsx): a fixed header, a scrolling body, and a footer
 * that never scrolls away holding the single primary button. The footer draws a fade over the body's
 * bottom edge while there is content under the fold - the old single-scroll dialogs hid their only
 * primary button under it with no cue, and a fresh client form (~2 screens tall) was the worst case.
 * Same shape the document create dialog already holds, so a user learns it once.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  footer,
  dataCy,
  className,
  children,
}: FormDialogProps) {
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null)
  const hasContentBelow = useHasContentBelow(bodyEl)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("flex max-h-[90vh] flex-col gap-0 p-0", className ?? "sm:max-w-2xl")}
        dataCy={dataCy}
      >
        <DialogHeader className="border-b px-6 py-4 pe-12">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={setBodyEl} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {children}
          </div>
          {/* Outside the scroll container (a fixed child of one would scroll with it); transitions
            on opacity, not display, so it never pops. */}
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-background to-transparent transition-opacity duration-150",
              hasContentBelow ? "opacity-100" : "opacity-0",
            )}
          />
        </div>
        <div className="flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end">
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface FormSectionProps {
  title: React.ReactNode
  /** `single` keeps every field full-width (a short form); `pair` lays them out two per row from
   *  `sm` up - a field spanning the row adds `sm:col-span-2` itself. */
  columns?: "single" | "pair"
  dataCy?: string
  children: React.ReactNode
}

/**
 * A titled group of fields inside a `FormDialog` body - sections stack with a divider between them,
 * so a long form reads as "Identity / Contact / Address" rather than one undifferentiated column.
 * The title is a short semibold label, deliberately quieter than the dialog's own title.
 */
export function FormSection({ title, columns = "pair", dataCy, children }: FormSectionProps) {
  return (
    <section className="border-t py-5 first:border-t-0 first:pt-0 last:pb-0" data-cy={dataCy}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className={cn("mt-3 grid gap-4", columns === "pair" && "sm:grid-cols-2")}>{children}</div>
    </section>
  )
}
