import { ArrowLeft, ChevronDown, Download, FileCode, Link2, Repeat, UserCheck } from "lucide-react"
import { useState } from "react"
import { useWatch } from "react-hook-form"
import { Link, useNavigate } from "react-router"
import { useTranslation } from "react-i18next"

// Side-effect only: makes whatever is registered in custom-slots.ts available — the same pattern
// document-list.tsx follows, and for the same reason (see custom-registrations.ts's own header).
import "@/components/documents/custom-registrations"

import {
  extraActionGates,
  findSaveAction,
  pickPrimaryAction,
  saveDraftLockNotice,
  secondaryActions,
  transitionHint,
} from "@/components/documents/action-presentation"
import { CreateRecurrenceDialog } from "@/components/documents/create-recurrence-dialog"
import { getDocumentCustomComponents } from "@/components/documents/custom-slots"
import { DocumentAcceptanceSection } from "@/components/documents/document-acceptance-section"
import { DocumentArchiveSection } from "@/components/documents/document-archive-section"
import {
  DocumentConformityListIndicator,
  DocumentConformitySection,
} from "@/components/documents/document-conformity-section"
import {
  DOCUMENT_XML_SYNTAXES,
  downloadDocumentPdf,
  downloadDocumentXml,
} from "@/components/documents/document-downloads"
import {
  DocumentActionButton,
  DocumentActionLockConfirmHost,
  DocumentActionParamsHost,
  DocumentFormFields,
} from "@/components/documents/document-form"
import { DocumentReconciliationSection } from "@/components/documents/document-reconciliation-section"
import {
  DocumentSettlementBadge,
  DocumentSettlementSection,
} from "@/components/documents/document-settlement"
import { DocumentStatusBadge } from "@/components/documents/document-status-badge"
import { DocumentTaxWarningsSection } from "@/components/documents/document-tax-warnings"
import { DocumentTotals, formatTotal, useDocumentTotals } from "@/components/documents/document-totals"
import { DocumentFieldValue } from "@/components/documents/field-value"
import { hasUnsavedChanges } from "@/components/documents/form-dirty"
import { isEmptyFieldValue, resolveListFields } from "@/components/documents/list-fields"
import { MarkQuoteAcceptedDialog } from "@/components/documents/mark-quote-accepted-dialog"
import { SectionCard } from "@/components/documents/section-card"
import { ShareLinkDialog } from "@/components/documents/share-link-dialog"
import type {
  DocumentActionDescriptor,
  DocumentInstance,
  DocumentTypeDescriptor,
} from "@/components/documents/types"
import { isActionAvailable, statusLabel } from "@/components/documents/types"
import { type DocumentFormState, useDocumentForm } from "@/components/documents/use-document-form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { Form } from "@/components/ui/form"

interface DocumentDetailProps {
  descriptor: DocumentTypeDescriptor
  /** The LIVE record, as the page's own query holds it: `status`/`displayNumber`/`lastActionError`
   *  are read from it on every render so a "send" settling in the worker reaches this screen
   *  without a reload. Its `data` is read exactly ONCE, into the snapshot below. */
  instance: DocumentInstance
}

/**
 * The detail page of ONE saved document, for ANY document type: a compact header (what it is, what
 * state it is in, what it is worth, and the one thing to do next), the form on the left, everything
 * the record has accumulated on the right (totals, settlement, legal archive, conformity,
 * reconciliation), and a bar that appears the moment the form differs from what is saved. Nothing
 * here is specific to a type — the same "a type is a descriptor" discipline document-list.tsx and
 * the create dialog already hold; the ONE type-gated render (reconciliation) is called out inline.
 *
 * The form is reset from a SNAPSHOT of `instance.data` taken when this component mounts (the route
 * keys it by document id, so a different record is a different mount) — deliberately never
 * re-derived from `instance` on its own: the page's query refetches in the background (the async
 * "send" mechanism's own polling, an SSE nudge), and letting a refetch replace the form's values
 * would silently overwrite what the user is still typing. The snapshot only ever moves on purpose:
 * after an action that persisted this record (the response's own `data` becomes the new baseline,
 * which is also what clears the "unsaved" state), or on an explicit Discard.
 */
