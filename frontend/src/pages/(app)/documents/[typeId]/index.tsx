import { FileQuestion } from "lucide-react"
import { useEffect, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router"
import { useTranslation } from "react-i18next"

import { DocumentCreateDialog } from "@/components/documents/document-create-dialog"
import { DocumentList } from "@/components/documents/document-list"
import type { DocumentInstance } from "@/components/documents/types"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentInstances, useDocumentType } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/**
 * The one generic list page: fetches a document type's descriptor and its saved instances, and
 * renders DocumentList (the cards) plus DocumentCreateDialog (a new record) from them. Opening a
 * saved record is a NAVIGATION, to that record's own page (`[typeId]/[id].tsx`) — never a modal
 * over this list. Nothing here is specific to "quote" or any other type — a plugin adding a
 * document type needs no page of its own, only a registered descriptor (and, on the frontend, a
 * renderer per any new field kind it introduces — see field-renderers/index.ts — plus, optionally,
 * a custom slot component registered in custom-registrations.ts, the one place allowed to name a
 * type).
 */
export default function DocumentTypePage() {
  const { t } = useTranslation()
  const { typeId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const { data: descriptor, isLoading, error } = useDocumentType(typeId)
  const {
    data: instances = [],
    isLoading: instancesLoading,
    error: instancesError,
    refetch: refetchInstances,
  } = useDocumentInstances(typeId)

  const [createOpen, setCreateOpen] = useState(false)
  // A cross-page "create, pre-linked" seed — the correction-routes dialog's own hand-off: a DIFFERENT
  // type's own screen (e.g. an invoice's "Corriger" button, custom/invoice-correction-routes-button.tsx)
  // navigates HERE with `state.initialData` set, rather than trying to render a foreign type's create
  // dialog on its own page. Generic on purpose — this page still names no document type: whatever
  // seed a caller hands through router state is simply forwarded to
  // `DocumentCreateDialog.initialData`, the exact same generic seed prop the received-invoice upload
  // flow already feeds its OWN, page-local dialog (see that component's own header) — the only
  // difference here is that the hand-off crosses a page NAVIGATION instead of staying inside one
  // component. Tracked SEPARATELY from `createOpen`: `onCreate` (the generic "+ New" button) also
  // opens the dialog, and must NOT resurrect a stale hand-off from an earlier visit — see that
  // handler below, which clears this every time it runs.
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
    setCreateOpen(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state])

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
      <div className="max-w-4xl mx-auto p-6">
        <EmptyState
          icon={FileQuestion}
          title={t("documents.form.unknownType", { typeId })}
          data-cy="document-type-unknown"
        />
      </div>
    )
  }

  const handleRowActionSuccess = (result: DocumentInstance) => {
    // A row action can create/update an instance of a DIFFERENT document type (e.g. the quote's
    // "convert-to-invoice" hands back a brand-new INVOICE) — this list only ever shows ITS OWN
    // type, so it follows the result to the new record's own page. Nothing here names which type
    // that might be: `result.typeId` is read from the action's own response.
    //
    // Same-type success needs nothing here at all: the list refetches on its own
    // (useRunDocumentAction invalidates the "documents" query) and the row simply updates in place.
    if (result.typeId !== typeId) {
      navigate(`/documents/${result.typeId}/${result.id}`)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6" data-cy="document-type-page">
      <DocumentList
        descriptor={descriptor}
        instances={instances}
        isLoading={instancesLoading}
        error={instancesError}
        onRetry={() => void refetchInstances()}
        onCreate={() => {
          // Never resurrect a stale navigation hand-off from an earlier visit — the generic "+ New"
          // button always means a genuinely blank record, whatever `createInitialData` still holds.
          setCreateInitialData(undefined)
          setCreateOpen(true)
        }}
        onOpen={(instance) => navigate(`/documents/${typeId}/${instance.id}`)}
        onActionSuccess={handleRowActionSuccess}
      />

      {createOpen && (
        <DocumentCreateDialog
          descriptor={descriptor}
          open
          onOpenChange={(open) => {
            if (open) return
            setCreateOpen(false)
            setCreateInitialData(undefined)
          }}
          initialData={createInitialData}
        />
      )}
    </div>
  )
}
