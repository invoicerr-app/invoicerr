import type { TFunction } from "i18next"

import type { DocumentActionDescriptor, DocumentTypeDescriptor } from "@/components/documents/types"
import { isActionAvailable, resolveTransitionTarget, statusLabel } from "@/components/documents/types"

/** The possible resulting status(es) of `action` from `fromStatus`, always as an array — the single-
 *  status and multi-status shapes of `resolveTransitionTarget`'s own return value collapsed into one
 *  form for the two predicates below, which only ever need to check membership. */
function transitionTargets(action: DocumentActionDescriptor, fromStatus: string | undefined): string[] {
  const target = resolveTransitionTarget(action, fromStatus)
  if (!target) return []
  return Array.isArray(target) ? target : [target]
}

/**
 * Pure, render-free rules for HOW a document's declared actions are presented — which one is the
 * single primary button, which one is "the save", what the transition caption under a button says.
 * Shared by the create dialog (document-create-dialog.tsx) and the detail page (document-detail.tsx)
 * so the two surfaces never disagree on what "the main thing to do next" is for the same record.
 *
 * Nothing here names a document TYPE. Two action IDS are named, deliberately, in `NEVER_PRIMARY`:
 * the same convention document-list.tsx / document-form.tsx already hold for "cancel",
 * "download-xml" and "share-link" (an action id is a cross-type vocabulary the descriptors share;
 * a type id is not). A plugin's own action never hits that set and is presented like any other.
 */

/** Actions that must never become the one highlighted button, whatever their position in the
 *  descriptor: an irreversible removal ("delete") or voiding ("cancel") is offered, but as a
 *  deliberate choice inside the menu, never as the thing a stray Enter or a fast click lands on. */
const NEVER_PRIMARY = new Set(["delete", "cancel"])

/**
 * "The save" for a record at `currentStatus`: the action whose declared transition lands the record
 * on the very status it is already in (draft → draft, received → received). Deduced from the
 * descriptor's own `transitions`, never from an id — a type whose "save" is called "receive" (the
 * received invoice) qualifies exactly like one whose save is called "save-draft".
 * Undefined for a record that has no status yet (nothing can "keep" a status that doesn't exist)
 * and for a status no available action re-targets.
 */
export function findSaveAction(
  actions: DocumentActionDescriptor[],
  currentStatus: string | undefined,
): DocumentActionDescriptor | undefined {
  if (currentStatus === undefined) return undefined
  return actions.find((action) => {
    const target = resolveTransitionTarget(action, currentStatus)
    if (target === undefined) return false
    return Array.isArray(target)
      ? target.length === 1 && target[0] === currentStatus
      : target === currentStatus
  })
}

/**
 * Whether running `action` from `currentStatus` is about to LOCK the record — turn its own "save"
 * (`findSaveAction` above, whatever it is called for this type) from available to unavailable. This
 * reads ONLY the country policy's already-composed facts (`policyRestrictedToStatuses`, via
 * `isActionAvailable` — see that function's own header): no action id, type id or country is ever
 * named here, so a country whose policy does NOT narrow re-editing never shows a warning (nothing is
 * about to lock), and a type whose "save" is restricted by a FUTURE country file gets the warning for
 * free, with no change needed on this side. The backend's policy data stays the one source of truth
 * for WHETHER a record locks; this only asks it.
 *
 * `false` when the record is ALREADY locked in `currentStatus` (a retry from a failed send, say) —
 * nothing NEW is being locked by this particular click, so warning again would only be noise, not a
 * fact. `false` too, obviously, for an action with no transition at all (its effect lands on a
 * different record, or nowhere) or one that keeps the save action available in every status it can
 * lead to.
 */
export function actionLocksDocument(
  actions: DocumentActionDescriptor[],
  action: DocumentActionDescriptor,
  currentStatus: string | undefined,
): boolean {
  const saveAction = findSaveAction(actions, currentStatus)
  if (!saveAction || !isActionAvailable(saveAction, currentStatus)) return false
  const targets = transitionTargets(action, currentStatus)
  return targets.length > 0 && targets.every((status) => !isActionAvailable(saveAction, status))
}

/** Whether running `action` from `currentStatus` will assign this record its type's own number —
 *  reads the descriptor's own `numbering.onEnterStatus` (see `DocumentTypeDescriptor.numbering`'s own
 *  header) rather than naming a type or an action: a type with no `numbering` at all is never
 *  numbered, whatever action runs. Used only to word the lock-confirmation dialog accurately — never
 *  to decide whether the record actually gets numbered, which stays entirely the backend's job. */