export function DocumentDetail({ descriptor, instance }: DocumentDetailProps) {
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState(instance.data)

  const state = useDocumentForm({
    descriptor,
    documentId: instance.id,
    initialData: snapshot,
    status: instance.status,
    displayNumber: instance.displayNumber,
    onActionSuccess: (result, actionId) => {
      // An action can hand back a DIFFERENT record: a different type (the quote's
      // "convert-to-invoice" returns a brand-new invoice) or a different record of the same type
      // ("duplicate"). This page only ever shows the record it was opened for, so it follows the
      // result to ITS own page — `result.typeId`/`result.id` come off the action's own response;
      // nothing here names which types or actions might do this.
      if (result.typeId !== descriptor.id || result.id !== instance.id) {
        navigate(`/documents/${result.typeId}/${result.id}`)
        return
      }
      // Same record: adopt the persisted data as the new baseline — UNLESS the user has unsaved
      // edits AND the action was not a lifecycle move. A lifecycle action (save, send, approve…)
      // persists the payload it was given, so the response IS what the form holds, normalized; an
      // action with no `transitions` (record a payment, export) leaves the record's data alone, and
      // resetting the form to that untouched data would throw away what is still being typed.
      const action = descriptor.actions.find((candidate) => candidate.id === actionId)
      if (!hasUnsavedChanges(state.form.getValues(), snapshot) || action?.transitions) {
        setSnapshot(result.data)
      }
    },
  })

  return (
    <Form {...state.form}>
      <DocumentDetailBody
        descriptor={descriptor}
        instance={instance}
        state={state}
        baseline={snapshot}
        onDiscard={() => state.form.reset(snapshot)}
      />
      <DocumentActionParamsHost state={state} />
      <DocumentActionLockConfirmHost state={state} />
    </Form>
  )
}

interface DocumentDetailBodyProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
  state: DocumentFormState
  /** The saved data the form was last reset from — what "unsaved" is measured against. */
  baseline: Record<string, unknown>
  onDiscard: () => void
}

/** Split from DocumentDetail only so the hooks that read the form (`useWatch`,
 *  `useDocumentTotals`) run INSIDE the `<Form>` provider the parent mounts. */
