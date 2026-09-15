import { Download, FileCode, FileStack, Link2, Plus, Repeat, Search } from "lucide-react"
import { useMemo, useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"

// Side-effect only: makes whatever is registered in custom-slots.ts available. This is the exact
// same pattern field-renderers/index.ts uses for field KINDS — the module that actually CONSULTS a
// registry is what pulls its registrations in, so the generic page importing DocumentList never has
// to know that any type-specific extension exists at all. See custom-registrations.ts's own header
// for why it, not this file, is the one place allowed to name a document type.
import "@/components/documents/custom-registrations"

import { ActionParamsDialog } from "@/components/documents/action-params-dialog"
import { extraActionGates } from "@/components/documents/action-presentation"
import { CreateRecurrenceDialog } from "@/components/documents/create-recurrence-dialog"
import { getDocumentCustomComponents } from "@/components/documents/custom-slots"
import {
  DOCUMENT_XML_SYNTAXES,
  downloadDocumentPdf,
  downloadDocumentXml,
} from "@/components/documents/document-downloads"
import { ShareLinkDialog } from "@/components/documents/share-link-dialog"
import { DocumentFieldValue } from "@/components/documents/field-value"
import { DocumentConformityListIndicator } from "@/components/documents/document-conformity-section"
import { DocumentSettlementBadge } from "@/components/documents/document-settlement"
import { DocumentStatusBadge } from "@/components/documents/document-status-badge"
import { isEmptyFieldValue, resolveListFields } from "@/components/documents/list-fields"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { isActionAvailable } from "@/components/documents/types"
import { useDocumentActionRunner } from "@/components/documents/use-document-action-runner"
import { useResolvedCompanyCustomFields } from "@/hooks/queries"
import BetterPagination from "@/components/pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 10

interface DocumentCardTitleProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
}

/**
 * A card's heading — the field(s) the descriptor's own `listItem.titleFields` names (see types.ts),
 * rendered through the same by-KIND formatter every value in this app goes through
 * (field-value.tsx), never a bespoke "how do I stringify a client" per type. Falls back to a plain
 * "<type label> #<short id>" only when the descriptor names nothing, or the named field(s) are all
 * unset on THIS instance — a mismatch case (see listItem's own doc comment), not the routine path.
 */
function DocumentCardTitle({ descriptor, instance }: DocumentCardTitleProps) {
  const { t } = useTranslation()
  const titleFields = useMemo(
    () => resolveListFields(descriptor, descriptor.listItem?.titleFields),
    [descriptor],
  )
  const hasTitle = titleFields.some((field) => !isEmptyFieldValue(instance.data[field.key]))

  if (!hasTitle) {
    return (
      <span>
        {t("documents.list.item.fallbackTitle", { label: descriptor.label, id: instance.id.slice(0, 8) })}
      </span>
    )
  }

  return (
    <>
      {titleFields.map((field, index) => (
        <span key={field.key}>
          {index > 0 && <span className="text-muted-foreground"> · </span>}
          <DocumentFieldValue field={field} value={instance.data[field.key]} data={instance.data} />
        </span>
      ))}
    </>
  )
}

interface DocumentCardNumberProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
}

/**
 * The document's own NUMBER, shown before the card title — see the backend's numbering/ for the
 * full mechanism. Gated on `descriptor.numbering` being declared at all: a type that never numbers
 * its instances (an expense, a credit note today — see their own descriptors) shows no badge here,
 * rather than a permanent, meaningless "no number yet" on every single card. For a NUMBERED type,
 * `displayNumber` is shown verbatim once set; before that (still "draft"), the translated
 * `documents.numbering.noneYet` — NEVER a fabricated number, the one rule this whole mechanism
 * exists to hold (see the backend's numbering/format-number.ts own header on the historical bug).
 */
function DocumentCardNumber({ descriptor, instance }: DocumentCardNumberProps) {
  const { t } = useTranslation()
  if (!descriptor.numbering) return null

  return (
    <span className="font-mono text-sm text-muted-foreground" data-cy={`document-number-${instance.id}`}>
      {instance.displayNumber ?? t("documents.numbering.noneYet")}
    </span>
  )
}

interface DocumentCardSecondaryInfoProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
}

