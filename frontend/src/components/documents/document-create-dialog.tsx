import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"

import {
  DocumentActionButton,
  DocumentActionParamsHost,
  DocumentFormFields,
} from "@/components/documents/document-form"
import { DocumentTotals, useDocumentTotals } from "@/components/documents/document-totals"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { useDocumentForm } from "@/components/documents/use-document-form"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form } from "@/components/ui/form"
import { cn } from "@/lib/utils"

interface DocumentCreateDialogProps {
  descriptor: DocumentTypeDescriptor
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Seed values for the brand-new record's form. Generic on purpose, not tied to any one document
   * type: the received-invoice upload flow (custom/received-invoice-upload-button.tsx) pre-fills
   * extracted fields (and the system-only `fileRef`/`fileName`/`fileMime` — see
   * received-invoice.descriptor.ts's own header on why those are never declared `fields`), and the
   * correction-routes dialog hands a pre-linked `invoice` through router state ([typeId]/index.tsx).
   */
  initialData?: Record<string, unknown>
}

/**
 * Tracks whether a scroll container still has content below its visible edge — the one fact the
 * dialog's footer needs to know whether to draw its "there is more" fade. Re-measured on scroll, on
 * resize, and whenever the container's own content grows (a row added, a B2G field appearing).
 *
 * Takes the ELEMENT (from a callback ref held in state), not a ref object: the dialog's content is
 * rendered through a Radix portal, which mounts one commit later than the component itself — an
 * effect keyed on a plain ref sees `null` on its only run and never measures anything at all
 * (verified live: the fade stayed at opacity 0 over a 779px body in a 668px viewport).
 */
function useHasContentBelow(el: HTMLDivElement | null) {
  const [hasMore, setHasMore] = useState(false)
  useEffect(() => {
    if (!el) return
    const measure = () => setHasMore(el.scrollHeight - el.clientHeight - el.scrollTop > 1)
    measure()
    el.addEventListener("scroll", measure, { passive: true })
    // Feature-detected: jsdom (the unit-test runtime) has no ResizeObserver, and the cue degrades
    // to "measured on scroll only" there rather than crashing the whole dialog.
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

/** The totals under the lines, with their divider — only once there is something to total, so an
 *  empty form never ends on an orphan rule. Its own component so `useDocumentTotals` runs inside the
 *  `<Form>` provider the dialog mounts. */
function CreateDialogTotals({ descriptor }: { descriptor: DocumentTypeDescriptor }) {
  const totals = useDocumentTotals(descriptor)
  if (!totals) return null
  return (
    <div className="border-t pt-4">
      <DocumentTotals descriptor={descriptor} />
    </div>
  )
}

/**
 * The CREATE surface for ANY document type, as ONE short modal: fields, lines, totals — and a
 * footer that never scrolls away, holding the first save. Everything that only makes sense once a
 * record EXISTS (settlement, legal archive, conformity, reconciliation, the full action set) lives
 * on the record's own page (document-detail.tsx), which is exactly where a successful first save
 * lands: this dialog closes itself and navigates there, for the type the ACTION hands back — never
 * the type this dialog was opened for, which differ the moment an action creates a foreign record
 * (a quote's "convert-to-invoice"; today no create-time action does, the rule still holds).
 *
 * The footer draws a fade over the body's bottom edge while there is content below the fold: the
 * old single-scroll modal hid its only primary button ~110px under the fold with no cue at all, and
 * the first thing a user did on a fresh form was look for the button that wasn't there.
 */
export function DocumentCreateDialog({
  descriptor,
  open,
  onOpenChange,
  initialData,
}: DocumentCreateDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null)
  const hasContentBelow = useHasContentBelow(bodyEl)

  const state = useDocumentForm({
    descriptor,
    initialData,
    onActionSuccess: (result: DocumentInstance) => {
      onOpenChange(false)
      navigate(`/documents/${result.typeId}/${result.id}`)
    },
  })

  // The first runnable action is the ONE default button (the type's own "Save draft"/"Save");
  // anything else a never-saved record can already run is offered alongside, quieter.
  const firstRunnable = state.availableActions.find((action) => !action.policyBlockedReason)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-2xl"
        data-cy="document-create-dialog"
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t("documents.form.newTitle", { label: descriptor.label })}</DialogTitle>
        </DialogHeader>

        <Form {...state.form}>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={setBodyEl} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <DocumentFormFields descriptor={descriptor} state={state} />
              <CreateDialogTotals descriptor={descriptor} />
            </div>
            {/* The fade lives OUTSIDE the scroll container (a fixed child of one would scroll with
                it) and only while there is something under the fold — transitions on opacity, not
                display, so it never pops. */}
            <div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-background to-transparent transition-opacity duration-150",
                hasContentBelow ? "opacity-100" : "opacity-0",
              )}
            />
          </div>

          <div className="flex flex-wrap items-start justify-end gap-2 border-t px-6 py-4">
            {state.availableActions.map((action) => (
              <DocumentActionButton
                key={action.id}
                descriptor={descriptor}
                action={action}
                state={state}
                variant={action.id === firstRunnable?.id ? "default" : "outline"}
                captions
                className="flex flex-col items-end"
              />
            ))}
          </div>

          <DocumentActionParamsHost state={state} />
        </Form>
      </DialogContent>
    </Dialog>
  )
}
