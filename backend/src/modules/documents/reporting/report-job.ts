/**
 * The declarative-report job's own constants and wire shape — same "one more job NAME on the SAME
 * `Q_DOCUMENT_ACTION` queue" shape `conformity/conformity-sweep.ts` already holds for its own poll
 * job (see that file's own header): never a second queue, distinguished purely by
 * `queue/processors/document-action.processor.ts`'s own branch on `job.name`.
 *
 * Unlike the conformity poll job (dispatched repeatedly, by a SWEEP, at a wall-clock cadence), this
 * is a ONE-SHOT job: exactly one is ever meant to exist per (provider, document) pair, enqueued once,
 * at "sent" (`report-on-send.ts`). Its own jobId is therefore fully deterministic from
 * (`providerId`, `documentId`) alone — never a wall-clock window the way the poll job's is.
 */

export const DOCUMENT_REPORT_JOB_NAME = 'document-report';

/** `report-<providerId>-<documentId>` — the deterministic id this task's own brief names verbatim.
 *  Two enqueue calls for the SAME document/provider pair (a duplicate trigger, a replayed webhook,
 *  whatever) always resolve to the SAME BullMQ job — see `DocumentQueueDispatcher.enqueueReport`'s
 *  own header for what happens when one already exists. */
export function buildReportJobId(providerId: string, documentId: string): string {
  return `report-${providerId}-${documentId}`;
}

export interface ReportJobData {
  companyId: string;
  documentId: string;
  typeId: string;
  providerId: string;
}

/** Journaled when the runner cannot even ATTEMPT the declaration — credentials for `providerId` are
 *  missing/invalid for this company right now (`ChannelNotConnectedError`). NEVER retried (a missing
 *  credential does not fix itself between BullMQ backoff attempts) — the same "immediate, honest,
 *  non-terminal-but-not-retried" posture `conformity/conformity-sweep.ts`'s own `BLOCKED_STATUS_CODE`
 *  holds for a poll, deliberately given its OWN, differently-named code here (never
 *  `poll:blocked` — a declaration and a poll are different operations, and `DocumentAuthorityEvent`
 *  rows from both can coexist for the same document under different `providerId`s, so their status
 *  vocabularies staying visually distinct in the timeline matters). */
export const REPORT_BLOCKED_STATUS_CODE = 'report:blocked';

/**
 * Journaled ONCE every BullMQ retry is exhausted for a genuine declaration failure (network error, a
 * malformed response, the platform itself rejecting the submission) — see `mark-send-failed.ts`'s own
 * header for the identical "only the TERMINAL failure gets a durable record, not every attempt"
 * discipline, applied here to a NEW field this task adds rather than to `DocumentInstance.lastActionError`
 * itself (see `report-on-send.ts`'s own header for why: a reporting failure must NEVER look like the
 * "send" action itself failed — the invoice genuinely left, only its DECLARATION did not land).
 */
export const REPORT_FAILED_STATUS_CODE = 'report:failed';
