/**
 * The document LIFECYCLE: which STATUSES a type's instances may be in, and which ACTIONS move a
 * record from one to another. `types.ts` declares the SHAPE
 * (`DocumentTypeDescriptor.statuses`/`initialStatus`, `DocumentActionDescriptor.transitions`); this
 * file is the behavior built on it:
 *  - `transitionsAvailableWhen` / `validateLifecycle` — boot-time: `DocumentTypeRegistry.register()`
 *    (type-registry.ts) calls `validateLifecycle` for every descriptor, so a broken lifecycle
 *    declaration fails the moment a type is registered — in production that means the app never
 *    finishes booting; in a jest spec, `registry.register(...)` itself throws. `documents.service.ts`
 *    ALSO re-runs it once more, at `onModuleInit`, against every type's MERGED descriptor (native +
 *    third-party extensions) — the same two-independent-gates discipline `country-policy/schema.ts`'s
 *    `assertValidProvenance` already documents for its own concern.
 *  - `resolveTransitionTarget` / `checkTransitionResult` — request-time: `documents.service.ts`'s
 *    `runAction` calls `checkTransitionResult` right after a handler returns, so a handler that
 *    persisted a status outside its own declared transition is caught the moment it happens, never
 *    silently accepted as a "phantom" status nothing declared.
 *
 * ## Why `availableWhen` is DERIVED from `transitions`, not the reverse
 *
 * Before this file existed, `availableWhen` was the ONLY declared fact about when an action could
 * run — a handler was then free to persist whatever status string it liked (e.g.
 * generic-actions.ts's registerSaveDraftAction always wrote "draft", by convention, never by
 * anything the descriptor enforced). That left two ways for a descriptor and its own handler to
 * drift silently apart: `availableWhen` could stop matching what a transition-bearing action's `from`
 * list actually said, and a handler could persist a status the descriptor never declared at all.
 *
 * For an action that DOES change the acted-upon record's own status, `transitions` is strictly MORE
 * informative than `availableWhen` ever was (it says the RESULT too, not just the precondition), so
 * it becomes the single source of truth and `availableWhen` is RECOMPUTED from it
 * (`transitionsAvailableWhen`): a descriptor sets both by calling that helper for the second one
 * (see quote.descriptor.ts), and `validateLifecycle` independently re-derives it at registration to
 * catch a hand-typed value that drifted from its own `transitions` — two different pieces of code
 * agreeing is what makes either one trustworthy alone, the same argument `checkTransitionResult`'s own
 * comment makes for keeping IT independent of `validateLifecycle` too.
 *
 * Some real actions are gated by status yet never change ANY record's status themselves — their
 * effect, if any, lands on a DIFFERENT record entirely ("convert-to-invoice" writes a fresh invoice;
 * "duplicate", attached generically by a third-party extension, writes a fresh copy of whatever it
 * read) or they have no implementation yet to observe ("export-accounting"). For these, there is nothing
 * to derive `availableWhen` FROM — `transitions` stays absent and `availableWhen` remains the sole,
 * explicit, hand-declared fact, exactly as it was before this file existed.
 */
import { ActionResult, DocumentInstanceResult } from '../actions/action-registry';
import { DocumentActionDescriptor, DocumentActionTransition, DocumentTypeDescriptor } from './types';

/** What `DocumentActionDescriptor.availableWhen` MUST equal for an action declaring `transitions` —
 *  see this file's header. 'always' wins over everything else (an action available from a brand-new
 *  record can never be narrowed to a finite status list by also being available from some others). */
export function transitionsAvailableWhen(transitions: DocumentActionTransition[]): 'always' | string[] {
  if (transitions.some((t) => t.from === 'always')) return 'always';
  const froms = new Set<string>();
  for (const t of transitions) {
    if (t.from !== 'always') {
      for (const status of t.from) froms.add(status);
    }
  }
  return [...froms];
}

