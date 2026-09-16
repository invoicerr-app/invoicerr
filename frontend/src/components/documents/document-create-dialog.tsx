import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { ActionParamsDialog } from "@/components/documents/action-params-dialog"
import { DocumentField } from "@/components/documents/document-field"
import { DocumentTotals, useDocumentTotals } from "@/components/documents/document-totals"
import type {
  DocumentActionDescriptor,
  DocumentFieldDescriptor,
  DocumentInstance,
  DocumentTypeDescriptor,
} from "@/components/documents/types"
import { useDocumentForm, type DocumentFormState } from "@/components/documents/use-document-form"
import { Button } from "@/components/ui/button"
import { type SteppedDialogStep, SteppedDialog } from "@/components/ui/stepped-dialog"
import { useReferenceResolve } from "@/hooks/queries"

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

/** Whether a field is "table-shaped" — a set of ROWS rather than one scalar value: 'array' (line
 *  items) and 'rowSelection' (a credit note's own "which lines does this correct" picker) are the
 *  two kinds today. Both get their own "Lines" step, regardless of `required` — see `buildSteps`'s
 *  own header for the full criterion. */
function isLinesKind(field: DocumentFieldDescriptor): boolean {
  return field.kind === "array" || field.kind === "rowSelection"
}

/**
 * Splits a document type's live fields into the wizard's steps — the one place this dialog decides
 * "which field goes on which screen" (owner decision, 2026-09-16: every large dialog moves to a
 * stepped shape, `components/ui/stepped-dialog.tsx`). The criterion, spelled out because nothing
 * about it is inherent to the field vocabulary itself:
 *
 *  - LINES: any table-shaped field (`isLinesKind` above) — a document's own line items, or (credit
 *    note) the source invoice's lines it corrects. Always its own step, whatever its `required`.
 *  - DETAILS: among what's left, every REQUIRED field — the facts a record cannot be saved without
 *    (client, dates, currency…), i.e. the record's own "identity".
 *  - OPTIONS: every remaining (optional) field — notes, a client reference, a country overlay's
 *    added field, custom fields.
 *
 * A step with nothing in it is dropped rather than shown empty — the same rule the owner stated for
 * "a type with no lines skips that step" (e.g. `expense` has no table-shaped field at all: no Lines
 * step; `received-invoice` declares every field `required: false`: no Details step).
 */
function buildFieldGroups(fields: DocumentFieldDescriptor[]) {
  const lineFields: DocumentFieldDescriptor[] = []
  const detailsFields: DocumentFieldDescriptor[] = []
  const optionsFields: DocumentFieldDescriptor[] = []
  for (const field of fields) {
    if (isLinesKind(field)) lineFields.push(field)
    else if (field.required) detailsFields.push(field)
    else optionsFields.push(field)
  }
  return { detailsFields, lineFields, optionsFields }
}

/** One step's worth of plain fields — `data-cy="document-form"` on the wrapper is unchanged from
 *  the pre-wizard single-screen form: every screen-driven e2e test still reaches for that one
 *  selector to say "the (current step's) form is here", then addresses fields by name underneath
 *  it. Only ONE step is ever mounted at a time (`SteppedDialog` renders the current step alone), so
 *  the same `data-cy` recurring across steps is never a collision at runtime.
 *
 *  `lineTotalWarnings` (a received invoice's own "lines don't sum to its stated totals" hint — see
 *  use-document-form.ts's `extractLineTotalWarnings`) is passed ONLY by the "Lines" step's own call
 *  below: it is about the lines, and this is the one step where they are on screen. */
