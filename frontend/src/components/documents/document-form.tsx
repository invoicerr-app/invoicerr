import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { ActionParamsDialog } from "@/components/documents/action-params-dialog"
import { DocumentArchiveSection } from "@/components/documents/document-archive-section"
import { DocumentConformitySection } from "@/components/documents/document-conformity-section"
import { DocumentField } from "@/components/documents/document-field"
import { DocumentSettlementSection } from "@/components/documents/document-settlement"
import { DocumentTotals } from "@/components/documents/document-totals"
import { buildZodSchema, defaultValuesFor } from "@/components/documents/schema"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { isActionAvailable, resolveTransitionTarget, statusLabel } from "@/components/documents/types"
import { useDocumentActionRunner } from "@/components/documents/use-document-action-runner"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import { useDocumentType } from "@/hooks/queries"

/**
 * `data.lineTotalWarnings` — a RESERVED key (never a declared `DocumentFieldDescriptor`), the same
 * convention `received-invoice.descriptor.ts`'s own `fileRef`/`fileName`/`fileMime` already use for
 * bookkeeping the generic field-render never touches. Read here GENERICALLY, by key name only —
 * nothing below names "received-invoice" (TODO_PRODUIT.md T5(a)'s own `received-invoices/
 * line-totals-check.ts`, backend, is the only writer today; any future type could reuse the same key
 * and get this same rendering for free, exactly the "a country/type is data" discipline the rest of
 * this module already holds).
 */
function extractLineTotalWarnings(data: Record<string, unknown> | undefined): string[] {
  const warnings = data?.lineTotalWarnings
  return Array.isArray(warnings) ? warnings.filter((w): w is string => typeof w === "string") : []
}

interface DocumentFormProps {
  descriptor: DocumentTypeDescriptor
  documentId?: string
  initialData?: Record<string, unknown>
  status?: string
  /** The record's own displayNumber, as known when this form was opened — see types.ts's
   *  `DocumentInstance.displayNumber`. Absent/null for a not-yet-numbered (or never-numbered) record;
   *  re-synced live via `onDocumentUpdate` once an action actually numbers it (e.g. "send"), the same
   *  way `status` already is. */
  displayNumber?: string | null
  /** The record's own `lastActionError` — see types.ts's `DocumentInstance.lastActionError`. The
   *  write that sets it happens entirely inside the WORKER, out of band from any click this dialog
   *  itself triggers, so there is no action RESULT this component could ever read it back from —
   *  unlike `status`/`displayNumber` above, this is never re-synced into local state at all, only
   *  ever rendered straight from THIS prop, so it follows whatever the caller feeds it: the page
   *  ([typeId].tsx) re-derives it, live, from the SAME query cache the list itself polls while the
   *  record is "sending" (TODO.md item 22) — so it updates here too, without closing and reopening
   *  this dialog, the moment a "send" this very form triggered actually fails. */
  lastActionError?: string | null
  /** Fires after an action that actually changed the document — e.g. so a caller can refresh a list
   *  or "follow" the document once it exists (a fresh draft is created on the first save). Not
   *  called for an action whose result carries no document (see ActionResult on the backend). */
  onActionSuccess?: (result: DocumentInstance, actionId: string) => void
}

/**
 * Renders a document type's ENTIRE form from its descriptor — no code here is specific to any one
 * document type, nor to any one action. Add a type by writing a descriptor (backend) with fields the
 * field-renderer registry already covers; add an action (native or third-party) with an id, a label,
 * and optionally `params` — this component never changes either way.
 *
 * Lives inside a modal now (document-upsert-dialog.tsx) rather than posed directly on the page, but
 * nothing about ITS OWN contract changed for that move: it still only ever needs a descriptor and,
 * optionally, an existing instance's id/data/status.
 */