/** The card's secondary line(s): "<field label>: <value>" for every field `listItem.secondaryFields`
 *  names, plus the record's own `updatedAt` (structural to every document instance, not something
 *  any one type has to declare). Field LABELS are plain data straight off the descriptor — the same
 *  convention `field.label` already carries everywhere else it's shown (the form, the old preview). */
function DocumentCardSecondaryInfo({ descriptor, instance }: DocumentCardSecondaryInfoProps) {
  const { t } = useTranslation()
  const secondaryFields = useMemo(
    () => resolveListFields(descriptor, descriptor.listItem?.secondaryFields),
    [descriptor],
  )

  return (
    <div className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-4">
      {secondaryFields.map((field) => {
        // See the backend's `DocumentFieldDescriptor.hideWhenEmpty` (descriptors/types.ts) — an
        // opt-in escape from this line's own otherwise-universal "every named field gets a
        // '<label>: <value-or-—>' span" rule, for a field whose absence has nothing to communicate
        // (e.g. `clientReference` — most documents never had a buyer reference to begin with).
        if (field.hideWhenEmpty && isEmptyFieldValue(instance.data[field.key])) return null
        return (
          <span key={field.key}>
            <span className="font-medium text-foreground">{field.label}:</span>{" "}
            <DocumentFieldValue field={field} value={instance.data[field.key]} data={instance.data} />
          </span>
        )
      })}
      <span>
        <span className="font-medium text-foreground">{t("documents.list.columns.updatedAt")}:</span>{" "}
        {new Date(instance.updatedAt).toLocaleString()}
      </span>
    </div>
  )
}

interface DocumentCustomFieldsInfoProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
}

/**
 * Custom fields ("champs personnalisés") — the list's own counterpart to
 * `DocumentCardSecondaryInfo` above, for a company's custom fields: same "<label>: <value>" shape,
 * same `DocumentFieldValue` renderer, same `hideWhenEmpty` skip (every company custom field descriptor
 * sets it unconditionally — see the backend's `company-custom-fields/types.ts#toFieldDescriptor`), so
 * a document with none filled in renders NOTHING extra here. `includeArchived: true` — unlike the
 * document FORM's own fetch — is what keeps an ALREADY-RECORDED value showing here even after a
 * company later archives (renames away, retires) the definition that captured it: this list reads
 * whatever `instance.data` actually holds, not what is currently offered for a FRESH entry.
 */
function DocumentCustomFieldsInfo({ descriptor, instance }: DocumentCustomFieldsInfoProps) {
  const { data: customFields } = useResolvedCompanyCustomFields("DOCUMENT", descriptor.id, {
    includeArchived: true,
  })
  const fields = customFields ?? []
  const withValue = fields.filter((field) => !isEmptyFieldValue(instance.data[field.key]))
  if (withValue.length === 0) return null

  return (
    <div className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-4">
      {withValue.map((field) => (
        <span key={field.key}>
          <span className="font-medium text-foreground">{field.label}:</span>{" "}
          <DocumentFieldValue field={field} value={instance.data[field.key]} data={instance.data} />
        </span>
      ))}
    </div>
  )
}

interface DocumentRowActionsProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
  onActionSuccess: (result: DocumentInstance, actionId: string) => void
}

/**
 * One card's action cluster: every action the descriptor declares for this record's current status
 * — run directly against the SAVED instance, no form involved — and, last, whatever a custom slot
 * adds for this type alone (see custom-slots.ts). Changing FIELD values is the record's own page's
 * job (document-detail.tsx), reached by the row's title link / click. None of this branches on
 * which document type it is.
 */