function availableWhenEquals(a: 'always' | string[], b: 'always' | string[]): boolean {
  if (a === 'always' || b === 'always') return a === b;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

/**
 * Boot-time coherence check for ONE descriptor — see this file's header for who calls it and when.
 * A NO-OP for a descriptor that never declares `statuses` at all (see `DocumentTypeDescriptor`'s own
 * comment on why that stays optional): such a descriptor opts entirely out of the lifecycle model,
 * the same way one with no `contributions` opts out of the widget model.
 */
export function validateLifecycle(descriptor: DocumentTypeDescriptor): void {
  if (!descriptor.statuses) {
    // `numbering` needs a lifecycle to hook a status onto — a descriptor declaring one with no
    // `statuses` at all has nothing for `onEnterStatus` to name, the same "opts out of everything
    // else this file checks" gap `initialStatus`/`transitions` would otherwise silently have too.
    if (descriptor.numbering) {
      throw new Error(
        `Document type "${descriptor.id}" declares "numbering" but no "statuses" at all — numbering ` +
          'needs a lifecycle status to hook into.',
      );
    }
    return;
  }

  const statusIds = descriptor.statuses.map((s) => s.id);
  const statusSet = new Set(statusIds);
  if (statusSet.size !== statusIds.length) {
    throw new Error(
      `Document type "${descriptor.id}" declares a duplicate status id in "statuses" (${statusIds.join(', ')}).`,
    );
  }
  if (descriptor.initialStatus === undefined || !statusSet.has(descriptor.initialStatus)) {
    throw new Error(
      `Document type "${descriptor.id}" declares "initialStatus": ${JSON.stringify(descriptor.initialStatus)}, ` +
        `which is not one of its own declared statuses (${statusIds.join(', ')}).`,
    );
  }

  if (descriptor.numbering && !statusSet.has(descriptor.numbering.onEnterStatus)) {
    throw new Error(
      `Document type "${descriptor.id}" declares "numbering.onEnterStatus": ` +
        `${JSON.stringify(descriptor.numbering.onEnterStatus)}, which is not one of its own declared ` +
        `statuses (${statusIds.join(', ')}).`,
    );
  }

  for (const action of descriptor.actions) {
    if (action.transitions) {
      for (const transition of action.transitions) {
        if (!statusSet.has(transition.to)) {
          throw new Error(
            `Document type "${descriptor.id}", action "${action.id}": a transition targets status ` +
              `"${transition.to}", which is not declared in "statuses" (${statusIds.join(', ')}).`,
          );
        }
        if (transition.from !== 'always') {
          for (const from of transition.from) {
            if (!statusSet.has(from)) {
              throw new Error(
                `Document type "${descriptor.id}", action "${action.id}": a transition starts from status ` +
                  `"${from}", which is not declared in "statuses" (${statusIds.join(', ')}).`,
              );
            }
          }
        }
      }

      const derived = transitionsAvailableWhen(action.transitions);
      if (!availableWhenEquals(derived, action.availableWhen)) {
        throw new Error(
          `Document type "${descriptor.id}", action "${action.id}": its declared "availableWhen" ` +
            `(${JSON.stringify(action.availableWhen)}) does not match what its own "transitions" imply ` +
            `(${JSON.stringify(derived)}) — availableWhen must be DERIVED from transitions (see ` +
            "lifecycle.ts's header on transitionsAvailableWhen), never hand-typed independently of them.",
        );
      }
    } else if (action.availableWhen !== 'always') {
      for (const status of action.availableWhen) {
        if (!statusSet.has(status)) {
          throw new Error(
            `Document type "${descriptor.id}", action "${action.id}": "availableWhen" names status ` +
              `"${status}", which is not declared in "statuses" (${statusIds.join(', ')}).`,
          );
        }
      }
    }
  }
}

/**
 * The status a transition-bearing action's own declared effect says a record starting at
 * `fromStatus` (undefined = brand new, never saved) must end up at. Undefined when `action` declares
 * no `transitions` at all, or when none of them matches `fromStatus` — the latter should never
 * actually happen for any status `availableWhen` allows (that's exactly what `validateLifecycle`
 * checks at boot), but this function stays a plain, independent lookup rather than trusting that
 * check ran: the same "a handler never trusts the 409 guard alone" discipline this module's own
 * action handlers already hold (see e.g. duplicate-extension.ts).
 */
export function resolveTransitionTarget(
  action: DocumentActionDescriptor,
  fromStatus: string | undefined,
): string | undefined {
  if (!action.transitions) return undefined;
  for (const transition of action.transitions) {
    if (transition.from === 'always') return transition.to;
    if (fromStatus !== undefined && transition.from.includes(fromStatus)) return transition.to;
  }
  return undefined;
}

/** What `checkTransitionResult` reports when a handler's write does not match the lifecycle. */
export interface LifecycleViolation {
  expectedStatus: string;
  actualStatus: string;
}

/**
 * Checked by documents.service.ts's runAction right after a handler returns — the ENFORCEMENT half
 * of this whole module: a handler no longer gets to persist whatever status string it likes.
 *
 *  - No document in the result, or a document of a DIFFERENT type: out of scope for THIS type's
 *    lifecycle — mirrors how field validation already never inspects a foreign write (see
 *    convert-to-invoice.ts's own comment on why the invoice it creates is never validated against
 *    the quote descriptor that triggered it).
 *  - The result's document IS `documentIdBefore` (the SAME record this action acted on): its status
 *    must equal whatever `resolveTransitionTarget` says for `statusBefore` — or, if the action
 *    declares no transition at all, whatever it already was (an action with no declared status
 *    effect may not silently give itself one).
 *  - Otherwise, a BRAND-NEW record of this SAME type was created (a first "save", or a third-party
 *    extension like "duplicate" that reads one record and writes another): it must start at the
 *    type's own `initialStatus`, by definition of what "initial" means.
 *
 * A NO-OP (never a violation) when `descriptor.initialStatus` is undefined — the same opt-out
 * `validateLifecycle` grants a descriptor that never declares a lifecycle at all.
 */
export function checkTransitionResult(
  descriptor: DocumentTypeDescriptor,
  typeId: string,
  action: DocumentActionDescriptor,
  documentIdBefore: string | undefined,
  statusBefore: string | undefined,
  result: ActionResult,
): LifecycleViolation | undefined {
  if (descriptor.initialStatus === undefined) return undefined;

  const doc = result.document as DocumentInstanceResult | undefined;
  if (!doc || doc.typeId !== typeId) return undefined;

  const isSameRecord = documentIdBefore !== undefined && doc.id === documentIdBefore;
  const expected = isSameRecord
    ? (resolveTransitionTarget(action, statusBefore) ?? statusBefore)
    : descriptor.initialStatus;

  if (expected === undefined || expected === doc.status) return undefined;
  return { expectedStatus: expected, actualStatus: doc.status };
}

/**
 * A note on what deliberately does NOT live in this file: an earlier version of this module folded
 * the country policy's per-status restriction (country-policy/schema.ts's
 * `DocumentActionRuleFact.statuses`) straight into a narrowed `availableWhen` for
 * `describeTypeForCompany`'s view. That was wrong — `availableWhen: 'always'` means "every existing
 * status, AND a brand-new, never-saved record"; intersecting it with a restriction like `['draft']`
 * produced `['draft']`, which silently ALSO revoked the never-saved allowance (a plain array can
 * never match `status === undefined` — see `isActionAvailable`). The visible symptom was a document
 * type losing its ONLY action ("save-draft") on a brand-new record the moment its country restricted
 * that action to a non-'always' subset — caught by 17-document-descriptor.cy.ts's "at least one
 * action is offered" assertion the day this shipped a real example (fr.json's invoice.save-draft).
 *
 * The fix: `documents.service.ts`'s `DocumentActionDescriptorView` carries the restriction as ITS OWN
 * field (`policyRestrictedToStatuses`), never merged into `availableWhen` — the frontend's own
 * `isActionAvailable` (types.ts, mirrored from this module) is what composes the two, the exact same
 * composition `documents.service.ts`'s `runAction` already performs server-side (its own per-status
 * 409 check, right next to the `availableWhen` one). Two facts, kept two facts, composed at the one
 * place that reads both — not flattened into one that can no longer tell them apart.
 */

/** One (typeId, status) pair actually found among persisted document instances that no declared
 *  lifecycle covers — see `findUndeclaredStatusInstances`. */
export interface UndeclaredStatusInstance {
  typeId: string;
  status: string;
}

/**
 * Checks DISTINCT (typeId, status) pairs actually found in the `DocumentInstance` table against
 * each type's own declared lifecycle, returning the ones no declaration covers — the "data
 * migration" question this whole mechanism raises: existing rows predate `statuses`/`initialStatus`
 * entirely, so booting must never silently assume they still match. Called by
 * documents.service.ts's `onModuleInit` (see its own comment on why this is fire-and-forget, not a
 * blocking part of boot) against the REAL table; a pure function here so it is testable without one
 * (lifecycle.spec.ts feeds it hand-built rows).
 *
 * `resolveType` is a plain callback (not a `DocumentTypeRegistry` import) deliberately: this module
 * must stay independent of type-registry.ts, which already imports THIS module's own
 * `validateLifecycle` — importing the registry's TYPE back here would be a circular dependency for
 * no real gain, since the caller already has a registry to close over.
 *
 * Skipped, not flagged, for:
 *  - a `typeId` the registry doesn't resolve at all (stray rows for a type this build no longer
 *    registers — a different problem than a status mismatch, and not this function's concern);
 *  - a type that never declared a lifecycle at all (`statuses` absent) — the same opt-out
 *    `validateLifecycle` and `checkTransitionResult` already grant such a descriptor.
 */
export function findUndeclaredStatusInstances(
  resolveType: (typeId: string) => DocumentTypeDescriptor | undefined,
  instances: { typeId: string; status: string }[],
): UndeclaredStatusInstance[] {
  const violations: UndeclaredStatusInstance[] = [];
  for (const { typeId, status } of instances) {
    const descriptor = resolveType(typeId);
    if (!descriptor?.statuses) continue;
    const isDeclared = descriptor.statuses.some((s) => s.id === status);
    if (!isDeclared) violations.push({ typeId, status });
  }
  return violations;
}
