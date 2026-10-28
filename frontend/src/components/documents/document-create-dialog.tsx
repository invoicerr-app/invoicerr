import type React from "react"
import { useEffect } from "react"
import { useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { ActionParamsDialog } from "@/components/documents/action-params-dialog"
import { actionAssignsNumber } from "@/components/documents/action-presentation"
import { ConfirmationDialog } from "@/components/confirmation-dialog"
import { DocumentField } from "@/components/documents/document-field"
import { DocumentPaper } from "@/components/documents/document-paper"
import { BlockedActionReason, LineTotalWarnings } from "@/components/documents/document-form"
import { DocumentTotals, useDocumentTotals } from "@/components/documents/document-totals"
import type {
  DocumentFieldDescriptor,
  DocumentInstance,
  DocumentTypeDescriptor,
} from "@/components/documents/types"
import { useDocumentForm } from "@/components/documents/use-document-form"
import { Button } from "@/components/ui/button"
import { type FormPageSection, FormPageDialog } from "@/components/ui/form-page-dialog"
import { cn } from "@/lib/utils"
import { useClient, useCompany, useReferenceResolve } from "@/hooks/queries"
import { useDomesticInvoiceCurrencyRule } from "@/hooks/use-domestic-invoice-currency"

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
  /** See `useDocumentForm`'s own `UseDocumentFormOptions.lateData` header — passed straight through.
   *  Rendered nowhere by this component itself; only forwarded to the form hook that merges it. */
  lateData?: Record<string, unknown>
  /** Rendered at the top of the dialog body, above every step's own fields — e.g. the received-
   *  invoice upload flow's "reading the document…" spinner while its background OCR job is still
   *  running (`custom/received-invoice-upload-button.tsx`). Shown on EVERY step (not just the one
   *  current when it appears): `SteppedDialog` mounts exactly one step's `render()` at a time, and a
   *  caller has no way to know which step the user is looking at when the condition that produces
   *  this becomes true. `undefined` renders nothing — no behaviour change for any caller that doesn't
   *  pass it. */
  notice?: React.ReactNode
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
 *  - DETAILS: among what's left, every REQUIRED field (client, dates, currency…), plus an OPTIONAL
 *    source document, i.e. a field some 'rowSelection' names as its `sourceField` (a credit note's
 *    `invoice`), and the fields `lockedFromReference` to it: the source is picked before what it
 *    drives. Rendered in descriptor order, so the descriptor decides that the source comes first.
 *  - OPTIONS: every remaining (optional) field — notes, a client reference, a country overlay's
 *    added field, custom fields.
 *
 * A step with nothing in it is dropped rather than shown empty — the same rule the owner stated for
 * "a type with no lines skips that step" (e.g. `expense` has no table-shaped field at all: no Lines
 * step; `received-invoice` declares every field `required: false`: no Details step).
 */
function buildFieldGroups(fields: DocumentFieldDescriptor[]) {
  const sourceAndLockedKeys = new Set(
    fields
      .filter((field): field is DocumentFieldDescriptor & { sourceField: string } => {
        return field.kind === "rowSelection" && !!field.sourceField
      })
      .map((field) => field.sourceField),
  )
  for (const field of fields) {
    const followedKey = field.lockedFromReference?.field
    if (followedKey && sourceAndLockedKeys.has(followedKey)) sourceAndLockedKeys.add(field.key)
  }

  const lineFields: DocumentFieldDescriptor[] = []
  const detailsFields: DocumentFieldDescriptor[] = []
  const optionsFields: DocumentFieldDescriptor[] = []
  for (const field of fields) {
    if (isLinesKind(field)) lineFields.push(field)
    else if (field.required || sourceAndLockedKeys.has(field.key)) detailsFields.push(field)
    else optionsFields.push(field)
  }
  return { detailsFields, lineFields, optionsFields }
}

/** Short controls (dates, choices, numbers) sit two to a row; everything else takes the full width. */
function isShortField(field: DocumentFieldDescriptor): boolean {
  return ["date", "select", "number", "money", "boolean"].includes(field.kind)
}

/** One section's fields. `lineTotalWarnings` (a received invoice's "lines don't sum to its stated
 *  totals" hint) is passed only by the lines section, where the lines are. */
function FieldsSection({
  fields,
  documentTypeId,
  lineTotalWarnings,
}: {
  fields: DocumentFieldDescriptor[]
  documentTypeId: string
  lineTotalWarnings?: string[]
}) {
  return (
    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.key} className={cn("min-w-0", !isShortField(field) && "sm:col-span-2")}>
          <DocumentField field={field} name={field.key} documentTypeId={documentTypeId} />
        </div>
      ))}
      <div className="sm:col-span-2 empty:hidden">
        <LineTotalWarnings warnings={lineTotalWarnings} />
      </div>
    </div>
  )
}