function DocumentRowActions({ descriptor, instance, onActionSuccess }: DocumentRowActionsProps) {
  const { t } = useTranslation()
  const [recurrenceDialogOpen, setRecurrenceDialogOpen] = useState(false)
  const [shareLinkDialogOpen, setShareLinkDialogOpen] = useState(false)
  const { pendingAction, pendingDefaults, isRunning, handleAction, executeAction, cancelPendingAction } =
    useDocumentActionRunner({
      typeId: descriptor.id,
      documentId: instance.id,
      getData: () => instance.data,
      onActionSuccess,
    })

  // "download-xml" / "share-link" / the recurrence gate — all declared on the descriptor for the
  // status/country-policy gates, none of them a POST through `runAction`: "download-xml" is a plain
  // GET (see `documents.service.ts#downloadDocumentFormat`'s own header, and `invoice.descriptor.ts`'s
  // comment on why it is never registered as an `ActionRegistry` handler — a scripted client POSTing
  // to `.../actions/download-xml` would only ever get a 501), "share-link" is a set of REST resources
  // behind its own dialog, and the recurrence rides on "duplicate" being declared at all. So none
  // of them may be rendered through the generic `availableActions` cluster below (which DOES POST
  // through `useDocumentActionRunner`) — each gets its own control, gated by
  // action-presentation.ts's `extraActionGates`, the same read the detail page's menu uses.
  const gates = extraActionGates(descriptor, instance.status)

  // "sending" is the generic queue-processing status the async "send" mechanism introduces
  // (actions/async-send.ts on the backend) — not a per-document-type name, a property of the
  // record itself: something is actively in flight for it, driven by the worker, not by a further
  // click here. Hiding the declared action buttons while it lasts is what keeps the worker's own
  // replay of "send" (which the record's `availableWhen` MUST include for the 409 gate to pass —
  // see quote.descriptor.ts's own comment on why) from also being a button a human could click a
  // second time mid-flight and race the queue.
  const isProcessing = instance.status === "sending"
  // "cancel" — same reasoning as "download-xml"/"share-link" right above:
  // declared on the descriptor purely for the backend's own country-policy/status gates
  // (cancel-policy.ts, invoice.descriptor.ts), but its ONE entry point is the correction-routes
  // dialog (custom/invoice-correction-routes-button.tsx) — never a second, generic "Cancel" button
  // sitting next to it. An irreversible action gets ONE clearly-labelled door, not two.
  const availableActions = isProcessing
    ? []
    : descriptor.actions.filter(
        (action) =>
          action.id !== "download-xml" &&
          action.id !== "share-link" &&
          action.id !== "cancel" &&
          isActionAvailable(action, instance.status),
      )
  // A LIST, not a single component — more than one extension may register for the same
  // (type, slot); see custom-slots.ts's own header for why a single `Map.set` used to make the
  // second silently replace the first.
  const customRowExtras = getDocumentCustomComponents(descriptor.id, "list-row-extra")
  // A disabled <button> (Button's own `disabled:pointer-events-none`, see ui/button.tsx) never
  // receives a REAL hover at all — the `tooltip` prop below still opens it for a keyboard/
  // screen-reader user, but a mouse user hovering a grayed-out button here would see nothing move.
  // document-form.tsx already learned this: it pairs the same tooltip with an always-visible
  // caption rather than trusting hover alone. One line is enough here (the reason is the country's
  // policy, the same for every blocked action on this record), shown once below the buttons rather
  // than once per button.
  const blockedReason = availableActions.find((action) => action.policyBlockedReason)?.policyBlockedReason

  return (
    // Stops a click on any action here from also bubbling up to the card's own onClick (which opens
    // the record's page) — an action button and "open this record" are two different intents.
    <div
      className="flex flex-col items-start gap-1 sm:items-end"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-1 sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("documents.list.downloadPdf")}
          tooltip={t("documents.list.downloadPdf")}
          onClick={() => void downloadDocumentPdf(descriptor.id, instance.id, t)}
          dataCy={`document-pdf-button-${instance.id}`}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
        </Button>

        {gates.downloadXml && (
          <DropdownMenu>
            {/* No `tooltip` prop here, deliberately: `Button`'s own tooltip wraps its DOM node in a
                Radix `<Tooltip>` component, which breaks `DropdownMenuTrigger`'s `asChild` Slot
                cloning (it needs a component that forwards props straight onto a real DOM element —
                see sidebar.tsx's own theme-toggle button, the one other `DropdownMenuTrigger asChild`
                in this codebase, which drops `tooltip` for the exact same reason). A native `title`
                carries the policy-blocked reason instead — less polished, still accessible. */}
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!!gates.downloadXml.policyBlockedReason}
                aria-label={t("documents.list.downloadXml")}
                title={
                  gates.downloadXml.policyBlockedReason
                    ? t("documents.form.actionBlockedByPolicy", {
                        reason: gates.downloadXml.policyBlockedReason,
                      })
                    : t("documents.list.downloadXml")
                }
                dataCy={`document-xml-button-${instance.id}`}
              >
                <FileCode className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {DOCUMENT_XML_SYNTAXES.map(({ syntax, labelKey }) => (
                <DropdownMenuItem
                  key={syntax}
                  onClick={() => void downloadDocumentXml(descriptor.id, instance.id, syntax, t)}
                  data-cy={`document-xml-${syntax}-${instance.id}`}
                >
                  {t(labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {gates.recurrence && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("documents.schedules.rowAction.tooltip")}
            tooltip={t("documents.schedules.rowAction.tooltip")}
            onClick={() => setRecurrenceDialogOpen(true)}
            dataCy={`document-recurrence-button-${instance.id}`}
          >
            <Repeat className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}

        {gates.shareLink && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!!gates.shareLink.policyBlockedReason}
            aria-label={t("documents.list.shareLink")}
            tooltip={
              gates.shareLink.policyBlockedReason
                ? t("documents.form.actionBlockedByPolicy", { reason: gates.shareLink.policyBlockedReason })
                : t("documents.list.shareLink")
            }
            onClick={() => setShareLinkDialogOpen(true)}
            dataCy={`document-share-link-button-${instance.id}`}
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}

        {/* Keyed by the component's own function name, not the array index — REGISTRATION order is
            stable within a render, but the name is what stays stable ACROSS renders even if a future
            registration is ever reordered (custom-registrations.ts's own import order). Every
            registered component here is a named function declaration (see custom/*.tsx), so `.name`
            is always non-empty. */}
        {customRowExtras.map((CustomExtra) => (
          <CustomExtra key={CustomExtra.name} descriptor={descriptor} instance={instance} />
        ))}

        {isProcessing && (
          <span
            className="px-2 text-xs text-muted-foreground"
            data-cy={`document-row-processing-${instance.id}`}
          >
            {t("documents.list.processing")}
          </span>
        )}

        {availableActions.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant="outline"
            size="sm"
            disabled={!!action.policyBlockedReason}
            tooltip={
              action.policyBlockedReason
                ? t("documents.form.actionBlockedByPolicy", { reason: action.policyBlockedReason })
                : undefined
            }
            loading={isRunning && pendingAction === undefined}
            onClick={() => handleAction(action)}
            dataCy={`document-row-action-${action.id}-${instance.id}`}
          >
            {action.label}
          </Button>
        ))}
      </div>

      {blockedReason && (
        <p
          className="line-clamp-2 max-w-[220px] whitespace-normal text-right text-xs text-muted-foreground"
          // The full text is a click away from being cut off — `title` is a native browser tooltip,
          // unaffected by the disabled buttons' own `pointer-events-none` (see the comment above)
          // since it lives on this plain, never-disabled paragraph instead.
          title={t("documents.form.actionBlockedByPolicy", { reason: blockedReason })}
          data-cy={`document-row-blocked-reason-${instance.id}`}
        >
          {t("documents.form.actionBlockedByPolicy", { reason: blockedReason })}
        </p>
      )}

      {instance.lastActionError && (
        // Never a silent failure: a "send_failed" document names WHY, right here, not only in a
        // server log.
        // Generic — reads whatever the backend recorded, on ANY status, never a per-type branch.
        <p
          className="line-clamp-2 max-w-[220px] whitespace-normal text-right text-xs text-destructive"
          title={instance.lastActionError}
          data-cy={`document-row-last-error-${instance.id}`}
        >
          {t("documents.list.lastActionError", { message: instance.lastActionError })}
        </p>
      )}

      {pendingAction && (
        <ActionParamsDialog
          action={pendingAction}
          defaultValues={pendingDefaults}
          submitting={isRunning}
          onCancel={cancelPendingAction}
          onConfirm={(params) => executeAction(pendingAction.id, params)}
        />
      )}

      {gates.recurrence && recurrenceDialogOpen && (
        <CreateRecurrenceDialog
          typeId={descriptor.id}
          sourceDocumentId={instance.id}
          offerThenSend={gates.offerThenSend}
          open={recurrenceDialogOpen}
          onOpenChange={setRecurrenceDialogOpen}
        />
      )}

      {gates.shareLink && shareLinkDialogOpen && (
        <ShareLinkDialog
          typeId={descriptor.id}
          documentId={instance.id}
          open={shareLinkDialogOpen}
          onOpenChange={setShareLinkDialogOpen}
        />
      )}
    </div>
  )
}

interface DocumentListCardRowProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
  onOpen: (instance: DocumentInstance) => void
  onActionSuccess: (result: DocumentInstance, actionId: string) => void
}

