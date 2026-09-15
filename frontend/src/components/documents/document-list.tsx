import {
  Download,
  Ellipsis,
  FileCode,
  FileStack,
  Link2,
  Plus,
  Repeat,
  Search,
  SearchX,
  TriangleAlert,
} from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"

// Side-effect only: makes whatever is registered in custom-slots.ts available. This is the exact
// same pattern field-renderers/index.ts uses for field KINDS — the module that actually CONSULTS a
// registry is what pulls its registrations in, so the generic page importing DocumentList never has
// to know that any type-specific extension exists at all. See custom-registrations.ts's own header
// for why it, not this file, is the one place allowed to name a document type.
import "@/components/documents/custom-registrations"

import { ActionParamsDialog } from "@/components/documents/action-params-dialog"
import {
  extraActionGates,
  pickPrimaryAction,
  secondaryActions,
  transitionHint,
} from "@/components/documents/action-presentation"
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
import { formatTotal } from "@/components/documents/document-totals"
import { type RowAmount, resolveRowAmount } from "@/components/documents/list-amount"
import { isEmptyFieldValue, resolveListFields } from "@/components/documents/list-fields"
import { findCurrencyField } from "@/components/documents/totals-shape"
import type {
  DocumentActionDescriptor,
  DocumentInstance,
  DocumentTypeDescriptor,
} from "@/components/documents/types"
import { isActionAvailable, statusLabel } from "@/components/documents/types"
import { useDocumentActionRunner } from "@/components/documents/use-document-action-runner"
import { useResolvedCompanyCustomFields } from "@/hooks/queries"
import BetterPagination from "@/components/pagination"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 10

/** A row's grid — see DocumentListRow's own comment on why the desktop columns are fixed widths. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(10rem,auto)_5rem] sm:gap-4"

interface DocumentCardTitleProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
}

/**
 * A row's heading — the field(s) the descriptor's own `listItem.titleFields` names (see types.ts),
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
 * The document's own NUMBER, shown before the row title — see the backend's numbering/ for the
 * full mechanism. Gated on `descriptor.numbering` being declared at all: a type that never numbers
 * its instances (an expense, a credit note today — see their own descriptors) shows nothing here,
 * rather than a permanent, meaningless "no number yet" on every single row. For a NUMBERED type,
 * `displayNumber` is shown verbatim once set; before that (still "draft"), the translated
 * `documents.numbering.noneYet` — NEVER a fabricated number, the one rule this whole mechanism
 * exists to hold (see the backend's numbering/format-number.ts own header on the historical bug).
 */
function DocumentCardNumber({ descriptor, instance }: DocumentCardNumberProps) {
  const { t } = useTranslation()
  if (!descriptor.numbering) return null

  return (
    <span className="font-mono text-xs text-muted-foreground" data-cy={`document-number-${instance.id}`}>
      {instance.displayNumber ?? t("documents.numbering.noneYet")}
    </span>
  )
}

interface DocumentCardMetaProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
  /** The figure the row already shows in its amount slot, if any — its source field and its
   *  currency are skipped here rather than said twice on the same row. */
  amount: RowAmount | null
}

/**
 * The row's secondary line: "<field label>: <value>" for every field `listItem.secondaryFields`
 * names, then the company's own custom fields that carry a value (`includeArchived: true`, unlike
 * the document FORM's fetch, so an ALREADY-RECORDED value keeps showing after the company archives
 * the definition that captured it — this list reads what `instance.data` holds, not what a fresh
 * entry is offered). Field LABELS are plain data straight off the descriptor — the same convention
 * `field.label` already carries everywhere else it's shown. A field whose value is what the amount
 * slot already says (the currency, or the money field the amount was read from) is left out: one
 * fact, one place on the row.
 */
