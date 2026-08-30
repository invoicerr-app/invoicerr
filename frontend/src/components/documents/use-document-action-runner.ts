import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { DocumentActionDescriptor, DocumentInstance } from "@/components/documents/types"
import { useResolveActionParamsDefaults, useRunDocumentAction } from "@/hooks/queries"
import { ApiError } from "@/hooks/use-api-query"

interface UseDocumentActionRunnerOptions {
  typeId: string
  documentId?: string
  /** Read lazily, at the moment an action actually runs — a live react-hook-form's current values
   *  for the create/edit modal (document-form.tsx), or simply an already-saved instance's own
   *  `data` for a list row acting directly on it (document-list.tsx). Neither caller owns the
   *  other's idea of "where does the current data come from". */
  getData: () => Record<string, unknown>
  /** Best-effort client-side check run before ANY action — e.g. react-hook-form's own `trigger()`
   *  in the modal. Omitted entirely for a row acting on an already-persisted instance: there is no
   *  live form to validate, and the data was already accepted once when it was saved. */
  validate?: () => Promise<boolean> | boolean
  /** Fired only for a result that both changed something AND carries a document — same contract as
   *  the backend's ActionResult. */
  onActionSuccess?: (result: DocumentInstance, actionId: string) => void
  /** Fired whenever the run produced/updated THIS SAME document type's own record — lets a caller
   *  that has its own idea of "which id/status is this document" (document-form.tsx, for a brand
   *  new draft that had no id at all) keep it in sync. A row acting on an already-known instance has
   *  no such state to update; it relies on the list's own query being invalidated instead (see
   *  useRunDocumentAction's `invalidateKeys`). */
  onDocumentUpdate?: (documentId: string, status: string) => void
}

/**
 * The one place a declared action actually RUNS: opens the params dialog when the action declares
 * `params`, resolves best-effort defaults for it first, executes, and reports the result — exactly
 * what document-form.tsx used to do entirely inline. Extracted so a document's action buttons are
 * not one screen's private logic: document-form.tsx (the create/edit modal, acting on a live,
 * possibly-unsaved form) and document-list.tsx (a row acting directly on an already-saved instance,
 * no form involved at all) now share this instead of keeping two copies of the same state machine.
 */
export function useDocumentActionRunner({
  typeId,
  documentId,
  getData,
  validate,
  onActionSuccess,
  onDocumentUpdate,
}: UseDocumentActionRunnerOptions) {
  const { t } = useTranslation()
  const [pendingAction, setPendingAction] = useState<DocumentActionDescriptor | undefined>()
  const [pendingDefaults, setPendingDefaults] = useState<Record<string, unknown>>({})

  const runAction = useRunDocumentAction()
  const resolveDefaults = useResolveActionParamsDefaults()

  const executeAction = async (actionId: string, params: Record<string, unknown>) => {
    try {
      const result = await runAction.mutateAsync({
        typeId,
        actionId,
        documentId,
        data: getData(),
        params,
      })
      // Only adopt the result as "this same record" when it is actually the same document TYPE —
      // an action can create an instance of a DIFFERENT type instead (e.g. the quote's
      // "convert-to-invoice" hands back a brand-new invoice). See onActionSuccess below, which the
      // caller uses to decide what to do with a foreign record.
      if (result.document && result.document.typeId === typeId) {
        onDocumentUpdate?.(result.document.id, result.document.status)
      }
      toast.success(result.message ?? t("documents.form.messages.actionSuccess"))
      setPendingAction(undefined)
      if (result.changed && result.document) {
        onActionSuccess?.(result.document, actionId)
      }
    } catch (error) {
      // The message IS the point here: a 501 means the action is declared on this document type but
      // nobody registered an implementation for it yet — say exactly that, never fail silently.
      const message = error instanceof ApiError ? error.message : t("documents.form.messages.actionError")
      toast.error(message)
    }
  }

  const handleAction = async (action: DocumentActionDescriptor) => {
    const valid = validate ? await validate() : true
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
        typeId,
        actionId: action.id,
        documentId,
        data: getData(),
      })
    } catch {
      defaults = {}
    }
    setPendingDefaults(defaults)
    setPendingAction(action)
  }

  return {
    pendingAction,
    pendingDefaults,
    isRunning: runAction.isPending,
    handleAction,
    executeAction,
    cancelPendingAction: () => setPendingAction(undefined),
  }
}