/**
 * One document instance, as a card row: a generic document icon (deliberately the SAME icon for
 * every type — anything richer would mean naming a type to pick one), a title plus status pill, a
 * secondary info line, and the action cluster. The layout itself is lifted from the clients and
 * articles lists (see frontend/src/pages/(app)/clients/index.tsx and
 * .../articles/_components/article-list.tsx) and from this app's own pre-redesign invoice/quote
 * lists (git tag `avant-refonte-documents`) — only WHICH fields fill the title/secondary slots comes
 * from the descriptor.
 *
 * Opening the record: the whole card is clickable for a pointer, AND the title is a real link to
 * the same page — the one control a keyboard or screen-reader user can reach (a `div` with an
 * onClick is invisible to both), and the one a middle-click opens in a new tab.
 */
function DocumentListCardRow({ descriptor, instance, onOpen, onActionSuccess }: DocumentListCardRowProps) {
  const { t } = useTranslation()
  // Same generic gate use-document-form.ts's own settlement section uses: shown once "record-payment"
  // is actually OFFERED for this record's current status — never by naming a document type.
  const recordPaymentAction = descriptor.actions.find((action) => action.id === "record-payment")
  const showSettlementBadge = !!recordPaymentAction && isActionAvailable(recordPaymentAction, instance.status)

  return (
    <div
      className="cursor-pointer p-4 transition-colors hover:bg-accent/40 sm:p-6"
      onClick={() => onOpen(instance)}
      data-cy={`document-list-row-${instance.id}`}
    >
      {/* Below `sm` the action cluster drops UNDER the identity block instead of squeezing it into a
          third of the card's width — one column, full width, the way every other list in this app
          already stacks on a phone. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full min-w-0 flex-row items-center gap-4">
          <div className="h-fit w-fit shrink-0 rounded-lg bg-info p-2">
            <FileStack className="h-5 w-5 text-info-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <DocumentCardNumber descriptor={descriptor} instance={instance} />
              <h3
                className="break-words font-medium text-foreground"
                data-cy={`document-list-title-${instance.id}`}
              >
                <Link
                  to={`/documents/${descriptor.id}/${instance.id}`}
                  className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  title={t("documents.list.tooltips.open")}
                  onClick={(event) => event.stopPropagation()}
                  data-cy={`document-open-link-${instance.id}`}
                >
                  <DocumentCardTitle descriptor={descriptor} instance={instance} />
                </Link>
              </h3>
              <DocumentStatusBadge
                status={instance.status}
                label={descriptor.statuses?.find((s) => s.id === instance.status)?.label}
              />
              {showSettlementBadge && (
                <DocumentSettlementBadge
                  typeId={descriptor.id}
                  documentId={instance.id}
                  dataCySuffix={instance.id}
                />
              )}
              {/* The list's discreet rejected-deposit indicator: renders nothing unless the
                  platform actually rejected this deposit (see that component's own header). */}
              <DocumentConformityListIndicator typeId={descriptor.id} documentId={instance.id} />
            </div>
            <DocumentCardSecondaryInfo descriptor={descriptor} instance={instance} />
            <DocumentCustomFieldsInfo descriptor={descriptor} instance={instance} />
          </div>
        </div>

        <DocumentRowActions descriptor={descriptor} instance={instance} onActionSuccess={onActionSuccess} />
      </div>
    </div>
  )
}

