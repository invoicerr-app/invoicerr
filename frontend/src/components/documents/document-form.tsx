import { useTranslation } from "react-i18next"

import { ActionParamsDialog } from "@/components/documents/action-params-dialog"
import { actionAssignsNumber, transitionHint } from "@/components/documents/action-presentation"
import { ConfirmationDialog } from "@/components/confirmation-dialog"
import { DocumentDeleteConfirmDialog } from "@/components/documents/document-delete-confirm-dialog"
import { DocumentField } from "@/components/documents/document-field"
import { DocumentFormReadOnlyProvider } from "@/components/documents/document-form-readonly"
import type { DocumentActionDescriptor, DocumentTypeDescriptor } from "@/components/documents/types"
import type { DocumentFormState } from "@/components/documents/use-document-form"
import { useActionTransmissionPreview } from "@/hooks/queries/use-document-types"
import { useDemoMode } from "@/hooks/queries"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ProseHelp } from "@/components/ui/prose-help"
import { isDemoBlockedAction } from "@/lib/demo-actions"

/**
 * The rendered pieces of a document form — the fields, one action button, the params dialog —
 * with NO state of their own: everything they show comes from `useDocumentForm`
 * (use-document-form.ts), which the create dialog and the detail page each mount once and lay out
 * differently. No code here is specific to any one document type, nor to any one action.
 */

interface DocumentFormFieldsProps {
  descriptor: DocumentTypeDescriptor
  state: DocumentFormState
  /**
   * Issue #468 (point 3, the locked-record review finding): true whenever `action-presentation.ts`'s
   * `saveDraftLockNotice` fires for this record - an issued invoice/credit-note, a signed/accepted
   * quote, or a country-policy lock (see that function's own header) - as `document-detail.tsx`
   * already computes it for the notice above the form. Disables every field (line-item add/remove
   * buttons included, via `DocumentFormReadOnlyProvider`) so the form no longer LOOKS editable once
   * the backend would refuse to save it - the notice says WHY, this is what makes the screen AGREE
   * with it instead of leaving white, clickable inputs under a warning nobody connects to them.
   * Defaults to `false` - every pre-existing caller (the create dialog, which never has a locked
   * record to show) keeps rendering exactly as before.
   */
  readOnly?: boolean
}

/**
 * Every field the LIVE descriptor declares (`state.effectiveDescriptor` — the client-aware one, so a
 * B2G-added field appears the moment a government client is picked), plus the line-total warning
 * banner. `data-cy="document-form"` stays on the `<form>` itself: it is what every screen-driven
 * test reaches for to say "the form is here".
 */
export function DocumentFormFields({ descriptor, state, readOnly = false }: DocumentFormFieldsProps) {
  const { effectiveDescriptor, lineTotalWarnings } = state

  return (
    // Larger gap on mobile — owner feedback (2026-09-16): a flat list of fields with the desktop
    // gap (space-y-4) read as "too compressed" at 390px, unchanged from `sm:` up.
    // Read-only (issue #468): the UI kit only fades a disabled control to 50% opacity over a
    // transparent background, which on this white card reads as still editable. A muted fill on
    // every disabled control makes a locked form visibly different from an editable one.
    <form
      className={`space-y-6 sm:space-y-4${readOnly ? " [&_:is(input,textarea,button):disabled]:bg-muted" : ""}`}
      data-cy="document-form"
      onSubmit={(e) => e.preventDefault()}
    >
      <DocumentFormReadOnlyProvider value={readOnly}>
        {/* A plain marker, not a visible one - data-cy hook for the e2e suite (90-save-draft-lock.cy.ts)
            to assert the form is locked without depending on any one field's own disabled state. */}
        {readOnly && <span className="hidden" aria-hidden="true" data-cy="document-form-readonly" />}
        {effectiveDescriptor.fields.map((field) => (
          <DocumentField key={field.key} field={field} name={field.key} documentTypeId={descriptor.id} />
        ))}
      </DocumentFormReadOnlyProvider>

      <LineTotalWarnings warnings={lineTotalWarnings} />
    </form>
  )
}

// The supplier's own lines and totals disagree: a status the user acts on, the server's figures behind its `?`.
export function LineTotalWarnings({ warnings }: Readonly<{ warnings?: string[] }>) {
  const { t } = useTranslation()
  if (!warnings?.length) return null
  return (
    <ProseHelp
      tone="warning"
      title={t("documents.form.lineTotalWarningsTitle")}
      dataCy="document-line-total-warnings"
    >
      {warnings}
    </ProseHelp>
  )
}

// Not prefixed "document-action-": 17-document-descriptor.cy.ts reads that prefix as an action id.
export function BlockedActionReason({
  action,
  className,
}: Readonly<{ action: DocumentActionDescriptor; className?: string }>) {
  const { t } = useTranslation()
  return (
    <ProseHelp
      tone="warning"
      title={t("documents.form.actionBlockedTitle")}
      dataCy={`document-blocked-reason-${action.id}`}
      className={className}
    >
      {t("documents.form.actionBlockedByPolicy", { reason: action.policyBlockedReason })}
    </ProseHelp>
  )
}

interface DocumentActionButtonProps {
  descriptor: DocumentTypeDescriptor
  action: DocumentActionDescriptor
  state: DocumentFormState
  variant: "default" | "outline" | "secondary"
  /** Whether to print the transition caption and the blocked reason UNDER the button. The create
   *  dialog's footer does; the detail page's header keeps the same texts in the button's tooltip
   *  and in the actions menu instead, where there is room for them. */
  captions?: boolean
  className?: string
}