function DocumentCardMeta({ descriptor, instance, amount }: DocumentCardMetaProps) {
  const secondaryFields = useMemo(
    () => resolveListFields(descriptor, descriptor.listItem?.secondaryFields),
    [descriptor],
  )
  const { data: customFields } = useResolvedCompanyCustomFields("DOCUMENT", descriptor.id, {
    includeArchived: true,
  })
  const currencyKey = amount ? findCurrencyField(descriptor, instance.data)?.key : undefined

  const entries = [
    ...secondaryFields.filter((field) => {
      if (amount && (field.key === amount.fieldKey || field.key === currencyKey)) return false
      // See the backend's `DocumentFieldDescriptor.hideWhenEmpty` (descriptors/types.ts) — an
      // opt-in escape from this line's own otherwise-universal "every named field gets a
      // '<label>: <value-or-—>' entry" rule, for a field whose absence has nothing to communicate
      // (e.g. `clientReference` — most documents never had a buyer reference to begin with).
      return !(field.hideWhenEmpty && isEmptyFieldValue(instance.data[field.key]))
    }),
    // Every company custom field descriptor sets `hideWhenEmpty` unconditionally (see the backend's
    // `company-custom-fields/types.ts#toFieldDescriptor`), so an unfilled one adds nothing here.
    ...(customFields ?? []).filter((field) => !isEmptyFieldValue(instance.data[field.key])),
  ]
  if (entries.length === 0) return null

  return (
    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground sm:text-sm">
      {entries.map((field) => (
        <span key={field.key} className="whitespace-nowrap">
          {field.label}:{" "}
          <span className="text-foreground/80">
            <DocumentFieldValue field={field} value={instance.data[field.key]} data={instance.data} />
          </span>
        </span>
      ))}
    </div>
  )
}

interface DocumentRowActionsProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
  onActionSuccess: (result: DocumentInstance, actionId: string) => void
  /** Where the row puts the one highlighted button and where it puts the "more" menu — two slots
   *  in the row's own grid, so a phone can pin the menu top-right and the button under the amount
   *  while a desktop keeps both at the end of the line. Both render from ONE component so the action
   *  runner, its params dialog and the two extra dialogs share a single piece of state. */
  children: (slots: { primary: ReactNode; menu: ReactNode }) => ReactNode
}

/**
 * One row's actions, presented exactly the way the record's own page presents them: the ONE primary
 * action `pickPrimaryAction` picks for this status (with no unsaved edits, since a list row has no
 * form), everything else the descriptor declares inside a "more" menu, plus the same plain-GET and
 * dialog-driven entries that page's menu carries — PDF, normalized XML, share link, recurrence —
 * through the same shared gates. The old row showed every one of these as its own button, up to ten
 * on a sent invoice, all at the same visual weight; a reader had to read ten labels to find "send".
 * None of this branches on which document type it is. Changing FIELD values is the record's own
 * page's job (document-detail.tsx), reached by the row's title link / click.
 */
