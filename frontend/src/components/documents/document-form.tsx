import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { ActionParamsDialog } from "@/components/documents/action-params-dialog"
import { DocumentField } from "@/components/documents/document-field"
import { DocumentTotals } from "@/components/documents/document-totals"
import { buildZodSchema, defaultValuesFor } from "@/components/documents/schema"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { isActionAvailable, resolveTransitionTarget, statusLabel } from "@/components/documents/types"
import { useDocumentActionRunner } from "@/components/documents/use-document-action-runner"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"

interface DocumentFormProps {
  descriptor: DocumentTypeDescriptor
  documentId?: string
  initialData?: Record<string, unknown>
  status?: string
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
  onActionSuccess,
}: DocumentFormProps) {
  const { t } = useTranslation()
  const [currentDocumentId, setCurrentDocumentId] = useState(documentId)
  const [currentStatus, setCurrentStatus] = useState(status)

  const schema = useMemo(() => buildZodSchema(descriptor.fields), [descriptor])
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: initialData ?? defaultValuesFor(descriptor.fields),
  })

  // The page keys DocumentForm by document id (a "new" vs. an existing one are different mounts),
  // so useState above already seeds currentDocumentId/currentStatus correctly. What a fresh mount
  // can't have yet is the record's DATA: useDocumentInstance resolves after mount, and
  // react-hook-form only applies `defaultValues` once, at mount — this is what re-applies it (and
  // the status that arrives alongside it) once the query actually resolves.
  useEffect(() => {
    if (initialData !== undefined) {
      form.reset(initialData)
    }
    if (status !== undefined) {
      setCurrentStatus(status)
    }
  }, [initialData, status, form])

  const { pendingAction, pendingDefaults, isRunning, handleAction, executeAction, cancelPendingAction } =
    useDocumentActionRunner({
      typeId: descriptor.id,
      documentId: currentDocumentId,
      getData: () => form.getValues(),
      validate: () => form.trigger(),
      onActionSuccess,
      onDocumentUpdate: (id, nextStatus) => {
        setCurrentDocumentId(id)
        setCurrentStatus(nextStatus)
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

  return (
    <Form {...form}>
      <form className="space-y-6" data-cy="document-form" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-4">
          {descriptor.fields.map((field) => (
            <DocumentField key={field.key} field={field} name={field.key} documentTypeId={descriptor.id} />
          ))}
        </div>

        <DocumentTotals descriptor={descriptor} />

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
                      to: statusLabel(descriptor, transitionTarget),
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