/**
 * One declared action as a button, plus — when `captions` is set — what it will DO to the status,
 * deduced from the descriptor's own `transitions` (never hard-coded here: an action with no
 * transitions, e.g. "convert-to-invoice", shows no caption at all), and the country policy's own
 * blocked reason when there is one.
 */
export function DocumentActionButton({
  descriptor,
  action,
  state,
  variant,
  captions = false,
  className,
}: DocumentActionButtonProps) {
  const { t } = useTranslation()
  const { currentStatus, runner } = state
  const { demoMode } = useDemoMode()
  const hint = transitionHint(t, descriptor, action, currentStatus)
  const demoBlocked = isDemoBlockedAction(action.id, demoMode)

  return (
    <div className={className}>
      <Button
        type="button"
        variant={variant}
        loading={runner.isRunning && runner.pendingAction === undefined}
        disabled={!!action.policyBlockedReason || demoBlocked}
        tooltip={
          action.policyBlockedReason
            ? t("documents.form.actionBlockedTitle")
            : demoBlocked
              ? t("demo.disabledTooltip", "Disabled in this demo.")
              : captions
                ? undefined
                : hint
        }
        onClick={() => runner.handleAction(action)}
        dataCy={`document-action-${action.id}`}
      >
        {action.label}
      </Button>
      {captions && hint && (
        // Not prefixed "document-action-": 17-document-descriptor.cy.ts reads that prefix as an action id.
        <p
          className="mt-1 max-w-xs text-xs text-muted-foreground"
          data-cy={`document-transition-hint-${action.id}`}
        >
          {hint}
        </p>
      )}
      {action.policyBlockedReason && <BlockedActionReason action={action} className="mt-1 max-w-xs" />}
    </div>
  )
}

/** The params dialog the action runner opens for an action that declares `params` — mounted once
 *  per screen, next to whatever renders that screen's action buttons. */
export function DocumentActionParamsHost({ state }: { state: DocumentFormState }) {
  const { runner } = state
  const pending = runner.pendingAction
  if (!pending) return null
  return (
    <ActionParamsDialog
      action={pending}
      defaultValues={runner.pendingDefaults}
      submitting={runner.isRunning}
      onCancel={runner.cancelPendingAction}
      onConfirm={(params) => runner.executeAction(pending.id, params)}
    />
  )
}

/** The confirmation the action runner opens for an action `actionLocksDocument` says is about to
 *  lock the record (see use-document-action-runner.ts's own header) — mounted once per screen, next
 *  to `DocumentActionParamsHost` above. Never names "send" or any one type: whatever action and
 *  whatever country policy produced this is what the runner already decided; this only renders it.
 *
 *  Issue #581 - ALSO fetches `useActionTransmissionPreview` for whichever action is pending, the
 *  moment the dialog is about to open (never earlier - `enabled` is tied to `!!pending`). An action
 *  with no transmission-preview resolver registered on the backend answers `{ transmits: false }`
 *  immediately, so this costs nothing extra for the overwhelming majority of locking actions
 *  (`send`/`cancel`/every other type's own) - only an action that DOES register one (today: the
 *  invoice's own "validate") can ever make the extra alert below appear. Progressive, never blocking:
 *  the dialog renders its ordinary warning immediately, the transmission alert simply joins it once
 *  (if) the preview resolves, never delaying Cancel/Confirm themselves. */
export function DocumentActionLockConfirmHost({ state }: { state: DocumentFormState }) {
  const { t } = useTranslation()
  const { runner, effectiveDescriptor, currentStatus, currentDocumentId } = state
  const pending = runner.pendingLockConfirm
  const { data: transmissionPreview } = useActionTransmissionPreview(
    effectiveDescriptor.id,
    currentDocumentId,
    pending?.id,
    !!pending,
  )
  if (!pending) return null
  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => {
        if (!open) runner.cancelPendingLockConfirm()
      }}
      title={t("documents.form.lockConfirmation.title", { label: pending.label })}
      description={t(
        actionAssignsNumber(effectiveDescriptor, pending, currentStatus)
          ? "documents.form.lockConfirmation.descriptionWithNumbering"
          : "documents.form.lockConfirmation.description",
        { label: pending.label },
      )}
      extraContent={
        transmissionPreview?.transmits ? (
          <Alert variant="warning" data-cy="document-action-transmission-alert">
            <AlertDescription>
              {t("documents.form.lockConfirmation.transmits", {
                label: pending.label,
                channel: transmissionPreview.channelLabel,
              })}
            </AlertDescription>
          </Alert>
        ) : undefined
      }
      confirmLabel={t("documents.form.lockConfirmation.confirm")}
      cancelLabel={t("documents.form.lockConfirmation.cancel")}
      onConfirm={runner.confirmPendingLock}
      loading={runner.isRunning}
      dataCy="document-detail-lock-confirm"
    />
  )
}

/** The delete confirmation the action runner opens, mounted once per screen like the lock host above. */
export function DocumentActionDeleteConfirmHost({ state }: Readonly<{ state: DocumentFormState }>) {
  const { runner } = state
  if (!runner.pendingDeleteConfirm) return null
  return (
    <DocumentDeleteConfirmDialog
      onCancel={runner.cancelPendingDeleteConfirm}
      onConfirm={runner.confirmPendingDelete}
      loading={runner.isRunning}
      dataCy="document-detail-delete-confirm"
    />
  )
}