function FieldsStep({
  fields,
  documentTypeId,
  lineTotalWarnings,
}: {
  fields: DocumentFieldDescriptor[]
  documentTypeId: string
  lineTotalWarnings?: string[]
}) {
  return (
    <div className="space-y-6 sm:space-y-4" data-cy="document-form">
      {fields.map((field) => (
        <DocumentField key={field.key} field={field} name={field.key} documentTypeId={documentTypeId} />
      ))}
      {lineTotalWarnings && lineTotalWarnings.length > 0 && (
        <div className="space-y-1 rounded-md bg-warning p-3" data-cy="document-line-total-warnings">
          {lineTotalWarnings.map((warning) => (
            <p key={warning} className="text-xs text-warning-foreground">
              {warning}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

interface RecapStepProps {
  descriptor: DocumentTypeDescriptor
  state: DocumentFormState
  primaryAction?: DocumentActionDescriptor
  secondaryActions: DocumentActionDescriptor[]
}

/**
 * The closing step: nothing left to fill in, only what's about to be saved — client, how many
 * lines, and the net/VAT/gross breakdown (`DocumentTotals`, the exact same live client-side
 * recompute the old flat form showed under the lines). No new backend call: a document being
 * CREATED has no `issueDate`-anchored legal mentions yet (those are resolved at "send" time —
 * `tax/tax-engine.ts`'s own `LOCALIZED_MENTION`, and France's `mentions/` catalog — against a
 * record that doesn't exist yet), so this reuses whatever free-text `notes` field the descriptor
 * already declares as the recap's own "what will print on it" line, rather than inventing a
 * pre-save mentions endpoint.
 */
function RecapStep({ descriptor, state, primaryAction, secondaryActions }: RecapStepProps) {
  const { t } = useTranslation()
  const totals = useDocumentTotals(descriptor)

  const clientField = descriptor.fields.find(
    (field) => field.kind === "reference" && field.entity === "client" && !field.entities,
  )
  const clientId = clientField ? (state.form.watch(clientField.key) as string | undefined) : undefined
  const { data: resolvedClient } = useReferenceResolve(
    clientField ? "client" : undefined,
    clientId || undefined,
  )

  const lineFields = descriptor.fields.filter(isLinesKind)
  const lineCount = lineFields.reduce((sum, field) => {
    const rows = state.form.watch(field.key)
    return sum + (Array.isArray(rows) ? rows.length : 0)
  }, 0)

  const notesField = descriptor.fields.find((field) => field.key === "notes" && field.kind === "longText")
  const notes = notesField ? (state.form.watch(notesField.key) as string | undefined) : undefined

  return (
    <div className="space-y-6" data-cy="document-create-recap">
      {clientField && (
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t("documents.form.stepped.recap.clientLabel")}</span>
          <span className="font-medium text-foreground" data-cy="document-create-recap-client">
            {resolvedClient?.label ?? t("documents.form.stepped.recap.noClient")}
          </span>
        </div>
      )}

      {lineFields.length > 0 && (
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t("documents.form.stepped.recap.lineCountLabel")}</span>
          <span className="font-medium text-foreground" data-cy="document-create-recap-line-count">
            {t("documents.form.stepped.recap.lineCountValue", { count: lineCount })}
          </span>
        </div>
      )}

      {notesField && notes && (
        <div className="space-y-1 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("documents.form.stepped.recap.notesTitle")}
          </p>
          <p className="whitespace-pre-wrap text-foreground" data-cy="document-create-recap-notes">
            {notes}
          </p>
        </div>
      )}

      <div className="border-t pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("documents.form.stepped.recap.totalsTitle")}
        </p>
        {totals ? (
          <DocumentTotals descriptor={descriptor} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("documents.form.stepped.recap.noTotals")}</p>
        )}
      </div>

      {secondaryActions.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {secondaryActions.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              loading={state.runner.isRunning && state.runner.pendingAction === undefined}
              disabled={!!action.policyBlockedReason}
              tooltip={
                action.policyBlockedReason
                  ? t("documents.form.actionBlockedByPolicy", { reason: action.policyBlockedReason })
                  : undefined
              }
              onClick={() => state.runner.handleAction(action)}
              dataCy={`document-action-${action.id}`}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
      {primaryAction?.policyBlockedReason && (
        <p className="text-xs text-muted-foreground" data-cy={`document-blocked-reason-${primaryAction.id}`}>
          {t("documents.form.actionBlockedByPolicy", { reason: primaryAction.policyBlockedReason })}
        </p>
      )}
    </div>
  )
}

/**
 * The CREATE surface for ANY document type: a `SteppedDialog` (components/ui/stepped-dialog.tsx) —
 * Details → Lines → Options → Summary, built from the live descriptor's own fields (`buildFieldGroups`
 * above), a step dropped when it has nothing to show. Everything that only makes sense once a
 * record EXISTS (settlement, legal archive, conformity, reconciliation, the full action set) still
 * lives on the record's own page (document-detail.tsx), which is exactly where a successful first
 * save lands: this dialog closes itself and navigates there, for the type the ACTION hands back —
 * never the type this dialog was opened for, which differ the moment an action creates a foreign
 * record (a quote's "convert-to-invoice"; today no create-time action does, the rule still holds).
 *
 * `SteppedDialog`'s own fixed footer holds the primary action — its `data-cy` is deliberately
 * overridden (`submitDataCy`) to `document-action-<id>` (e.g. `document-action-save-draft`), the
 * EXACT attribute the pre-wizard flat form already carried: every screen-driven e2e spec that
 * clicked "Save draft" keeps clicking the same selector, only reached one step later now.
 */
export function DocumentCreateDialog({
  descriptor,
  open,
  onOpenChange,
  initialData,
}: DocumentCreateDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const state = useDocumentForm({
    descriptor,
    initialData,
    onActionSuccess: (result: DocumentInstance) => {
      onOpenChange(false)
      navigate(`/documents/${result.typeId}/${result.id}`)
    },
  })

  const { effectiveDescriptor } = state
  const { detailsFields, lineFields, optionsFields } = buildFieldGroups(effectiveDescriptor.fields)

  // The first runnable action is the ONE default button (the type's own "Save draft"/"Save"),
  // shown as the wizard's final "Continue"; anything else a never-saved record can already run is
  // offered alongside, on the Summary step, quieter (unchanged from the pre-wizard footer).
  const primaryAction = state.availableActions.find((action) => !action.policyBlockedReason)
  const secondaryActions = state.availableActions.filter((action) => action.id !== primaryAction?.id)
  const pendingAction = state.runner.pendingAction

  const steps: SteppedDialogStep[] = []
  if (detailsFields.length > 0) {
    steps.push({
      id: "details",
      label: t("documents.form.stepped.steps.details"),
      fields: detailsFields.map((field) => field.key),
      render: () => <FieldsStep fields={detailsFields} documentTypeId={descriptor.id} />,
    })
  }
  if (lineFields.length > 0) {
    steps.push({
      id: "lines",
      label: t("documents.form.stepped.steps.lines"),
      fields: lineFields.map((field) => field.key),
      render: () => (
        <FieldsStep
          fields={lineFields}
          documentTypeId={descriptor.id}
          lineTotalWarnings={state.lineTotalWarnings}
        />
      ),
    })
  }
  if (optionsFields.length > 0) {
    steps.push({
      id: "options",
      label: t("documents.form.stepped.steps.options"),
      fields: optionsFields.map((field) => field.key),
      render: () => <FieldsStep fields={optionsFields} documentTypeId={descriptor.id} />,
    })
  }
  steps.push({
    id: "recap",
    label: t("documents.form.stepped.steps.recap"),
    fields: [],
    render: () => (
      <RecapStep
        descriptor={effectiveDescriptor}
        state={state}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
      />
    ),
  })

  return (
    <>
      <SteppedDialog
        steps={steps}
        form={state.form}
        open={open}
        onOpenChange={onOpenChange}
        title={t("documents.form.newTitle", { label: descriptor.label })}
        submitLabel={primaryAction?.label ?? t("common.next")}
        submitDataCy={primaryAction ? `document-action-${primaryAction.id}` : undefined}
        submitting={state.runner.isRunning && state.runner.pendingAction === undefined}
        onSubmit={() => {
          if (primaryAction) state.runner.handleAction(primaryAction)
        }}
        dataCy="document-create-dialog"
      />

      {pendingAction && (
        <ActionParamsDialog
          action={pendingAction}
          defaultValues={state.runner.pendingDefaults}
          submitting={state.runner.isRunning}
          onCancel={state.runner.cancelPendingAction}
          onConfirm={(params) => state.runner.executeAction(pendingAction.id, params)}
        />
      )}
    </>
  )
}
