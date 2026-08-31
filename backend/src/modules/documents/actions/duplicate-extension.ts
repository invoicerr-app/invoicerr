import { ActionExtensionRegistry } from './action-extensions';
import { ActionRegistry } from './action-registry';
import { findOwnedDocument, upsertDocument } from '../persistence';

/**
 * A THIRD-PARTY extension, deliberately kept in its own file: it never imports, and is never
 * imported by, quote.descriptor.ts or quote-actions.ts. It attaches a generic "duplicate" action —
 * copy this record's current data into a brand-new draft — to any document type it is wired for
 * (see documents-core.module.ts). This is the proof of the extensibility mechanism the task asks for:
 * adding "duplicate" to the quote touches THIS file and its one line of wiring, nothing that belongs
 * to the quote type itself.
 *
 * Declaration (ActionExtensionRegistry) and implementation (ActionRegistry) are registered together
 * here for convenience, but they are still two independent steps — a plugin could just as well
 * declare this action and never register a handler, and it would 501 exactly like any other
 * unimplemented action. Nothing about the mechanism special-cases "duplicate".
 *
 * ## Root TODO item 5 (recurring documents) reuses this SAME handler — no second implementation
 *
 * A scheduled occurrence (documents/schedules/) is, at its core, still just "duplicate this
 * document" — the task's own instruction is explicit that it must "adapt WITHOUT a second
 * implementation of duplicate". ONE optional param, a no-op for the plain manual "Duplicate" button
 * (which never sends it), makes that possible: `occurrenceDate` — when present, OVERRIDES
 * `dateRecalc.anchorField` on the clone (e.g. an invoice's own `issueDate`) with this exact value,
 * and shifts every field named in `dateRecalc.dependentFields` (e.g. `dueDate`) by the SAME offset
 * the source document itself had between that field and the anchor — never a fixed number of days
 * invented here, whatever payment-terms delta the template document actually encodes. Absent
 * `dateRecalc` (the quote's own registration, today) or absent `occurrenceDate` altogether: no date
 * field is touched, the clone is byte-for-byte the source's own data, exactly the pre-existing
 * behavior.
 *
 * `dateRecalc` is supplied at REGISTRATION time (documents-core.module.ts), per type, the same way
 * every other per-type wiring in this codebase is injected rather than hard-coded — this handler
 * never becomes aware of "invoice" or "schedules" by name.
 *
 * ## Why "then send" does NOT live here, even though `DocumentSchedule.params.thenSend` does
 *
 * An earlier version of this file enqueued a "send" job directly from inside this handler when a
 * `thenSend` param was set, reusing `DocumentActionQueueDispatcher.enqueueAction` the same way
 * async-send.ts's own re-send does. That is subtly wrong specifically when THIS handler is itself
 * already running INSIDE a queue job (schedules/schedule-sweep-runner.ts's `runOccurrence`, which
 * IS a job): `runAsyncSendAction`'s own phase-1 (draft -> "sending") re-enqueues under "send"'s
 * ordinary, deterministic jobId (`send-<typeId>-<newDocId>`) — but that phase-1 re-enqueue itself
 * only ever runs from INSIDE the newly-enqueued "send" job's own `process()` call once the WORKER
 * picks it up, and at that exact moment a job under that very id is STILL ACTIVE (itself!), so
 * `DocumentQueueDispatcher.enqueueAction`'s own "already active — skip" dedup silently swallows the
 * phase-2 (actual delivery) job that was supposed to follow. The document is left stuck at
 * "sending" forever — a real bug this file's own live end-to-end test against Mailpit caught (see
 * schedule-sweep-runner.ts's own header for the fix: chaining "send" from OUTSIDE any queue job,
 * synchronously, through `DocumentsService.runAction`, exactly the way an HTTP-triggered click
 * already does). This handler stays entirely ignorant of "send" as a result — it only ever produces
 * a fresh draft.
 */