/** The live sheet beside the form: what the client will read, rebuilt on every change. */
function DocumentLivePreview({ descriptor }: { descriptor: DocumentTypeDescriptor }) {
  const { t } = useTranslation()
  const totals = useDocumentTotals(descriptor)
  // Scoped to this component so a keystroke re-renders the preview, never the whole dialog.
  const values = useWatch() as Record<string, unknown>

  const clientField = descriptor.fields.find(
    (field) => field.kind === "reference" && field.entity === "client" && !field.entities,
  )
  const clientId = clientField ? (values[clientField.key] as string | undefined) : undefined
  const { data: resolvedClient } = useReferenceResolve(
    clientField ? "client" : undefined,
    clientId || undefined,
  )

  const lineFields = descriptor.fields.filter(isLinesKind)
  const lineCount = lineFields.reduce((sum, field) => {
    const rows = values[field.key]
    return sum + (Array.isArray(rows) ? rows.length : 0)
  }, 0)

  const notesField = descriptor.fields.find((field) => field.key === "notes" && field.kind === "longText")
  const notes = notesField ? (values[notesField.key] as string | undefined) : undefined

  return (
    <div className="space-y-5">
      <DocumentPaper
        descriptor={descriptor}
        data={values}
        totals={
          totals ? (
            <DocumentTotals descriptor={descriptor} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("documents.form.stepped.recap.noTotals")}</p>
          )
        }
      />
      <dl className="space-y-2 text-sm" data-cy="document-create-recap">
        {clientField && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">{t("documents.form.stepped.recap.clientLabel")}</dt>
            <dd className="font-medium text-foreground" data-cy="document-create-recap-client">
              {resolvedClient?.label ?? t("documents.form.stepped.recap.noClient")}
            </dd>
          </div>
        )}
        {lineFields.length > 0 && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">{t("documents.form.stepped.recap.lineCountLabel")}</dt>
            <dd className="font-medium text-foreground" data-cy="document-create-recap-line-count">
              {t("documents.form.stepped.recap.lineCountValue", { count: lineCount })}
            </dd>
          </div>
        )}
        {notesField && notes && (
          <div className="space-y-1">
            <dt className="text-muted-foreground">{t("documents.form.stepped.recap.notesTitle")}</dt>
            <dd className="whitespace-pre-wrap text-foreground" data-cy="document-create-recap-notes">
              {notes}
            </dd>
          </div>
        )}
      </dl>
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
  lateData,
  notice,
}: DocumentCreateDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const state = useDocumentForm({
    descriptor,
    initialData,
    lateData,
    onActionSuccess: (result: DocumentInstance) => {
      onOpenChange(false)
      void navigate(`/documents/${result.typeId}/${result.id}`)
    },
  })

  const { effectiveDescriptor } = state
  const { detailsFields, lineFields, optionsFields } = buildFieldGroups(effectiveDescriptor.fields)

  // Issue #558: preselect a country's own domestic-invoicing-currency (Algeria's DZD today) the
  // moment BOTH the active company and the chosen client turn out to be established in the same
  // country that declares one. A convenience only: the real enforcement is server side, at "send"
  // (country-policy/domestic-currency-issuance.ts): this effect never blocks anything, it only ever
  // fills in a value the user is free to change again before submitting.
  const currencyField = effectiveDescriptor.fields.find(
    (field) => field.kind === "select" && field.key === "currency",
  )
  const invoiceClientField = effectiveDescriptor.fields.find(
    (field) => field.kind === "reference" && field.entity === "client" && !field.entities,
  )
  // Watches the WHOLE form (never a conditional `name` filter, which would call this hook a
  // different number of times depending on whether `invoiceClientField` exists), same pattern
  // RecapStep below already uses for the identical reason.
  const watchedValues = useWatch({ control: state.form.control }) as Record<string, unknown>
  const invoiceClientId = invoiceClientField
    ? (watchedValues[invoiceClientField.key] as string | undefined)
    : undefined
  const { data: company } = useCompany()
  const { data: domesticCurrencyClient } = useClient(
    descriptor.id === "invoice" ? invoiceClientId : undefined,
  )
  const { data: domesticCurrencyRule } = useDomesticInvoiceCurrencyRule(
    company?.countryCode,
    descriptor.id === "invoice" && !!invoiceClientId,
  )
  useEffect(() => {
    if (descriptor.id !== "invoice" || !currencyField || !domesticCurrencyRule) return
    const sellerCountry = (company?.countryCode ?? "").trim().toUpperCase()
    const buyerCountry = (domesticCurrencyClient?.countryCode ?? "").trim().toUpperCase()
    if (!sellerCountry || !buyerCountry || sellerCountry !== buyerCountry) return
    // Never overwrite a value the user already touched by hand.
    if ((state.form.formState.dirtyFields as Record<string, unknown>)[currencyField.key]) return
    const current = state.form.getValues(currencyField.key) as string | undefined
    if (current === domesticCurrencyRule.currency) return
    state.form.setValue(currencyField.key, domesticCurrencyRule.currency, {
      shouldDirty: false,
      shouldValidate: false,
    })
  }, [
    descriptor.id,
    currencyField,
    domesticCurrencyRule,
    company?.countryCode,
    domesticCurrencyClient?.countryCode,
    state.form,
  ])

  // The first runnable action is the ONE filled button (the type's own "Save draft"/"Save");
  // anything else a never-saved record can already run is offered at the start of the footer.
  const primaryAction = state.availableActions.find((action) => !action.policyBlockedReason)
  const secondaryActions = state.availableActions.filter((action) => action.id !== primaryAction?.id)
  const pendingAction = state.runner.pendingAction

  const sections: FormPageSection[] = []
  if (detailsFields.length > 0) {
    sections.push({
      id: "details",
      label: t("documents.form.stepped.steps.details"),
      fields: detailsFields.map((field) => field.key),
      render: () => <FieldsSection fields={detailsFields} documentTypeId={descriptor.id} />,
    })
  }
  if (lineFields.length > 0) {
    sections.push({
      id: "lines",
      label: t("documents.form.stepped.steps.lines"),
      hideLabel: lineFields.length === 1,
      fields: lineFields.map((field) => field.key),
      render: () => (
        <FieldsSection
          fields={lineFields}
          documentTypeId={descriptor.id}
          lineTotalWarnings={state.lineTotalWarnings}
        />
      ),
    })
  }
  if (optionsFields.length > 0) {
    sections.push({
      id: "options",
      label: t("documents.form.stepped.steps.options"),
      fields: optionsFields.map((field) => field.key),
      render: () => <FieldsSection fields={optionsFields} documentTypeId={descriptor.id} />,
    })
  }

  return (
    <>
      <FormPageDialog
        sections={sections}
        form={state.form}
        open={open}
        onOpenChange={onOpenChange}
        title={t("documents.form.newTitle", { label: descriptor.label })}
        description={t("documents.form.editor.description")}
        notice={notice}
        preview={<DocumentLivePreview descriptor={effectiveDescriptor} />}
        previewLabel={t("documents.form.editor.previewLabel")}
        footerStart={
          <>
            {secondaryActions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant="ghost"
                loading={state.runner.isRunning && state.runner.pendingAction === undefined}
                disabled={!!action.policyBlockedReason}
                tooltip={action.policyBlockedReason ? t("documents.form.actionBlockedTitle") : undefined}
                onClick={() => state.runner.handleAction(action)}
                dataCy={`document-action-${action.id}`}
              >
                {action.label}
              </Button>
            ))}
            {secondaryActions.map(
              (action) =>
                action.policyBlockedReason && <BlockedActionReason key={action.id} action={action} />,
            )}
          </>
        }
        submitLabel={primaryAction?.label ?? t("common.save")}
        submitDataCy={primaryAction ? `document-action-${primaryAction.id}` : undefined}
        submitting={state.runner.isRunning && state.runner.pendingAction === undefined}
        submitDisabled={!primaryAction}
        submitTooltip={primaryAction ? undefined : t("documents.form.actionBlockedTitle")}
        onSubmit={() => {
          // handleAction reports every failure through a toast.
          if (primaryAction) void state.runner.handleAction(primaryAction)
        }}
        // Empty line items never survive a save: pruned before the whole-form validation.
        onBeforeValidate={state.pruneEmptyLines}
        dataCy="document-create-dialog"
        sectionsDataCy="document-form"
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

      {state.runner.pendingLockConfirm && (
        <ConfirmationDialog
          open
          onOpenChange={(open) => {
            if (!open) state.runner.cancelPendingLockConfirm()
          }}
          title={t("documents.form.lockConfirmation.title", { label: state.runner.pendingLockConfirm.label })}
          description={t(
            actionAssignsNumber(effectiveDescriptor, state.runner.pendingLockConfirm, state.currentStatus)
              ? "documents.form.lockConfirmation.descriptionWithNumbering"
              : "documents.form.lockConfirmation.description",
            { label: state.runner.pendingLockConfirm.label },
          )}
          confirmLabel={t("documents.form.lockConfirmation.confirm")}
          cancelLabel={t("documents.form.lockConfirmation.cancel")}
          onConfirm={state.runner.confirmPendingLock}
          loading={state.runner.isRunning}
          dataCy="document-create-lock-confirm"
        />
      )}
    </>
  )
}
