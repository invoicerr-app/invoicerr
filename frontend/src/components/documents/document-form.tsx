import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { ActionParamsDialog } from "@/components/documents/action-params-dialog"
import { DocumentField } from "@/components/documents/document-field"
import { buildZodSchema, defaultValuesFor } from "@/components/documents/schema"
import type {
  DocumentActionDescriptor,
  DocumentInstance,
  DocumentTypeDescriptor,
} from "@/components/documents/types"
import { isActionAvailable } from "@/components/documents/types"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import { useResolveActionParamsDefaults, useRunDocumentAction } from "@/hooks/queries"
import { ApiError } from "@/hooks/use-api-query"

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

  // An action with declared `params` opens a dialog to collect them first; `pendingAction` is which
  // one is currently open (undefined = closed), `pendingDefaults` is its pre-filled values once the
  // (optional) defaults resolver has answered.
  const [pendingAction, setPendingAction] = useState<DocumentActionDescriptor | undefined>()
  const [pendingDefaults, setPendingDefaults] = useState<Record<string, unknown>>({})

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

  const runAction = useRunDocumentAction()
  const resolveDefaults = useResolveActionParamsDefaults()

  const executeAction = async (actionId: string, params: Record<string, unknown>) => {
    try {
      const result = await runAction.mutateAsync({
        typeId: descriptor.id,
        actionId,
        documentId: currentDocumentId,
        data: form.getValues(),
        params,
      })
      // Only adopt the result as THIS form's own record when it is actually the same document
      // TYPE — an action can create an instance of a DIFFERENT type instead (e.g. the quote's
      // "convert-to-invoice" hands back a brand-new INVOICE while this form is still the quote's).
      // This form must not start behaving as if it were now editing that foreign record; the caller
      // decides what to do with it via `onActionSuccess` below (see the document type page, which
      // navigates to the other type's own screen).
      if (result.document && result.document.typeId === descriptor.id) {
        setCurrentDocumentId(result.document.id)
        setCurrentStatus(result.document.status)
      }
      toast.success(result.message ?? t("documents.form.messages.actionSuccess"))
      setPendingAction(undefined)
      if (result.changed && result.document) {
        onActionSuccess?.(result.document, actionId)
      }
    } catch (error) {
      // The message IS the point here: a 501 means the action is declared on this document type
      // but nobody registered an implementation for it yet — say exactly that, never fail silently.
      const message = error instanceof ApiError ? error.message : t("documents.form.messages.actionError")
      toast.error(message)
    }
  }

  const handleAction = async (action: DocumentActionDescriptor) => {
    const valid = await form.trigger()
    if (!valid) {
      toast.error(t("documents.form.messages.invalid"))
      return
    }

    if (!action.params || action.params.length === 0) {
      await executeAction(action.id, {})
      return
    }

    // Params-defaults are best-effort: a failure to pre-fill still opens the dialog, just empty —
    // it never blocks the action itself.
    let defaults: Record<string, unknown> = {}
    try {
      defaults = await resolveDefaults.mutateAsync({
        typeId: descriptor.id,
        actionId: action.id,
        documentId: currentDocumentId,
        data: form.getValues(),
      })
    } catch {
      defaults = {}
    }
    setPendingDefaults(defaults)
    setPendingAction(action)
  }

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

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {availableActions.map((action) => (
            <div key={action.id} className="flex max-w-full flex-col gap-1">
              <Button
                type="button"
                variant={action.id === firstRunnableAction?.id ? "default" : "outline"}
                loading={runAction.isPending && pendingAction === undefined}
                disabled={!!action.policyBlockedReason}
                tooltip={action.policyBlockedReason}
                onClick={() => handleAction(action)}
                dataCy={`document-action-${action.id}`}
              >
                {action.label}
              </Button>
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
          ))}
        </div>
      </form>

      {pendingAction && (
        <ActionParamsDialog
          action={pendingAction}
          defaultValues={pendingDefaults}
          submitting={runAction.isPending}
          onCancel={() => setPendingAction(undefined)}
          onConfirm={(params) => executeAction(pendingAction.id, params)}
        />
      )}
    </Form>
  )
}
