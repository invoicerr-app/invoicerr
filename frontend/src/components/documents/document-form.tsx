import { useTranslation } from "react-i18next"

import { ActionParamsDialog } from "@/components/documents/action-params-dialog"
import { transitionHint } from "@/components/documents/action-presentation"
import { DocumentField } from "@/components/documents/document-field"
import type { DocumentActionDescriptor, DocumentTypeDescriptor } from "@/components/documents/types"
import type { DocumentFormState } from "@/components/documents/use-document-form"
import { Button } from "@/components/ui/button"

/**
 * The rendered pieces of a document form — the fields, one action button, the params dialog —
 * with NO state of their own: everything they show comes from `useDocumentForm`
 * (use-document-form.ts), which the create dialog and the detail page each mount once and lay out
 * differently. No code here is specific to any one document type, nor to any one action.
 */

interface DocumentFormFieldsProps {
  descriptor: DocumentTypeDescriptor
  state: DocumentFormState
}

/**
 * Every field the LIVE descriptor declares (`state.effectiveDescriptor` — the client-aware one, so a
 * B2G-added field appears the moment a government client is picked), plus the line-total warning
 * banner. `data-cy="document-form"` stays on the `<form>` itself: it is what every screen-driven
 * test reaches for to say "the form is here".
 */
export function DocumentFormFields({ descriptor, state }: DocumentFormFieldsProps) {
  const { effectiveDescriptor, lineTotalWarnings } = state

  return (
    <form className="space-y-4" data-cy="document-form" onSubmit={(e) => e.preventDefault()}>
      {effectiveDescriptor.fields.map((field) => (
        <DocumentField key={field.key} field={field} name={field.key} documentTypeId={descriptor.id} />
      ))}

      {/* See use-document-form.ts's extractLineTotalWarnings: a NAMED, never-blocking warning when
          this record's own lines don't sum to its stated totals (rounding tolerance aside).
          Rendered verbatim, untranslated, exactly like DocumentTotals's own `warnings` block (both
          are backend-composed sentences, not i18n keys). */}
      {lineTotalWarnings.length > 0 && (
        <div className="space-y-1 rounded-md bg-warning p-3" data-cy="document-line-total-warnings">
          {lineTotalWarnings.map((warning) => (
            <p key={warning} className="text-xs text-warning-foreground">
              {warning}
            </p>
          ))}
        </div>
      )}
    </form>
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
  const hint = transitionHint(t, descriptor, action, currentStatus)
  const blocked = action.policyBlockedReason
    ? t("documents.form.actionBlockedByPolicy", { reason: action.policyBlockedReason })
    : undefined

  return (
    <div className={className}>
      <Button
        type="button"
        variant={variant}
        loading={runner.isRunning && runner.pendingAction === undefined}
        disabled={!!action.policyBlockedReason}
        tooltip={blocked ?? (captions ? undefined : hint)}
        onClick={() => runner.handleAction(action)}
        dataCy={`document-action-${action.id}`}
      >
        {action.label}
      </Button>
      {captions && hint && (
        // Deliberately NOT prefixed "document-action-" — see the sibling blocked-reason
        // paragraph's own comment on why 17-document-descriptor.cy.ts's action-button scan
        // would otherwise misread this as a bogus action.
        <p
          className="mt-1 max-w-xs text-xs text-muted-foreground"
          data-cy={`document-transition-hint-${action.id}`}
        >
          {hint}
        </p>
      )}
      {blocked && (
        // Deliberately NOT prefixed "document-action-" — that prefix is what
        // 17-document-descriptor.cy.ts's "no button appears that the descriptor didn't
        // declare" check scans for, and treats every match as an ACTION id to look up in the
        // descriptor; a reason element sharing that prefix would be misread as a bogus action.
        // Always printed, captions or not: a disabled <button> (`disabled:pointer-events-none`,
        // ui/button.tsx) never receives a real hover, so a tooltip alone would leave a mouse user
        // staring at a grayed-out button with no reason in sight.
        <p
          className="mt-1 max-w-xs text-xs text-muted-foreground"
          data-cy={`document-blocked-reason-${action.id}`}
        >
          {blocked}
        </p>
      )}
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