export interface DuplicateDateRecalc {
  /** The field `occurrenceDate` itself overrides — e.g. "issueDate". */
  anchorField: string;
  /** Every OTHER date field shifted by the same offset it already had from `anchorField` on the
   *  SOURCE document — e.g. ["dueDate"]. Absent/empty: only `anchorField` itself is overridden. */
  dependentFields?: string[];
}

export interface RegisterDuplicateExtensionOptions {
  dateRecalc?: DuplicateDateRecalc;
}

/** Applies `dateRecalc` to a clone of `sourceData`, given the occurrence's own anchor value — pure,
 *  and exported for direct unit testing without going through the whole action machinery. No-op
 *  (returns `sourceData` verbatim) when `dateRecalc` is absent, or when the source itself doesn't
 *  carry a parseable value for `anchorField`. */
export function applyDateRecalc(
  sourceData: Record<string, unknown>,
  occurrenceDate: string,
  dateRecalc: DuplicateDateRecalc,
): Record<string, unknown> {
  const anchorRaw = sourceData[dateRecalc.anchorField];
  const anchorMs = typeof anchorRaw === 'string' ? Date.parse(anchorRaw) : NaN;
  const occurrenceMs = Date.parse(occurrenceDate);
  if (Number.isNaN(anchorMs) || Number.isNaN(occurrenceMs)) {
    // The source has no usable anchor date to compute an offset FROM — leave every date field as
    // the source's own, rather than guessing. This should not happen for a real invoice (issueDate
    // is required), but a handler never trusts that alone (the same defensive posture
    // duplicate-extension.ts's own documentId check already holds).
    return sourceData;
  }

  const result: Record<string, unknown> = { ...sourceData, [dateRecalc.anchorField]: occurrenceDate };
  for (const field of dateRecalc.dependentFields ?? []) {
    const dependentRaw = sourceData[field];
    const dependentMs = typeof dependentRaw === 'string' ? Date.parse(dependentRaw) : NaN;
    if (Number.isNaN(dependentMs)) continue; // e.g. the quote's optional dueDate, unset
    const offsetMs = dependentMs - anchorMs;
    result[field] = new Date(occurrenceMs + offsetMs).toISOString();
  }
  return result;
}

export function registerDuplicateExtension(
  typeId: string,
  extensions: ActionExtensionRegistry,
  actions: ActionRegistry,
  options: RegisterDuplicateExtensionOptions = {},
): void {
  const { dateRecalc } = options;

  extensions.register(typeId, {
    id: 'duplicate',
    label: 'Duplicate',
    // A record has to exist and be persisted before there is anything to copy.
    availableWhen: ['draft', 'sent'],
    params: [
      {
        key: 'occurrenceDate',
        kind: 'date',
        label: 'Occurrence date',
        required: false,
        helpText:
          "Internal — set by a scheduled recurrence (root TODO item 5) to recompute this type's " +
          'own date fields on the duplicate. Left empty for an ordinary, manual duplicate.',
      },
    ],
  });

  actions.register(typeId, 'duplicate', async ({ companyId, documentId, params }) => {
    if (!documentId) {
      // Unreachable in practice — `availableWhen` above already refuses this before the handler
      // runs — but a handler never trusts that alone; see documents.service.ts's own comment on why
      // the 409 check exists server-side regardless of what the UI offers.
      throw new Error('Cannot duplicate a document that has not been saved yet.');
    }

    const source = await findOwnedDocument(companyId, typeId, documentId);
    const sourceData = source.data as Record<string, unknown>;
    const occurrenceDate = typeof params.occurrenceDate === 'string' ? params.occurrenceDate : undefined;
    const clonedData =
      occurrenceDate && dateRecalc ? applyDateRecalc(sourceData, occurrenceDate, dateRecalc) : sourceData;

    const document = await upsertDocument(companyId, typeId, undefined, 'draft', clonedData);

    return { document, changed: true, message: 'Duplicated as a new draft.' };
  });
}