function DocumentRowActions({ descriptor, instance, onActionSuccess, children }: DocumentRowActionsProps) {
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
  // of them may be rendered through the generic action list below (which DOES POST through
  // `useDocumentActionRunner`) — each gets its own menu entry, gated by action-presentation.ts's
  // `extraActionGates`, the same read the detail page's menu uses.
  const gates = extraActionGates(descriptor, instance.status)

  // "sending" is the generic queue-processing status the async "send" mechanism introduces
  // (actions/async-send.ts on the backend) — not a per-document-type name, a property of the
  // record itself: something is actively in flight for it, driven by the worker, not by a further
  // click here. Offering no declared action while it lasts is what keeps the worker's own replay of
  // "send" (which the record's `availableWhen` MUST include for the 409 gate to pass — see
  // quote.descriptor.ts's own comment on why) from also being a button a human could click a
  // second time mid-flight and race the queue.
  const isProcessing = instance.status === "sending"
  // "cancel" — same reasoning as "download-xml"/"share-link" right above: declared on the descriptor
  // purely for the backend's own country-policy/status gates (cancel-policy.ts,
  // invoice.descriptor.ts), but its ONE entry point is the correction-routes dialog
  // (custom/invoice-correction-routes-button.tsx) — never a second, generic "Cancel" entry next to
  // it. An irreversible action gets ONE clearly-labelled door, not two.
  const availableActions = isProcessing
    ? []
    : descriptor.actions.filter(
        (action) =>
          action.id !== "download-xml" &&
          action.id !== "share-link" &&
          action.id !== "cancel" &&
          isActionAvailable(action, instance.status),
      )
  const primary = pickPrimaryAction(availableActions, instance.status, false)
  const secondary = secondaryActions(availableActions, primary)
  // A LIST, not a single component — more than one extension may register for the same
  // (type, slot); see custom-slots.ts's own header for why a single `Map.set` used to make the
  // second silently replace the first.
  const customRowExtras = getDocumentCustomComponents(descriptor.id, "list-row-extra")

  const blockedLabel = (action: DocumentActionDescriptor) =>
    action.policyBlockedReason
      ? t("documents.form.actionBlockedByPolicy", { reason: action.policyBlockedReason })
      : undefined

  const primarySlot = isProcessing ? (
    <span className="text-sm text-muted-foreground" data-cy={`document-row-processing-${instance.id}`}>
      {t("documents.list.processing")}
    </span>
  ) : (
    primary && (
      // `outline`, never `default`: the page's one filled button is "New <type>" in the header. A
      // disabled primary still shows, carrying its reason in a tooltip — a rule reads as a rule,
      // an empty slot reads as a bug (the same call the detail page's header makes).
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
        disabled={!!primary.policyBlockedReason}
        tooltip={blockedLabel(primary)}
        loading={isRunning && pendingAction === undefined}
        onClick={() => handleAction(primary)}
        dataCy={`document-row-action-${primary.id}-${instance.id}`}
      >
        {primary.label}
      </Button>
    )
  )

  const menuSlot = (
    <>
      {/* Keyed by the component's own function name, not the array index — REGISTRATION order is
          stable within a render, but the name is what stays stable ACROSS renders even if a future
          registration is ever reordered (custom-registrations.ts's own import order). Every
          registered component here is a named function declaration (see custom/*.tsx), so `.name`
          is always non-empty. They stay OUTSIDE the menu: each owns a dialog of its own, which a
          Radix menu would unmount the moment it closed. */}
      {customRowExtras.map((CustomExtra) => (
        <CustomExtra key={CustomExtra.name} descriptor={descriptor} instance={instance} />
      ))}

      {/* Always present: the PDF download alone earns the menu its place on every saved row.
          `Tooltip` wraps the trigger from OUTSIDE (three nested `asChild` Slots onto one real
          <button>) rather than through `Button`'s own `tooltip` prop, which would wrap the DOM
          node in a component `DropdownMenuTrigger asChild` cannot clone — see sidebar.tsx's own
          theme toggle for the same constraint. */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("documents.list.rowMenu")}
                dataCy={`document-row-menu-${instance.id}`}
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("documents.list.rowMenu")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          className="min-w-56"
          data-cy={`document-row-menu-content-${instance.id}`}
        >
          {secondary.map((action) => {
            const hint = transitionHint(t, descriptor, action, instance.status)
            const blocked = blockedLabel(action)
            return (
              <DropdownMenuItem
                key={action.id}
                disabled={!!blocked}
                onSelect={() => handleAction(action)}
                data-cy={`document-row-action-${action.id}-${instance.id}`}
              >
                <div className="flex flex-col gap-0.5">
                  <span>{action.label}</span>
                  {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
                  {blocked && (
                    <span
                      className="max-w-xs text-xs text-muted-foreground"
                      data-cy={`document-row-blocked-reason-${action.id}-${instance.id}`}
                    >
                      {blocked}
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
            )
          })}
          {secondary.length > 0 && <DropdownMenuSeparator />}

          <DropdownMenuItem
            onSelect={() => void downloadDocumentPdf(descriptor.id, instance.id, t)}
            data-cy={`document-pdf-button-${instance.id}`}
          >
            <Download aria-hidden="true" />
            {t("documents.list.downloadPdf")}
          </DropdownMenuItem>

          {gates.downloadXml && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={!!gates.downloadXml.policyBlockedReason}
                data-cy={`document-xml-button-${instance.id}`}
              >
                <FileCode aria-hidden="true" className="mr-2 text-muted-foreground" />
                {t("documents.list.downloadXml")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {DOCUMENT_XML_SYNTAXES.map(({ syntax, labelKey }) => (
                  <DropdownMenuItem
                    key={syntax}
                    onSelect={() => void downloadDocumentXml(descriptor.id, instance.id, syntax, t)}
                    data-cy={`document-xml-${syntax}-${instance.id}`}
                  >
                    {t(labelKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {gates.shareLink && (
            <DropdownMenuItem
              disabled={!!gates.shareLink.policyBlockedReason}
              onSelect={() => setShareLinkDialogOpen(true)}
              data-cy={`document-share-link-button-${instance.id}`}
            >
              <Link2 aria-hidden="true" />
              {t("documents.list.shareLink")}
            </DropdownMenuItem>
          )}

          {gates.recurrence && (
            <DropdownMenuItem
              onSelect={() => setRecurrenceDialogOpen(true)}
              data-cy={`document-recurrence-button-${instance.id}`}
            >
              <Repeat aria-hidden="true" />
              {t("documents.schedules.rowAction.tooltip")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
    </>
  )

  return <>{children({ primary: primarySlot, menu: menuSlot })}</>
}

interface DocumentListRowProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
  amount: RowAmount | null
  onOpen: (instance: DocumentInstance) => void
  onActionSuccess: (result: DocumentInstance, actionId: string) => void
}

/**
 * One document instance as a row: status, number + title, the secondary line, the amount in the
 * mono face (tabular, right-aligned on a desktop so a column of figures lines up), the one primary
 * action, the "more" menu. Below `sm` the same DOM re-flows into a card — identity and menu on the
 * first line, amount and primary action on the second — through grid `order`/`col-span` alone, so
 * every `data-cy` exists exactly once whatever the viewport.
 *
 * Opening the record: the whole row is clickable for a pointer, AND the title is a real link to
 * the same page — the one control a keyboard or screen-reader user can reach (a `div` with an
 * onClick is invisible to both), and the one a middle-click opens in a new tab.
 */
function DocumentListRow({ descriptor, instance, amount, onOpen, onActionSuccess }: DocumentListRowProps) {
  const { t } = useTranslation()
  // Same generic gate use-document-form.ts's own settlement section uses: shown once "record-payment"
  // is actually OFFERED for this record's current status — never by naming a document type.
  const recordPaymentAction = descriptor.actions.find((action) => action.id === "record-payment")
  const showSettlementBadge = !!recordPaymentAction && isActionAvailable(recordPaymentAction, instance.status)

  return (
    <div
      className="cursor-pointer px-4 py-3 transition-colors duration-150 hover:bg-accent/40 sm:px-6"
      onClick={() => onOpen(instance)}
      data-cy={`document-list-row-${instance.id}`}
    >
      <DocumentRowActions descriptor={descriptor} instance={instance} onActionSuccess={onActionSuccess}>
        {({ primary, menu }) => (
          // Fixed desktop columns for the amount, the primary and the menu, so figures line up as a
          // column across rows and a row with no action or no amount keeps every other row's
          // alignment (the slot renders empty rather than collapsing). `ROW_GRID` is shared with
          // the skeleton below for the same reason.
          <div className={ROW_GRID}>
            <div className="order-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <DocumentStatusBadge
                  status={instance.status}
                  label={descriptor.statuses?.find((s) => s.id === instance.status)?.label}
                />
                <DocumentCardNumber descriptor={descriptor} instance={instance} />
                <h3
                  className="min-w-0 break-words font-medium text-foreground"
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
              <DocumentCardMeta descriptor={descriptor} instance={instance} amount={amount} />
              {instance.lastActionError && (
                // Never a silent failure: a "send_failed" document names WHY, right here, not only
                // in a server log. Generic — reads whatever the backend recorded, on ANY status,
                // never a per-type branch.
                <p
                  className="mt-1 line-clamp-2 text-xs text-destructive"
                  title={instance.lastActionError}
                  data-cy={`document-row-last-error-${instance.id}`}
                >
                  {t("documents.list.lastActionError", { message: instance.lastActionError })}
                </p>
              )}
            </div>

            {/* Stops a click on any control here from also bubbling up to the row's own onClick
                (which opens the record) — an action and "open this record" are two different
                intents. */}
            <div
              className={cn(
                "amount order-3 text-sm font-medium text-foreground sm:order-2 sm:text-right",
                !amount && "hidden sm:block",
              )}
              data-cy={amount ? `document-row-amount-${instance.id}` : undefined}
            >
              {amount && formatTotal(amount.minor, amount.currency)}
            </div>
            <div
              className={cn("order-4 flex justify-end sm:order-3", !primary && "hidden sm:flex")}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {primary}
            </div>
            <div
              className="order-2 flex items-center justify-end gap-1 sm:order-4"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {menu}
            </div>
          </div>
        )}
      </DocumentRowActions>
    </div>
  )
}

/** A skeleton row shaped like `DocumentListRow` above — badge, two text lines, an amount, a button,
 *  the menu dot — so nothing jumps once real rows arrive. Literal siblings rather than a `.map` over a
 *  placeholder array: a loading placeholder has no identity for a key to carry. */
function DocumentListSkeletonRow() {
  return (
    <div className="px-4 py-3 sm:px-6" aria-hidden="true">
      <div className={ROW_GRID}>
        <div className="order-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-14 rounded-md" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="order-3 h-4 w-24 sm:order-2 sm:justify-self-end" />
        <Skeleton className="order-4 h-8 w-24 justify-self-end sm:order-3" />
        <Skeleton className="order-2 size-9 justify-self-end rounded-md sm:order-4" />
      </div>
    </div>
  )
}

function DocumentListSkeleton() {
  return (
    <div className="divide-y" data-cy="document-list-skeleton">
      <DocumentListSkeletonRow />
      <DocumentListSkeletonRow />
      <DocumentListSkeletonRow />
      <DocumentListSkeletonRow />
    </div>
  )
}

interface StatusChipProps {
  label: string
  count: number
  active: boolean
  onClick: () => void
  dataCy: string
}

/** One status filter as a pressed/unpressed pill — a real `<button aria-pressed>`, not a `Badge`
 *  with an onClick: the old chips looked like static labels because they were. Active = filled with
 *  the foreground ink, not the primary blue, so the header keeps a single blue control. */
function StatusChip({ label, count, active, onClick, dataCy }: StatusChipProps) {
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
      <span>{label}</span>
      <span className={cn("tabular-nums text-xs", active ? "text-background/70" : "text-muted-foreground")}>
        {count}
      </span>
    </button>
  )
}

type SortKey = "updated-desc" | "updated-asc" | "amount-desc" | "amount-asc"

interface DocumentListProps {
  descriptor: DocumentTypeDescriptor
  instances: DocumentInstance[]
  isLoading: boolean
  /** The list's own GET failed — shown as a state of the list with a retry, never a blank card. */
  error?: unknown
  onRetry?: () => void
  onCreate: () => void
  /** A row was clicked: the page navigates to the record's own screen. */
  onOpen: (instance: DocumentInstance) => void
  onActionSuccess: (result: DocumentInstance, actionId: string) => void
}

/**
 * The one generic list: a row per document instance (see DocumentListRow above) — never a bare
 * table, which would show every field with equal weight instead of a title a reader can actually
 * scan for. Search, status chips with counts, a sort, and ONE filled button ("New <type>") make up
 * the header; the rows carry one primary action each and a menu for the rest. A new document type
 * needs no list screen of its own, and no code here: it declares `listItem` on its descriptor (see
 * types.ts) and gets this rendering exactly like the other types.
 */
export function DocumentList({
  descriptor,
  instances,
  isLoading,
  error,
  onRetry,
  onCreate,
  onOpen,
  onActionSuccess,
}: DocumentListProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [sort, setSort] = useState<SortKey>("updated-desc")
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

  // One amount per row, resolved once here rather than inside each row: the sort needs every
  // figure up front, and the row then shows the same object it was sorted by.
  const amounts = useMemo(() => {
    const byId = new Map<string, RowAmount | null>()
    for (const instance of instances) byId.set(instance.id, resolveRowAmount(descriptor, instance.data))
    return byId
  }, [descriptor, instances])
  const hasAmounts = useMemo(() => [...amounts.values()].some((amount) => amount !== null), [amounts])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const rows = instances.filter((instance) => {
      if (statusFilter && instance.status !== statusFilter) return false
      if (!term) return true
      // A generic full-text filter: match against the document's own data verbatim (plus its
      // number) rather than guessing which fields are "searchable" per type.
      return `${instance.displayNumber ?? ""} ${JSON.stringify(instance.data)}`.toLowerCase().includes(term)
    })
    const byUpdated = (a: DocumentInstance, b: DocumentInstance) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    // Amount sorts compare in minor units of whatever currency each row carries — a mixed-currency
    // list sorts by raw figure, deliberately: it is a reading aid, not an accounting statement.
    const byAmount = (a: DocumentInstance, b: DocumentInstance) =>
      (amounts.get(b.id)?.minor ?? Number.NEGATIVE_INFINITY) -
      (amounts.get(a.id)?.minor ?? Number.NEGATIVE_INFINITY)
    switch (sort) {
      case "updated-asc":
        return rows.sort((a, b) => byUpdated(b, a))
      case "amount-desc":
        return rows.sort(byAmount)
      case "amount-asc":
        return rows.sort((a, b) => byAmount(b, a))
      default:
        return rows.sort(byUpdated)
    }
  }, [instances, search, statusFilter, sort, amounts])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const hasActiveFilter = !!search || !!statusFilter

  const setSearchAndResetPage = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const selectStatusFilter = (status: string | undefined) => {
    setStatusFilter(status)
    setPage(1)
  }

  const clearFilters = () => {
    setSearch("")
    setStatusFilter(undefined)
    setPage(1)
  }

  const createLabel = t("documents.list.actions.create", { label: descriptor.label })

  let body: ReactNode
  if (isLoading) {
    body = <DocumentListSkeleton />
  } else if (error) {
    body = (
      <EmptyState
        icon={TriangleAlert}
        tone="destructive"
        title={t("common.emptyState.loadErrorTitle")}
        description={t("common.emptyState.loadErrorHint")}
        action={
          onRetry && (
            <Button type="button" variant="outline" onClick={onRetry} dataCy="document-list-retry">
              {t("common.emptyState.retry")}
            </Button>
          )
        }
        data-cy="document-list-error"
      />
    )
  } else if (filtered.length === 0) {
    body = hasActiveFilter ? (
      <EmptyState
        icon={SearchX}
        title={t("documents.list.emptyState.noResults")}
        description={t("documents.list.emptyState.noResultsHint")}
        action={
          <Button type="button" variant="outline" onClick={clearFilters} dataCy="document-list-clear-filters">
            {t("common.emptyState.clearFilters")}
          </Button>
        }
        data-cy="document-list-empty"
      />
    ) : (
      <EmptyState
        icon={FileStack}
        title={t("documents.list.emptyState.noneYetTitle", { label: descriptor.label })}
        description={t("documents.list.emptyState.startCreatingHint", { label: descriptor.label })}
        // `secondary`, not `default`: the header's own "New <type>" stays the page's one filled
        // button — this is the same action, offered a second time where the eye lands.
        action={
          <Button type="button" variant="secondary" onClick={onCreate} dataCy="document-create-button-empty">
            <Plus aria-hidden="true" />
            {createLabel}
          </Button>
        }
        data-cy="document-list-empty"
      />
    )
  } else {
    body = (
      <div className="divide-y" data-cy="document-list-cards">
        {paged.map((instance) => (
          <DocumentListRow
            key={instance.id}
            descriptor={descriptor}
            instance={instance}
            amount={amounts.get(instance.id) ?? null}
            onOpen={onOpen}
            onActionSuccess={onActionSuccess}
          />
        ))}
      </div>
    )
  }

  return (
    <Card className="gap-0" data-cy="document-list-card">
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* On a phone the search and the "New" button share the first line and the sort takes
              the second; `sm:contents` dissolves that pairing on a desktop so the four controls
              become direct flex children again, re-ordered with `sm:order-*` into
              search · sort · extras · New. */}
          <div className="flex items-center gap-2 sm:contents">
            <div className="relative min-w-0 flex-1 sm:order-1 sm:max-w-xs">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                placeholder={t("documents.list.searchPlaceholder")}
                aria-label={t("documents.list.searchPlaceholder")}
                value={search}
                onChange={(event) => setSearchAndResetPage(event.target.value)}
                className="w-full pl-9"
                data-cy="document-list-search"
              />
            </div>

            <div className="flex items-center gap-2 sm:order-4 sm:ml-auto">
              {/* See the "list-row-extra" map above for why this keys by function name, not index. */}
              {headerExtras.map((HeaderExtra) => (
                <HeaderExtra key={HeaderExtra.name} descriptor={descriptor} />
              ))}

              <Button onClick={onCreate} aria-label={createLabel} dataCy="document-create-button">
                <Plus aria-hidden="true" />
                <span className="hidden md:inline">{createLabel}</span>
              </Button>
            </div>
          </div>

          <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
            <SelectTrigger
              className="w-full sm:order-2 sm:w-44"
              aria-label={t("documents.list.sort.label")}
              dataCy="document-list-sort"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated-desc">{t("documents.list.sort.updatedDesc")}</SelectItem>
              <SelectItem value="updated-asc">{t("documents.list.sort.updatedAsc")}</SelectItem>
              {hasAmounts && (
                <>
                  <SelectItem value="amount-desc">{t("documents.list.sort.amountDesc")}</SelectItem>
                  <SelectItem value="amount-asc">{t("documents.list.sort.amountAsc")}</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        {isLoading && (
          // Placeholder pills where the chips will land, so the header keeps its height and the
          // rows below don't drop by a line once the counts arrive.
          <div className="flex gap-2 py-0.5" aria-hidden="true">
            <Skeleton className="h-8 w-16 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
          </div>
        )}

        {instances.length > 0 && (
          // A single scrolling line on a phone rather than a wrapping cloud: `-mx-6 px-6` lets the
          // pills run to the card's edge and the scroll start where the header's padding starts.
          <div
            role="group"
            aria-label={t("documents.list.filters.ariaLabel")}
            className="-mx-6 flex gap-2 overflow-x-auto px-6 py-0.5 [scrollbar-width:none]"
            data-cy="document-status-filters"
          >
            <StatusChip
              label={t("documents.list.filters.all")}
              count={instances.length}
              active={statusFilter === undefined}
              onClick={() => selectStatusFilter(undefined)}
              dataCy="document-status-filter-all"
            />
            {[...statusCounts.entries()].map(([status, count]) => (
              <StatusChip
                key={status}
                label={statusLabel(descriptor, status)}
                count={count}
                active={statusFilter === status}
                onClick={() => selectStatusFilter(statusFilter === status ? undefined : status)}
                dataCy={`document-status-filter-${status}`}
              />
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">{body}</CardContent>

      {!isLoading && !error && filtered.length > 0 && pageCount > 1 && (
        <div className="border-t p-4">
          <BetterPagination pageCount={pageCount} page={currentPage} setPage={setPage} />
        </div>
      )}
    </Card>
  )
}