export function DocumentForm({
  descriptor,
  documentId,
  initialData,
  status,
  displayNumber,
  lastActionError,
  onActionSuccess,
}: DocumentFormProps) {
  const { t } = useTranslation()
  const [currentDocumentId, setCurrentDocumentId] = useState(documentId)
  const [currentStatus, setCurrentStatus] = useState(status)
  const [currentDisplayNumber, setCurrentDisplayNumber] = useState(displayNumber ?? null)
  // TODO_PRODUIT.md T5(a) — see extractLineTotalWarnings's own header. Seeded from whatever this
  // instance already carried (a reopened, already-saved record); re-derived below both when
  // `initialData` itself changes AND the moment "receive" runs again (a save recomputes it — see
  // received-invoice-actions.ts's own header), so editing a line and saving reacts immediately,
  // without waiting on a page reload or a second fetch.
  const [lineTotalWarnings, setLineTotalWarnings] = useState(() => extractLineTotalWarnings(initialData))

  // The B2G document-field bridge's OWN screen gap (root TODO's "the Leitweg field is proven only at
  // the service level, not interactive"): `descriptor` (this component's own prop) was fetched by the
  // PAGE with no client known yet, so a rule's `requiredDocumentFields` (e.g. Germany's Leitweg-ID,
  // `documents.service.ts#applyB2gDocumentFieldHints`) never reaches it. This watches whichever field
  // is THIS type's own single-target 'reference' to "client" (the same key `b2g-routing.ts`'s own
  // header names — "the invoice's own submitted `data.client`") and re-fetches the descriptor WITH
  // that id the moment it changes, so picking a GOVERNMENT client adds the field reactively, and
  // picking a different one removes it again — never a static, page-load-time-only view.
  //
  // `watchedClientId` is plain `useState`, NOT `form.watch` read directly — it (and the descriptor,
  // and the schema built from it) must all be known BEFORE `useForm` below is even called, so the
  // VERY FIRST resolver already validates any B2G-added field; `form.watch` needs `form` to exist
  // first, which is exactly the ordering this avoids. Seeded from `initialData` so an EXISTING
  // government-client document already shows its B2G field(s) on the first paint, not only after the
  // user re-touches the client field.
  const clientFieldKey = descriptor.fields.find(
    (field) => field.kind === "reference" && field.entity === "client" && !field.entities,
  )?.key
  const [watchedClientId, setWatchedClientId] = useState<string | undefined>(() => {
    if (!clientFieldKey) return undefined
    const raw = (initialData as Record<string, unknown> | undefined)?.[clientFieldKey]
    return typeof raw === "string" && raw ? raw : undefined
  })
  const { data: liveDescriptor } = useDocumentType(descriptor.id, watchedClientId)
  // Falls back to the page-provided `descriptor` the instant the client-aware fetch hasn't resolved
  // yet (a fresh id just picked, or none at all) — never a blank form while it's in flight, and this
  // hook's own query-key collapse (see use-document-types.ts) means the "no client yet" case reuses
  // the SAME cache entry `descriptor` itself came from, not a second request.
  const effectiveDescriptor = liveDescriptor ?? descriptor
  const schema = useMemo(() => buildZodSchema(effectiveDescriptor.fields), [effectiveDescriptor])

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: initialData ?? defaultValuesFor(descriptor.fields),
  })

  // Keeps `watchedClientId` in sync with the LIVE form value of the client field — a plain
  // subscription into local state (see the comment above for why this isn't `form.watch` read
  // directly): every change re-derives `liveDescriptor`/`effectiveDescriptor` above, which is what
  // makes the B2G field(s) appear or disappear the moment the user picks a different client.
  useEffect(() => {
    if (!clientFieldKey) return
    const subscription = form.watch((values, info) => {
      if (info.name !== undefined && info.name !== clientFieldKey) return
      const raw = (values as Record<string, unknown>)[clientFieldKey]
      setWatchedClientId(typeof raw === "string" && raw ? raw : undefined)
    })
    return () => subscription.unsubscribe()
  }, [form, clientFieldKey])

  // The page keys DocumentForm by document id (a "new" vs. an existing one are different mounts),
  // so useState above already seeds currentDocumentId/currentStatus correctly. What a fresh mount
  // can't have yet is the record's DATA: useDocumentInstance resolves after mount, and
  // react-hook-form only applies `defaultValues` once, at mount — this is what re-applies it (and
  // the status that arrives alongside it) once the query actually resolves.
  //
  // This effect ALSO keeps firing for as long as the dialog stays open on the SAME record (the `key`
  // on DocumentUpsertDialog never changes, so this never remounts): the caller ([typeId].tsx) now
  // re-derives `status`/`displayNumber` LIVE from the same query cache the list itself polls while a
  // record is "sending" (TODO.md item 22), so once a "send" this form triggered actually settles —
  // "sending" -> "sent" or "send_failed" — `currentStatus` catches up here too, without closing and
  // reopening this dialog. `initialData`'s own object reference stays the frozen snapshot the whole
  // time (see [typeId].tsx's own comment on why), so `form.reset` never re-fires from this alone.
  useEffect(() => {
    if (initialData !== undefined) {
      form.reset(initialData)
    }
    if (status !== undefined) {
      setCurrentStatus(status)
    }
    if (displayNumber !== undefined) {
      setCurrentDisplayNumber(displayNumber ?? null)
    }
    if (initialData !== undefined) {
      setLineTotalWarnings(extractLineTotalWarnings(initialData))
    }
  }, [initialData, status, displayNumber, form])

  const { pendingAction, pendingDefaults, isRunning, handleAction, executeAction, cancelPendingAction } =
    useDocumentActionRunner({
      typeId: descriptor.id,
      documentId: currentDocumentId,
      getData: () => form.getValues(),
      validate: () => form.trigger(),
      onActionSuccess: (result, actionId) => {
        // See extractLineTotalWarnings's own header — this is why the SAVE round-trip alone (never a
        // client-side recomputation) already reacts: `result.data` is this exact record's own,
        // freshly-persisted `data`, straight off the action's own response.
        setLineTotalWarnings(extractLineTotalWarnings(result.data))
        onActionSuccess?.(result, actionId)
      },
      onDocumentUpdate: (id, nextStatus, _nextNumber, nextDisplayNumber) => {
        setCurrentDocumentId(id)
        setCurrentStatus(nextStatus)
        setCurrentDisplayNumber(nextDisplayNumber ?? null)
      },
    })

  // The STATUS gate (isActionAvailable) is unchanged: an action outside its `availableWhen` for the
  // current status simply never appears here, exactly as before. The COUNTRY POLICY gate is a
  // second, independent concern layered on top: an action that passes the status gate can still
  // carry a `policyBlockedReason` (see types.ts), in which case it stays ON SCREEN — rendered
  // disabled with the reason spelled out — rather than disappearing. A vanished button looks like a
  // missing feature; a disabled one with a reason looks like a rule, which is what it is.
  const availableActions = descriptor.actions.filter((action) => isActionAvailable(action, currentStatus))
  const firstRunnableAction = availableActions.find((action) => !action.policyBlockedReason)

  // The settlement section (payments, credit notes, balance — document-settlement.tsx): shown for
  // ANY document type once "record-payment" is actually OFFERED for the record's current status —
  // never by naming a type. A brand-new, never-saved record (no `currentDocumentId` yet) has nothing
  // to show here either way: there is no instance to fetch a settlement FOR.
  const showSettlement =
    !!currentDocumentId && availableActions.some((action) => action.id === "record-payment")

  return (
    <Form {...form}>
      <form className="space-y-6" data-cy="document-form" onSubmit={(e) => e.preventDefault()}>
        {descriptor.numbering && (
          <p className="font-mono text-sm text-muted-foreground" data-cy="document-form-number">
            {currentDisplayNumber ?? t("documents.numbering.noneYet")}
          </p>
        )}

        {lastActionError && (
          // Same generic surfacing as document-list.tsx's own card — never a silent failure
          // (TODO.md item 22). Kept live by the CALLER — see this prop's own comment above.
          <p className="text-sm text-destructive" data-cy="document-form-last-error">
            {t("documents.list.lastActionError", { message: lastActionError })}
          </p>
        )}

        <div className="space-y-4">
          {effectiveDescriptor.fields.map((field) => (
            <DocumentField key={field.key} field={field} name={field.key} documentTypeId={descriptor.id} />
          ))}
        </div>

        <DocumentTotals descriptor={descriptor} />

        {/* TODO_PRODUIT.md T5(a) — see extractLineTotalWarnings's own header: a NAMED, never-blocking
            warning when this record's own lines don't sum to its stated totals (rounding tolerance
            aside). Rendered verbatim, untranslated, exactly like DocumentTotals's own `warnings`
            block just above (both are backend-composed sentences, not i18n keys). */}
        {lineTotalWarnings.length > 0 && (
          <div
            className="space-y-1 rounded-md border border-yellow-300 bg-yellow-50 p-3"
            data-cy="document-line-total-warnings"
          >
            {lineTotalWarnings.map((warning) => (
              <p key={warning} className="text-xs text-yellow-800">
                {warning}
              </p>
            ))}
          </div>
        )}

        {showSettlement && currentDocumentId && (
          <DocumentSettlementSection typeId={descriptor.id} documentId={currentDocumentId} />
        )}

        {/* Root TODO item 14 ("archivage légal ⚖") — shown for ANY document type/status once it has
            at least one archive (the component itself renders nothing otherwise, see its own header):
            never gated on "sent" here, since the component's own emptiness check already carries
            that fact (a draft has no archive yet, whatever its type). */}
        {currentDocumentId && (
          <DocumentArchiveSection typeId={descriptor.id} documentId={currentDocumentId} />
        )}

        {/* Root TODO item 10's own named remainder ("le suivi de conformité") — same gate as the
            archive section right above (any type/status once it has at least one event; renders
            nothing otherwise, see that component's own header): a document sent by email, or by a
            channel with no poller (e.g. "sdi"), never shows a section here at all. */}
        {currentDocumentId && (
          <DocumentConformitySection typeId={descriptor.id} documentId={currentDocumentId} />
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {availableActions.map((action) => {
            // What this action will DO to the status, deduced from the descriptor's own declared
            // `transitions` (types.ts's resolveTransitionTarget) — never hard-coded here: an action
            // with no transitions (e.g. "convert-to-invoice", "duplicate") shows no hint at all,
            // since it never changes THIS record's own status.
            const transitionTarget = resolveTransitionTarget(action, currentStatus)

            return (
              <div key={action.id} className="flex max-w-full flex-col gap-1">
                <Button
                  type="button"
                  variant={action.id === firstRunnableAction?.id ? "default" : "outline"}
                  loading={isRunning && pendingAction === undefined}
                  disabled={!!action.policyBlockedReason}
                  tooltip={action.policyBlockedReason}
                  onClick={() => handleAction(action)}
                  dataCy={`document-action-${action.id}`}
                >
                  {action.label}
                </Button>
                {transitionTarget && (
                  // Deliberately NOT prefixed "document-action-" — see the sibling blocked-reason
                  // paragraph's own comment on why 17-document-descriptor.cy.ts's action-button scan
                  // would otherwise misread this as a bogus action.
                  <p
                    className="max-w-xs text-xs text-muted-foreground"
                    data-cy={`document-transition-hint-${action.id}`}
                  >
                    {t("documents.form.transitionHint", {
                      from:
                        currentStatus !== undefined
                          ? statusLabel(descriptor, currentStatus)
                          : t("documents.form.transitionFromNew"),
                      // `transitionTarget` is an ARRAY for a transition with more than one honest
                      // outcome (the async "send" shape, TODO.md item 22: the worker's replay either
                      // succeeds or, after every retry, fails) — joined with a translated "or" rather
                      // than picking one arbitrarily, so the hint stays truthful about both.
                      to: (Array.isArray(transitionTarget) ? transitionTarget : [transitionTarget])
                        .map((status) => statusLabel(descriptor, status))
                        .join(` ${t("documents.form.transitionOr")} `),
                    })}
                  </p>
                )}
                {action.policyBlockedReason && (
                  // Deliberately NOT prefixed "document-action-" — that prefix is what
                  // 17-document-descriptor.cy.ts's "no button appears that the descriptor didn't
                  // declare" check scans for, and treats every match as an ACTION id to look up in the
                  // descriptor; a reason element sharing that prefix would be misread as a bogus action.
                  <p
                    className="max-w-xs text-xs text-muted-foreground"
                    data-cy={`document-blocked-reason-${action.id}`}
                  >
                    {t("documents.form.actionBlockedByPolicy", { reason: action.policyBlockedReason })}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </form>

      {pendingAction && (
        <ActionParamsDialog
          action={pendingAction}
          defaultValues={pendingDefaults}
          submitting={isRunning}
          onCancel={cancelPendingAction}
          onConfirm={(params) => executeAction(pendingAction.id, params)}
        />
      )}
    </Form>
  )
}