function DocumentDetailBody({ descriptor, instance, state, baseline, onDiscard }: DocumentDetailBodyProps) {
  const { t } = useTranslation()
  // Value comparison against the saved baseline, never RHF's own `isDirty` — see form-dirty.ts.
  const values = useWatch({ control: state.form.control })
  const isDirty = hasUnsavedChanges(values, baseline)
  const { currentStatus, currentDisplayNumber, availableActions, showSettlement } = state

  // "sending" is the generic queue-processing status the async "send" mechanism introduces
  // (actions/async-send.ts on the backend) — not a per-document-type name, a property of the
  // record itself: something is actively in flight for it, driven by the worker, not by a further
  // click here. Offering no action while it lasts is what keeps the worker's own replay of "send"
  // from also being a button a human could click a second time mid-flight and race the queue.
  const isProcessing = currentStatus === "sending"
  const actions = isProcessing ? [] : availableActions
  const primary = pickPrimaryAction(actions, currentStatus, isDirty)
  const secondary = secondaryActions(actions, primary)
  const saveAction = findSaveAction(actions, currentStatus)
  // Issue #468 (and the pre-existing France invoice case) - see `saveDraftLockNotice`'s own header:
  // reads the FULL descriptor, not `availableActions`, since the whole point is to explain why
  // "save-draft" is MISSING from that filtered list.
  const saveLockedMessage = saveDraftLockNotice(t, descriptor, currentStatus)

  const liveInstance: DocumentInstance = {
    ...instance,
    status: currentStatus ?? instance.status,
    displayNumber: currentDisplayNumber,
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6" data-cy="document-detail-page">
      <DocumentDetailHeader descriptor={descriptor} instance={liveInstance} state={state}>
        <DocumentDetailActions
          descriptor={descriptor}
          instance={liveInstance}
          state={state}
          primary={primary}
          secondary={secondary}
          isProcessing={isProcessing}
        />
      </DocumentDetailHeader>

      {instance.lastActionError && (
        // Never a silent failure: a "send_failed" document names WHY, right here, not only in a
        // server log. Read from the LIVE record, so a re-send that clears it clears this too.
        <Alert variant="destructive" data-cy="document-form-last-error">
          <AlertDescription>
            {t("documents.list.lastActionError", { message: instance.lastActionError })}
          </AlertDescription>
        </Alert>
      )}

      {saveLockedMessage && (
        // Issue #468 - the "Save draft"-shaped action (whatever its label) has silently DISAPPEARED
        // from `availableActions` (isActionAvailable already refuses it, `use-document-form.ts`),
        // which by itself just looks like the feature vanished. This says WHY, and what to do
        // instead - same wording whether the type's own `lockedStatuses` fired or a country policy's
        // `policyRestrictedToStatuses` did (see `saveDraftLockNotice`'s own header).
        <Alert data-cy="document-save-locked-notice">
          <AlertDescription>{saveLockedMessage}</AlertDescription>
        </Alert>
      )}

      {liveInstance.lastArchiveError && (
        // ⚖ The document WAS delivered and is not preserved. This is the only place a company can
        // learn that: the archive section below renders nothing at all when there is no archive —
        // which is exactly the case here — so a missing archive would otherwise look identical to a
        // document that never needed one. Deliberately NOT `destructive`: the send succeeded, the
        // customer has their invoice, and the backend is already retrying; what this needs is to be
        // impossible to miss, not to read as a failed send. Read from the LIVE record, so the retry
        // that finally archives it makes this disappear without a reload.
        <Alert variant="warning" data-cy="document-archive-error">
          <AlertDescription>
            {t("documents.archive.lastArchiveError", { message: liveInstance.lastArchiveError })}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* `scroll-mb-24` on anything focused inside the form: a field tabbed into near the bottom
            must clear the sticky "unsaved" bar, not land under it. */}
        <Card className="gap-4 py-5 [&_:focus]:scroll-mb-24">
          <CardContent className="px-5">
            <DocumentFormFields descriptor={descriptor} state={state} />
          </CardContent>
        </Card>

        <aside className="space-y-4">
          <TotalsCard descriptor={descriptor} documentId={instance.id} />
          {showSettlement && <DocumentSettlementSection typeId={descriptor.id} documentId={instance.id} />}
          {/* Legal archiving ⚖ — shown for ANY document type/status once it has at least one
              archive (the component itself renders nothing otherwise, see its own header): never
              gated on "sent" here, since the component's own emptiness check already carries that
              fact (a draft has no archive yet, whatever its type). */}
          <DocumentArchiveSection typeId={descriptor.id} documentId={instance.id} />
          {/* Issue #421 - which of the two ways this quote was accepted, worded so neither can be
              mistaken for the other. Renders nothing outside "signed"/"accepted" (that component's
              own emptiness check), so this is never gated here on the type either - a type with
              neither status simply never matches. */}
          <DocumentAcceptanceSection
            typeId={descriptor.id}
            documentId={instance.id}
            status={liveInstance.status}
            updatedAt={instance.updatedAt}
          />
          {/* Conformity tracking — same gate as the archive section right above (any type/status
              once it has at least one event; renders nothing otherwise, see that component's own
              header): a document sent by email, or by a channel with no poller (e.g. "sdi"), never
              shows a section here at all. */}
          <DocumentConformitySection typeId={descriptor.id} documentId={instance.id} />
          {/* The 3-way-match panel — TYPE-gated, unlike the two sections above: see
              document-reconciliation-section.tsx's own header for why. */}
          {descriptor.id === "received-invoice" && <DocumentReconciliationSection documentId={instance.id} />}
        </aside>
      </div>

      {isDirty && (
        // Sticky to the bottom of the page's own scroll container and LAST in flow, so scrolling to
        // the end still reveals everything above it. `bg-background/95` + blur rather than opaque:
        // the bar is a status, not a wall — the form should still be felt continuing under it.
        <div
          className="sticky bottom-0 z-10 -mx-6 -mb-6 border-t bg-background/95 px-6 py-3 backdrop-blur-sm"
          data-cy="document-unsaved-bar"
        >
          {/* Column on mobile with full-width buttons (easier targets than a cramped side-by-side
              pair at 390px — owner feedback, 2026-09-16), row again from `sm:` up, unchanged from
              before. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium">{t("documents.detail.unsavedChanges")}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={onDiscard}
                dataCy="document-unsaved-discard"
              >
                {t("documents.detail.discard")}
              </Button>
              {saveAction && (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  loading={state.runner.isRunning && state.runner.pendingAction === undefined}
                  disabled={!!saveAction.policyBlockedReason}
                  tooltip={
                    saveAction.policyBlockedReason
                      ? t("documents.form.actionBlockedByPolicy", { reason: saveAction.policyBlockedReason })
                      : undefined
                  }
                  onClick={() => state.runner.handleAction(saveAction)}
                  dataCy="document-unsaved-save"
                >
                  {saveAction.label}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface DocumentDetailHeaderProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
  state: DocumentFormState
  children: React.ReactNode
}

/**
 * The compact identity strip: type, number, status pills on the first line; the record's own
 * headline facts on the second — the SAME fields the list card shows (`listItem.titleFields` /
 * `secondaryFields`, see types.ts), read from the SAVED data (the header describes the record, not
 * the edits in progress), plus the live gross amount. The children slot is the action cluster.
 */
function DocumentDetailHeader({ descriptor, instance, state, children }: DocumentDetailHeaderProps) {
  const { t } = useTranslation()
  const titleFields = resolveListFields(descriptor, descriptor.listItem?.titleFields)
  const secondaryFields = resolveListFields(descriptor, descriptor.listItem?.secondaryFields)
  const hasTitle = titleFields.some((field) => !isEmptyFieldValue(instance.data[field.key]))

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-2">
        <Link
          to={`/documents/${descriptor.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          data-cy="document-detail-back"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("documents.detail.backToList", { label: descriptor.label })}
        </Link>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="font-heading text-xl font-semibold tracking-tight">{descriptor.label}</h2>
          {descriptor.numbering && (
            <span
              className={instance.displayNumber ? "font-mono text-lg" : "text-sm text-muted-foreground"}
              data-cy="document-form-number"
            >
              {instance.displayNumber ?? t("documents.numbering.noneYet")}
            </span>
          )}
          <DocumentStatusBadge status={instance.status} label={statusLabel(descriptor, instance.status)} />
          {state.showSettlement && (
            <DocumentSettlementBadge typeId={descriptor.id} documentId={instance.id} />
          )}
          <DocumentConformityListIndicator typeId={descriptor.id} documentId={instance.id} />
        </div>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {hasTitle && (
            <span className="font-medium text-foreground" data-cy="document-detail-title">
              {titleFields.map((field, index) => (
                <span key={field.key}>
                  {index > 0 && <span className="text-muted-foreground"> · </span>}
                  <DocumentFieldValue field={field} value={instance.data[field.key]} data={instance.data} />
                </span>
              ))}
            </span>
          )}
          {secondaryFields.map((field) => {
            // See the backend's `DocumentFieldDescriptor.hideWhenEmpty` — the same skip the list
            // card applies to this exact line.
            const value = instance.data[field.key]
            if (field.hideWhenEmpty && isEmptyFieldValue(value)) return null
            return (
              <span key={field.key}>
                {field.label}:{" "}
                <span className="text-foreground">
                  <DocumentFieldValue field={field} value={value} data={instance.data} />
                </span>
              </span>
            )
          })}
          <HeadlineAmount descriptor={descriptor} />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">{children}</div>
    </header>
  )
}

/** The live gross total, in the mono figures face — the one number a reader looks for first.
 *  Absent for a type with nothing to total (see useDocumentTotals). */
function HeadlineAmount({ descriptor }: { descriptor: DocumentTypeDescriptor }) {
  const totals = useDocumentTotals(descriptor)
  if (!totals) return null
  return (
    <span className="amount text-base font-semibold text-foreground" data-cy="document-detail-amount">
      {formatTotal(totals.grossMinor, totals.currency || "")}
    </span>
  )
}

/**
 * The tax warnings live INSIDE this card, under the figures, rather than in a section of their own:
 * every one of them is a statement about a number printed a few lines above it ("this line was taxed
 * at the destination's standard rate", "this sale was treated as a consumer sale"), and a caveat read
 * anywhere other than next to the amount it changes is a caveat nobody connects to anything. It is
 * also why they are not in the settlement card — that one is about what has been PAID, not about how
 * the amount was arrived at.
 */
function TotalsCard({ descriptor, documentId }: { descriptor: DocumentTypeDescriptor; documentId: string }) {
  const { t } = useTranslation()
  const totals = useDocumentTotals(descriptor)
  if (!totals) return null
  return (
    <SectionCard title={t("documents.detail.totalsTitle")} dataCy="document-totals-card">
      <DocumentTotals descriptor={descriptor} />
      <DocumentTaxWarningsSection typeId={descriptor.id} documentId={documentId} />
    </SectionCard>
  )
}

interface DocumentDetailActionsProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
  state: DocumentFormState
  primary: DocumentActionDescriptor | undefined
  secondary: DocumentActionDescriptor[]
  isProcessing: boolean
}

/**
 * The header's action cluster: whatever a custom slot adds for this type (the correction-routes
 * button — see custom-slots.ts's "list-row-extra"), ONE "Actions" menu holding every secondary
 * action, and ONE primary button (see action-presentation.ts for the rule that picks it). The menu
 * also carries the record's plain-GET and dialog-driven entries — PDF, normalized XML, share link,
 * recurrence — the exact set the list row offers, through the same shared helpers.
 */
function DocumentDetailActions({
  descriptor,
  instance,
  state,
  primary,
  secondary,
  isProcessing,
}: DocumentDetailActionsProps) {
  const { t } = useTranslation()
  const [recurrenceOpen, setRecurrenceOpen] = useState(false)
  const [shareLinkOpen, setShareLinkOpen] = useState(false)
  const [markAcceptedOpen, setMarkAcceptedOpen] = useState(false)
  const gates = extraActionGates(descriptor, instance.status)
  const customExtras = getDocumentCustomComponents(descriptor.id, "list-row-extra")
  // Issue #421 - declared on the descriptor for the status/policy gates only (excluded from the
  // generic action list, `use-document-form.ts`'s own header) and served through its own dedicated
  // dialog instead, the same shape "share-link" already has right above.
  const acceptManuallyAction = descriptor.actions.find((action) => action.id === "accept-manually")
  const showAcceptManually =
    !!acceptManuallyAction &&
    !acceptManuallyAction.policyBlockedReason &&
    isActionAvailable(acceptManuallyAction, instance.status)

  return (
    <>
      {/* Keyed by the component's own function name, not the array index — see document-list.tsx's
          identical map for why. */}
      {customExtras.map((CustomExtra) => (
        <CustomExtra key={CustomExtra.name} descriptor={descriptor} instance={instance} />
      ))}

      {/* Always present: the PDF download alone earns the menu its place on every saved record. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" dataCy="document-actions-menu">
            {t("documents.detail.actions")}
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56" data-cy="document-actions-menu-content">
          {secondary.map((action) => {
            const hint = transitionHint(t, descriptor, action, state.currentStatus)
            const blocked = action.policyBlockedReason
              ? t("documents.form.actionBlockedByPolicy", { reason: action.policyBlockedReason })
              : undefined
            return (
              <DropdownMenuItem
                key={action.id}
                disabled={!!blocked}
                onSelect={() => state.runner.handleAction(action)}
                data-cy={`document-action-${action.id}`}
              >
                <div className="flex flex-col gap-0.5">
                  <span>{action.label}</span>
                  {hint && (
                    <span
                      className="text-xs text-muted-foreground"
                      data-cy={`document-transition-hint-${action.id}`}
                    >
                      {hint}
                    </span>
                  )}
                  {blocked && (
                    <span
                      className="max-w-xs text-xs text-muted-foreground"
                      data-cy={`document-blocked-reason-${action.id}`}
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
            data-cy="document-pdf-button"
          >
            <Download aria-hidden="true" />
            {t("documents.list.downloadPdf")}
          </DropdownMenuItem>

          {gates.downloadXml && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={!!gates.downloadXml.policyBlockedReason}
                data-cy="document-xml-button"
              >
                <FileCode aria-hidden="true" />
                {t("documents.list.downloadXml")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {DOCUMENT_XML_SYNTAXES.map(({ syntax, labelKey }) => (
                  <DropdownMenuItem
                    key={syntax}
                    onSelect={() => void downloadDocumentXml(descriptor.id, instance.id, syntax, t)}
                    data-cy={`document-xml-${syntax}`}
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
              onSelect={() => setShareLinkOpen(true)}
              data-cy="document-share-link-button"
            >
              <Link2 aria-hidden="true" />
              {t("documents.list.shareLink")}
            </DropdownMenuItem>
          )}

          {gates.recurrence && (
            <DropdownMenuItem onSelect={() => setRecurrenceOpen(true)} data-cy="document-recurrence-button">
              <Repeat aria-hidden="true" />
              {t("documents.schedules.rowAction.tooltip")}
            </DropdownMenuItem>
          )}

          {showAcceptManually && (
            <DropdownMenuItem
              onSelect={() => setMarkAcceptedOpen(true)}
              data-cy="document-accept-manually-button"
            >
              <UserCheck aria-hidden="true" />
              {t("documents.acceptance.menuLabel")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {isProcessing ? (
        <span className="px-2 text-sm text-muted-foreground" data-cy="document-detail-processing">
          {t("documents.list.processing")}
        </span>
      ) : (
        primary && (
          // `captions`: the "Draft → Sending" line under the one highlighted button is what tells a
          // reader what that click commits them to, before they click — the same caption every
          // secondary entry carries inside the menu.
          <DocumentActionButton
            descriptor={descriptor}
            action={primary}
            state={state}
            variant="default"
            captions
            className="flex flex-col items-end text-right"
          />
        )
      )}

      {gates.recurrence && recurrenceOpen && (
        <CreateRecurrenceDialog
          typeId={descriptor.id}
          sourceDocumentId={instance.id}
          offerThenSend={gates.offerThenSend}
          open={recurrenceOpen}
          onOpenChange={setRecurrenceOpen}
        />
      )}

      {gates.shareLink && shareLinkOpen && (
        <ShareLinkDialog
          typeId={descriptor.id}
          documentId={instance.id}
          open={shareLinkOpen}
          onOpenChange={setShareLinkOpen}
        />
      )}

      {showAcceptManually && markAcceptedOpen && (
        <MarkQuoteAcceptedDialog
          documentId={instance.id}
          data={instance.data}
          open={markAcceptedOpen}
          onOpenChange={setMarkAcceptedOpen}
        />
      )}
    </>
  )
}
