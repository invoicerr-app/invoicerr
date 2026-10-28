import { DocumentTypeIcon } from "@/components/documents/document-type-icon"
import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"

import { DocumentList, type SortKey } from "@/components/documents/document-list"
import { DocumentLoadState } from "@/components/documents/document-load-state"
import { useOnline } from "@/components/offline-banner"
import type { DocumentInstance } from "@/components/documents/types"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentInstances, useDocumentType } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"
import { createPendingEchoes } from "@/lib/pending-echoes"

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

const OFFLINE_ERROR = new Error("offline")

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

  const { data: descriptor, isLoading, error, refetch: refetchDescriptor } = useDocumentType(typeId)

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
  // `q` (which only updates after the debounce below). Resynced from `q` on an EXTERNAL change only (a
  // shared link, the back button, "Clear filters"): the echo of a `q` this box pushed itself is
  // skipped, since keystrokes typed while that URL update was committing would otherwise be wiped.
  const [searchInput, setSearchInput] = useState(q ?? "")
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [searchEchoes] = useState(() => createPendingEchoes<string | undefined>())
  useEffect(() => {
    if (!searchEchoes.isEcho(q)) setSearchInput(q ?? "")
  }, [q, searchEchoes])
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
      searchEchoes.sent(undefined)
      applyParams({ q: undefined })
      return
    }
    searchDebounceRef.current = setTimeout(() => {
      searchEchoes.sent(value)
      applyParams({ q: value })
    }, SEARCH_DEBOUNCE_MS)
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

  // A cross-page "create, pre-linked" seed (a correction from another type's screen) arrives here
  // through router state and is forwarded to the new-record page, which owns the form. Keyed on
  // `location.state`'s identity: this one route serves every type, so a hand-off can arrive without
  // a remount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state identity only, see above.
  useEffect(() => {
    const seed = (location.state as { initialData?: Record<string, unknown> } | null)?.initialData
    if (!seed) return
    void navigate(`/documents/${typeId}/new`, { replace: true, state: { initialData: seed } })
  }, [location.state])

  const online = useOnline()
  usePageHeader(descriptor?.label ?? typeId, <DocumentTypeIcon icon={descriptor?.icon} />)

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
        <DocumentLoadState
          error={error}
          notFoundTitle={t("documents.form.unknownType", { typeId })}
          notFoundDataCy="document-type-unknown"
          onRetry={() => void refetchDescriptor()}
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
      void navigate(`/documents/${result.typeId}/${result.id}`)
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
        // Offline, the list query pauses without failing: say it could not load rather than "no documents".
        error={instancesError ?? (!online && !instancePage ? OFFLINE_ERROR : undefined)}
        onRetry={() => void refetchInstances()}
        onCreate={() => navigate(`/documents/${typeId}/new`)}
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
    </div>
  )
}
