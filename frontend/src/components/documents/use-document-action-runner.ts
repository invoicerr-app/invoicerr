import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { actionLocksDocument } from "@/components/documents/action-presentation"
import type { DocumentActionDescriptor, DocumentInstance } from "@/components/documents/types"
import { useResolveActionParamsDefaults, useRunDocumentAction } from "@/hooks/queries"
import { ApiError } from "@/hooks/use-api-query"

interface UseDocumentActionRunnerOptions {
  typeId: string
  documentId?: string
  /** Every action this record's type declares, in descriptor order — read ONLY to work out whether
   *  running one of them is about to LOCK the record (`actionLocksDocument`, see
   *  action-presentation.ts's own header) before it actually runs. Which actions are OFFERED at all
   *  stays entirely the caller's own concern (its own filtering upstream); omitted entirely, the lock
   *  check is skipped — a caller with nothing meaningful to say about "the rest of this type's
   *  actions" (there is none today) simply never sees the confirmation. */
  actions?: DocumentActionDescriptor[]
  /** The record's own CURRENT status, paired with `actions` above for the lock check — the same
   *  'undefined means brand-new, never saved' convention `isActionAvailable`/`findSaveAction` already
   *  use. Irrelevant when `actions` is omitted. */
  status?: string
  /** Read lazily, at the moment an action actually runs — a live react-hook-form's current values
   *  for a mounted form (use-document-form.ts), or simply an already-saved instance's own
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
   *  that has its own idea of "which id/status/number is this document" (document-form.tsx, for a
   *  brand new draft that had no id — or number — at all) keep it in sync. A row acting on an
   *  already-known instance has no such state to update; it relies on the list's own query being
   *  invalidated instead (see useRunDocumentAction's `invalidateKeys`). `number`/`displayNumber`
   *  mirror the backend's own ActionResult.document fields — null/undefined before the record is
   *  numbered, or for a type that never declares `numbering` at all. */
  onDocumentUpdate?: (
    documentId: string,
    status: string,
    number: number | null | undefined,
    displayNumber: string | null | undefined,
  ) => void
}

/**
 * The one place a declared action actually RUNS: opens the params dialog when the action declares
 * `params`, resolves best-effort defaults for it first, executes, and reports the result — exactly
 * what document-form.tsx used to do entirely inline. Extracted so a document's action buttons are
 * not one screen's private logic: use-document-form.ts (the create dialog and the detail page,
 * acting on a live, possibly-unsaved form) and document-list.tsx (a row acting directly on an
 * already-saved instance, no form involved at all) share this instead of keeping two copies of the
 * same state machine.
 */
export function useDocumentActionRunner({
  typeId,
  documentId,
  actions,
  status,
  getData,
  validate,
  onActionSuccess,
  onDocumentUpdate,
}: UseDocumentActionRunnerOptions) {
  const { t } = useTranslation()
  const [pendingAction, setPendingAction] = useState<DocumentActionDescriptor | undefined>()
  const [pendingDefaults, setPendingDefaults] = useState<Record<string, unknown>>({})
  // Set only for an action `actionLocksDocument` says is about to lock the record — one MORE gate
  // than `pendingAction` above, checked FIRST (see `handleAction`): a locking action that also
  // declares `params` still gets both, in order (lock confirmation, then the params dialog), never
  // the two conflated into one step.
  const [pendingLockConfirm, setPendingLockConfirm] = useState<DocumentActionDescriptor | undefined>()

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
        onDocumentUpdate?.(
          result.document.id,
          result.document.status,
          result.document.number,
          result.document.displayNumber,
        )
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

  // Everything `handleAction` used to do once past the lock check (below) — split out so the lock
  // confirmation's own "Confirm" button can resume exactly here, without re-running `validate()` a
  // second time on a form that has not changed since the first check.
  const runOrCollectParams = async (action: DocumentActionDescriptor) => {
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

  const handleAction = async (action: DocumentActionDescriptor) => {
    const valid = validate ? await validate() : true
    if (!valid) {
      toast.error(t("documents.form.messages.invalid"))
      return
    }

    // Locking is checked BEFORE params, deliberately: what the record is about to lose (the ability
    // to edit it) is a fact about running the action at all, not about the particular inputs a
    // params dialog would go on to collect — see actionLocksDocument's own header for why this never
    // names "send" or "invoice" itself.
    if (actions && actionLocksDocument(actions, action, status)) {
      setPendingLockConfirm(action)
      return
    }

    await runOrCollectParams(action)
  }

  const confirmPendingLock = async () => {
    const action = pendingLockConfirm
    if (!action) return
    setPendingLockConfirm(undefined)
    await runOrCollectParams(action)
  }

  return {
    pendingAction,
    pendingDefaults,
    pendingLockConfirm,
    isRunning: runAction.isPending,
    handleAction,
    executeAction,
    confirmPendingLock,
    cancelPendingAction: () => setPendingAction(undefined),
    cancelPendingLockConfirm: () => setPendingLockConfirm(undefined),
  }
}
