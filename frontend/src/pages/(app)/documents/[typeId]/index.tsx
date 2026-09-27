import { FileQuestion } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"

import { DocumentCreateDialog } from "@/components/documents/document-create-dialog"
import { DocumentList, type SortKey } from "@/components/documents/document-list"
import type { DocumentInstance } from "@/components/documents/types"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentInstances, useDocumentType } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/** Default page size for `GET /documents` — mirrors the backend's own default
 *  (`dto/list-documents.dto.ts#DOCUMENT_LIST_DEFAULT_PAGE_SIZE`). */
const PAGE_SIZE = 25

/** How long the search box waits after the last keystroke before it actually updates the URL (and,
 *  through it, the request) — long enough that a normal typing burst never fires more than one
 *  request, short enough that it still feels immediate once someone stops typing. */
const SEARCH_DEBOUNCE_MS = 300

/** `DocumentList`'s own `SortKey` <-> `GET /documents`'s `sort`/`order` query params. */
function sortKeyToQuery(sort: SortKey): { sort: "updatedAt" | "number"; order: "asc" | "desc" } {
  switch (sort) {
    case "updated-asc":
      return { sort: "updatedAt", order: "asc" }
    case "number-desc":
      return { sort: "number", order: "desc" }
    case "number-asc":
      return { sort: "number", order: "asc" }
    default:
      return { sort: "updatedAt", order: "desc" }
  }
}

/**
 * The one generic list page: fetches a document type's descriptor and one PAGE of its saved
 * instances — filtered, sorted, and paginated server-side (`GET /documents`, see
 * `hooks/queries/use-document-types.ts#useDocumentInstances`) — and renders DocumentList (the cards)
 * plus DocumentCreateDialog (a new record) from them. Every filter/page/sort lives in the URL's own
 * query string (`useSearchParams`, `replace: true` so a filter tweak never piles up a separate
 * browser-history entry the way a real navigation should) — shareable, and the back button restores
 * a previous filter state exactly. Opening a saved record is a NAVIGATION, to that record's own page
 * (`[typeId]/[id].tsx`) — never a modal over this list. Nothing here is specific to "quote" or any
 * other type — a plugin adding a document type needs no page of its own, only a registered descriptor
 * (and, on the frontend, a renderer per any new field kind it introduces — see field-renderers/
 * index.ts — plus, optionally, a custom slot component registered in custom-registrations.ts, the
 * one place allowed to name a type).
 */
export default function DocumentTypePage() {
  const { t } = useTranslation()
  const { typeId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const { data: descriptor, isLoading, error } = useDocumentType(typeId)

  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const statusFilter = searchParams.getAll("status")
  const clientId = searchParams.get("clientId") ?? undefined
  const dateFrom = searchParams.get("dateFrom") ?? undefined
  const dateTo = searchParams.get("dateTo") ?? undefined
  const settlement = (searchParams.get("settlement") as "unsettled" | "overdue" | null) ?? undefined
  const q = searchParams.get("q") ?? undefined
  const sort = (searchParams.get("sort") as SortKey | null) ?? "updated-desc"

  /** Rewrites the given keys in the URL's query string; every filter change also resets `page` back
   *  to 1 (a filtered/sorted set has its own page 1, never wherever the reader happened to be scrolled
   *  to under the PREVIOUS filter) — `resetPage: false` is what `setPage` itself passes, since paging
   *  IS the page and must not reset itself.
   *
   * MUST be called AT MOST ONCE per event handler — proven, not theoretical: calling
   * `setSearchParams` (this codebase's react-router version) several times synchronously in the same
   * handler does NOT compose, updater form (`(prev) => next`) or not — only the LAST call actually
   * ends up applied, the others are silently superseded before they ever commit. This is exactly why
   * DocumentList never wires "clear everything" to five separate `onXChange` calls: `onClearFilters`
   * and `onDateRangeChange` below each carry every key they touch in ONE patch, so there is only ever
   * one `applyParams` call per click, whatever it clears. */
  const applyParams = (patch: Record<string, string | string[] | undefined>, resetPage = true) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(patch)) {
          next.delete(key)
          if (value === undefined) continue
          if (Array.isArray(value)) {
            for (const item of value) next.append(key, item)
          } else {
            next.set(key, value)
          }
        }
        if (resetPage) next.delete("page")
        return next
      },
      { replace: true },
    )
  }

  // The search box's own visible value — every keystroke, immediately, independent of the URL's own
  // `q` (which only updates after the debounce below). Resynced from `q` on an EXTERNAL change (a
  // shared link, the back button, "Clear filters") — the effect depends on `q` alone, never on
  // `searchInput`, so it never fights the debounce timer below.
  const [searchInput, setSearchInput] = useState(q ?? "")
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setSearchInput(q ?? ""), [q])
  useEffect(
    () => () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    },
    [],
  )

  const handleSearchChange = (value: string) => {
    setSearchInput(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    // Clearing the box is an explicit intent, not a keystroke to smooth over — applied immediately,
    // never left waiting out the same debounce a fresh search term gets.
    if (value.trim() === "") {
      applyParams({ q: undefined })
      return
    }
    searchDebounceRef.current = setTimeout(() => applyParams({ q: value }), SEARCH_DEBOUNCE_MS)
  }

  const { sort: sortField, order } = sortKeyToQuery(sort)
  const {
    data: instancePage,
    isLoading: instancesLoading,
    error: instancesError,
    refetch: refetchInstances,
  } = useDocumentInstances(typeId, {
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter.length > 0 ? statusFilter : undefined,
    clientId,
    dateFrom,
    dateTo,
    settlement,
    q,
    sort: sortField,
    order,
  })

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
        items={instancePage?.items ?? []}
        total={instancePage?.total ?? 0}
        page={instancePage?.page ?? page}
        pageSize={instancePage?.pageSize ?? PAGE_SIZE}
        onPageChange={(value) => applyParams({ page: String(value) }, false)}
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
        search={searchInput}
        onSearchChange={handleSearchChange}
        statusFilter={statusFilter}
        onStatusFilterChange={(value) => applyParams({ status: value })}
        clientId={clientId}
        onClientIdChange={(value) => applyParams({ clientId: value })}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateRangeChange={(range) => applyParams({ dateFrom: range.dateFrom, dateTo: range.dateTo })}
        settlement={settlement}
        onSettlementChange={() => applyParams({ settlement: undefined })}
        sort={sort}
        onSortChange={(value) => applyParams({ sort: value === "updated-desc" ? undefined : value })}
        onClearFilters={() =>
          applyParams({
            q: undefined,
            status: [],
            clientId: undefined,
            dateFrom: undefined,
            dateTo: undefined,
            settlement: undefined,
          })
        }
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
