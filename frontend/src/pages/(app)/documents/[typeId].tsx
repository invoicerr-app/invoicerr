import { FileQuestion } from "lucide-react"
import { useEffect, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router"
import { useTranslation } from "react-i18next"

import { DocumentList } from "@/components/documents/document-list"
import { DocumentUpsertDialog } from "@/components/documents/document-upsert-dialog"
import type { DocumentInstance } from "@/components/documents/types"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentInstances, useDocumentType } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/**
 * The one generic page: fetches a document type's descriptor and its saved instances, and renders
 * DocumentList (the table) plus DocumentUpsertDialog (create/edit) from them. Nothing here is
 * specific to "quote" or any other type — a plugin adding a document type needs no page of its own,
 * only a registered descriptor (and, on the frontend, a renderer per any new field kind it
 * introduces — see field-renderers/index.ts — plus, optionally, a custom slot component registered
 * in custom-registrations.ts, the one place allowed to name a type).
 */
export default function DocumentTypePage() {
  const { t } = useTranslation()
  const { typeId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const { data: descriptor, isLoading, error } = useDocumentType(typeId)
  const { data: instances = [], isLoading: instancesLoading } = useDocumentInstances(typeId)

  // undefined = the dialog is closed; null = creating a brand-new draft; a DocumentInstance = editing
  // that one. The list already hands over each instance's FULL `data` (see the backend's
  // listDocuments, which selects everything), so editing never needs a second fetch. This is a
  // SNAPSHOT, taken once when "Edit" is clicked — deliberately never re-derived from `instances` on
  // its own, so a background refetch (the async "send" mechanism's own polling, TODO.md item 22)
  // never silently overwrites field values the user may still be editing in the open form.
  const [dialogTarget, setDialogTarget] = useState<DocumentInstance | null | undefined>(undefined)
  // A cross-page "create, pre-linked" seed — TODO_CORRECTION.md C2's own hand-off: a DIFFERENT type's
  // own screen (e.g. an invoice's "Corriger" button, custom/invoice-correction-routes-button.tsx)
  // navigates HERE with `state.initialData` set, rather than trying to render a foreign type's create
  // dialog on its own page. Generic on purpose — this page still names no document type: whatever
  // seed a caller hands through router state is simply forwarded to
  // `DocumentUpsertDialog.initialData`, the exact same generic seed prop the received-invoice upload
  // flow already feeds its OWN, page-local dialog (see that component's own header) — the only
  // difference here is that the hand-off crosses a page NAVIGATION instead of staying inside one
  // component. Tracked SEPARATELY from `dialogTarget`: `onCreate` (the generic "+ New" button) also
  // sets `dialogTarget` to `null`, and must NOT resurrect a stale hand-off from an earlier visit — see
  // that handler below, which clears this every time it runs.
  const [createInitialData, setCreateInitialData] = useState<Record<string, unknown> | undefined>(undefined)

  // Reacts to `location.state` itself, NOT just to mounting: `/documents/:typeId` is one single
  // `Route` for every type (see router.ts, generated), so navigating from the invoice page to
  // `/documents/credit-note` re-renders this SAME component instance with a new `typeId` param rather
  // than mounting a fresh one — an effect with an EMPTY dependency array (mount-only) would silently
  // miss a hand-off that arrives this way, which is exactly how the real "Corriger" button's own
  // navigation reaches this page in production. Depending on `location.state`'s own IDENTITY (a fresh
  // object every time `navigate(path, { state })` is called) is what makes this fire exactly once per
  // genuine hand-off — the last statement below (`state: null`) is what turns "a second one" into a
  // no-op instead of an infinite loop: replacing history with a `null` state changes the identity ONE
  // more time (running this effect once more), but its own body finds no `initialData` and does
  // nothing. `location.pathname`/`navigate` are stable for the lifetime of a single route match;
  // only `location.state`'s own identity is meant to ever re-trigger this.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state identity only, see above.
  useEffect(() => {
    const seed = (location.state as { initialData?: Record<string, unknown> } | null)?.initialData
    if (!seed) return
    setCreateInitialData(seed)
    setDialogTarget(null)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state])

  // The LIVE record for whichever instance the dialog is open on — read from the SAME query cache
  // `instances` already is (useDocumentInstances' own `refetchInterval`, which keeps polling while
  // ANY instance is "sending"). Only `status`/`displayNumber`/`lastActionError` are taken from it
  // (see `dialogInstance` below) — never `data`, for the reason `dialogTarget`'s own comment gives.
  // This is what makes the dialog's own action buttons (e.g. "record-payment", only offered once an
  // invoice is genuinely "sent") and its error banner follow the record while it stays open, instead
  // of freezing at whatever the record looked like the moment "Edit" was clicked.
  const liveDialogTarget = dialogTarget
    ? instances.find((instance) => instance.id === dialogTarget.id)
    : undefined
  // The choice below is per-RECORD, not per-field: when `liveDialogTarget` exists, its three fields
  // are taken AS-IS, `null` included — a live `lastActionError: null` is INFORMATION (a re-send just
  // cleared it; see backend/src/modules/documents/persistence.ts's own comment: any ordinary write,
  // including the "sending" write a re-send starts with, resets it to null) rather than "no value,
  // fall back to the snapshot". A per-field `??` here would let a null LIVE error keep falling through
  // to `dialogTarget`'s frozen one, showing a dead "send_failed" message next to a record that has
  // already reached "sent". `dialogTarget` is only ever used whole, as the fallback for the other
  // case — no live record at all (the instance isn't in this page's own `instances`, e.g. it belongs
  // to a different type after a cross-type action) — which is the entire reason this fallback exists.
  const dialogInstance: DocumentInstance | undefined = dialogTarget
    ? liveDialogTarget
      ? {
          ...dialogTarget,
          status: liveDialogTarget.status,
          displayNumber: liveDialogTarget.displayNumber,
          lastActionError: liveDialogTarget.lastActionError,
        }
      : dialogTarget
    : undefined

  usePageHeader(descriptor?.label ?? typeId)

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !descriptor) {
    return (
      <div
        className="max-w-4xl mx-auto p-12 text-center text-muted-foreground"
        data-cy="document-type-unknown"
      >
        <FileQuestion className="mx-auto h-10 w-10 mb-3 opacity-50" />
        {t("documents.form.unknownType", { typeId })}
      </div>
    )
  }

  const handleActionSuccess = (result: DocumentInstance) => {
    // An action can create/update an instance of a DIFFERENT document type (e.g. the quote's
    // "convert-to-invoice" hands back a brand-new INVOICE) — this page only ever knows how to show
    // ITS OWN type's fields (they came from `descriptor`), so it navigates to the other type's own
    // page instead of trying to render a foreign record in this dialog. Nothing here names which
    // type that might be: `result.typeId` is read from the action's own response.
    //
    // Same-type success needs nothing here at all: DocumentForm already tracks its own current
    // id/status once the first save happens, and the list refetches on its own (useRunDocumentAction
    // invalidates the "documents" query) — so the dialog just stays open, showing the same record.
    if (result.typeId !== typeId) {
      setDialogTarget(undefined)
      navigate(`/documents/${result.typeId}`)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6" data-cy="document-type-page">
      <DocumentList
        descriptor={descriptor}
        instances={instances}
        isLoading={instancesLoading}
        onCreate={() => {
          // Never resurrect a stale navigation hand-off from an earlier visit — the generic "+ New"
          // button always means a genuinely blank record, whatever `createInitialData` still holds.
          setCreateInitialData(undefined)
          setDialogTarget(null)
        }}
        onEdit={(instance) => setDialogTarget(instance)}
        onActionSuccess={handleActionSuccess}
      />

      {dialogTarget !== undefined && (
        <DocumentUpsertDialog
          descriptor={descriptor}
          open
          onOpenChange={(open) => {
            if (open) return
            setDialogTarget(undefined)
            setCreateInitialData(undefined)
          }}
          instance={dialogInstance}
          initialData={createInitialData}
          onActionSuccess={handleActionSuccess}
        />
      )}
    </div>
  )
}