/** A skeleton card row shaped like `DocumentListCardRow` above, so the loading state doesn't jump
 *  once real rows arrive. Three literal siblings (not a `.map` over a placeholder array) — there is
 *  no "identity" for a loading placeholder to carry, so there is no index-as-key question to beg. */
function DocumentListSkeletonRow() {
  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    </div>
  )
}

interface DocumentListProps {
  descriptor: DocumentTypeDescriptor
  instances: DocumentInstance[]
  isLoading: boolean
  onCreate: () => void
  /** A row was clicked: the page navigates to the record's own screen. */
  onOpen: (instance: DocumentInstance) => void
  onActionSuccess: (result: DocumentInstance, actionId: string) => void
}

/**
 * The one generic list: a card per document instance (see DocumentListCardRow above) — never a bare
 * table, which would show every field with equal weight instead of a title a reader can actually
 * scan for. A status filter driven by DocumentStatusBadge's generic tone heuristic, and an action
 * cluster driven entirely by DocumentRowActions round it out. A new document type needs no list
 * screen of its own, and no code here: it declares `listItem` on its descriptor (see types.ts) and
 * gets this rendering exactly like the other three.
 */
export function DocumentList({
  descriptor,
  instances,
  isLoading,
  onCreate,
  onOpen,
  onActionSuccess,
}: DocumentListProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)

  // See custom-slots.ts's own comment on "list-header-extra" — additive, next to the generic "New"
  // button below, never in place of it. `instance` is deliberately omitted (this slot is per-LIST,
  // not per-record).
  const headerExtras = getDocumentCustomComponents(descriptor.id, "list-header-extra")

  // Status categories are DERIVED from the loaded data, never a fixed enum — the same discipline
  // DocumentStatusBadge holds for color: a status this core has never seen still gets a filter chip.
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const instance of instances) counts.set(instance.status, (counts.get(instance.status) ?? 0) + 1)
    return counts
  }, [instances])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return instances.filter((instance) => {
      if (statusFilter && instance.status !== statusFilter) return false
      if (!term) return true
      // A generic full-text filter: match against the document's own data verbatim rather than
      // guessing which fields are "searchable" per type.
      return JSON.stringify(instance.data).toLowerCase().includes(term)
    })
  }, [instances, search, statusFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const hasActiveFilter = !!search || !!statusFilter

  const setSearchAndResetPage = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const toggleStatusFilter = (status: string) => {
    setStatusFilter((current) => (current === status ? undefined : status))
    setPage(1)
  }

  return (
    <Card className="gap-0" data-cy="document-list-card">
      <CardHeader className="border-b flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:justify-between">
        <div className="relative w-full sm:w-fit sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("documents.list.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearchAndResetPage(event.target.value)}
            className="pl-9 w-full"
            data-cy="document-list-search"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {[...statusCounts.entries()].map(([status, count]) => (
            <Badge
              key={status}
              variant="outline"
              onClick={() => toggleStatusFilter(status)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1 text-sm border-transparent transition-all",
                statusFilter === status
                  ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
              data-cy={`document-status-filter-${status}`}
            >
              {status} ({count})
            </Badge>
          ))}

          {/* See the "list-row-extra" map above for why this keys by function name, not index. */}
          {headerExtras.map((HeaderExtra) => (
            <HeaderExtra key={HeaderExtra.name} descriptor={descriptor} />
          ))}

          <Button onClick={onCreate} dataCy="document-create-button">
            <Plus className="h-4 w-4 mr-0 md:mr-2" />
            <span className="hidden md:inline-flex">
              {t("documents.list.actions.create", { label: descriptor.label })}
            </span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="divide-y">
            <DocumentListSkeletonRow />
            <DocumentListSkeletonRow />
            <DocumentListSkeletonRow />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center" data-cy="document-list-empty">
            <FileStack className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
            <h3 className="mt-2 text-sm font-medium text-foreground">
              {hasActiveFilter ? t("documents.list.emptyState.noResults") : t("documents.list.empty")}
            </h3>
            <p className="mt-1 text-sm text-primary">
              {hasActiveFilter
                ? t("documents.list.emptyState.noResultsHint")
                : t("documents.list.emptyState.startCreatingHint", { label: descriptor.label })}
            </p>
            {!hasActiveFilter && (
              <div className="mt-6">
                <Button onClick={onCreate} dataCy="document-create-button-empty">
                  <Plus className="h-4 w-4 mr-2" />
                  {t("documents.list.actions.create", { label: descriptor.label })}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y" data-cy="document-list-cards">
            {paged.map((instance) => (
              <DocumentListCardRow
                key={instance.id}
                descriptor={descriptor}
                instance={instance}
                onOpen={onOpen}
                onActionSuccess={onActionSuccess}
              />
            ))}
          </div>
        )}
      </CardContent>

      {!isLoading && filtered.length > 0 && pageCount > 1 && (
        <div className="border-t p-4">
          <BetterPagination pageCount={pageCount} page={currentPage} setPage={setPage} />
        </div>
      )}
    </Card>
  )
}