export function actionAssignsNumber(
  descriptor: DocumentTypeDescriptor,
  action: DocumentActionDescriptor,
  currentStatus: string | undefined,
): boolean {
  if (!descriptor.numbering) return false
  return transitionTargets(action, currentStatus).includes(descriptor.numbering.onEnterStatus)
}

/**
 * The ONE primary action for a screen — the rule the detail page's header applies:
 *  - a form with unsaved edits wants to be saved before anything else, so the save action (above)
 *    wins whenever there is one;
 *  - otherwise the first action the descriptor lists that is runnable right now (not blocked by
 *    the country policy), is not the save itself, and is not in `NEVER_PRIMARY` — descriptor order
 *    is the type's own statement of what matters most ("send" before "record-payment"…);
 *  - failing that, the save action again, even when the policy blocks it: a visibly disabled
 *    primary carrying its reason reads as a rule, an empty header slot reads as a bug.
 * Everything else goes to the secondary menu — `secondaryActions` below.
 */
export function pickPrimaryAction(
  actions: DocumentActionDescriptor[],
  currentStatus: string | undefined,
  isDirty: boolean,
): DocumentActionDescriptor | undefined {
  const save = findSaveAction(actions, currentStatus)
  if (isDirty && save) return save
  const nextStep = actions.find(
    (action) => action !== save && !action.policyBlockedReason && !NEVER_PRIMARY.has(action.id),
  )
  return nextStep ?? save ?? actions.find((action) => !NEVER_PRIMARY.has(action.id))
}

export function secondaryActions(
  actions: DocumentActionDescriptor[],
  primary: DocumentActionDescriptor | undefined,
): DocumentActionDescriptor[] {
  return actions.filter((action) => action !== primary)
}

/**
 * The entries a saved record offers BESIDES its `runAction` POSTs — each declared on the descriptor
 * for the status/country-policy gates only, and each reached through its own mechanism rather than
 * the generic action runner (document-list.tsx's row cluster spells out why for each):
 *  - "download-xml": a plain GET per syntax (`documents.service.ts#downloadDocumentFormat`);
 *  - "share-link": REST resources of their own (share-links/), behind share-link-dialog.tsx;
 *  - "duplicate": ALSO the gate for offering a RECURRENCE (create-recurrence-dialog.tsx) — a
 *    plugin's own type gets it for free the moment it registers "duplicate" too; "then send" inside
 *    that dialog is offered only to a type that ALSO declares "send", never assumed.
 * Read in one place so the list row and the detail page's menu can never disagree.
 */
export function extraActionGates(descriptor: DocumentTypeDescriptor, status: string) {
  const downloadXml = descriptor.actions.find((action) => action.id === "download-xml")
  const shareLink = descriptor.actions.find((action) => action.id === "share-link")
  const duplicate = descriptor.actions.find((action) => action.id === "duplicate")
  return {
    downloadXml: downloadXml && isActionAvailable(downloadXml, status) ? downloadXml : undefined,
    shareLink: shareLink && isActionAvailable(shareLink, status) ? shareLink : undefined,
    recurrence: !!duplicate && isActionAvailable(duplicate, status),
    offerThenSend: descriptor.actions.some((action) => action.id === "send"),
  }
}

/**
 * The human-facing "this will move it from X to Y" caption for one action — or undefined when the
 * action declares no transition for the current status (its effect lands on a different record, or
 * nowhere). Mirrors what document-form.tsx's action row used to compute inline; extracted so the
 * detail page's menu items and the create dialog's footer buttons say the same thing.
 */
export function transitionHint(
  t: TFunction,
  descriptor: DocumentTypeDescriptor,
  action: DocumentActionDescriptor,
  currentStatus: string | undefined,
): string | undefined {
  const target = resolveTransitionTarget(action, currentStatus)
  if (!target) return undefined
  return t("documents.form.transitionHint", {
    from:
      currentStatus !== undefined
        ? statusLabel(descriptor, currentStatus)
        : t("documents.form.transitionFromNew"),
    // `target` is an ARRAY for a transition with more than one honest outcome (the async "send"
    // shape: the worker's replay either succeeds or, after every retry, fails) — joined with a
    // translated "or" rather than picking one arbitrarily, so the hint stays truthful about both.
    to: (Array.isArray(target) ? target : [target])
      .map((status) => statusLabel(descriptor, status))
      .join(` ${t("documents.form.transitionOr")} `),
  })
}
