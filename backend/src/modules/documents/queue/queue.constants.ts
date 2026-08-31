/**
 * The document-action queue's own constants and wire shapes — see this directory's header
 * (document-queue.module.ts) for the full split (Core providers / worker processors / WORKER_INLINE)
 * this module is part of, and TODO.md item 22 for the task this was built for.
 */

/** The ONE queue this whole mechanism needs — see document-action-job.ts's own header for why the
 *  job form is generic (companyId/typeId/documentId/actionId/payload) rather than one queue per
 *  business need: item 5 (recurring documents) is expected to reuse this exact same queue and job
 *  shape, only with its OWN scheduling deciding when to enqueue, never a second queue. */
export const Q_DOCUMENT_ACTION = 'document-action';

/**
 * One document-action job's data — see document-action-job.ts's `buildDocumentActionJobData` for how
 * this is built, and queue/processors/document-action.processor.ts for how it's consumed: the worker
 * replays `(companyId, typeId, documentId, actionId)` through `DocumentsService.runAction` — the
 * EXACT SAME execution path (and its four gates: country policy 403, status 409, implementation 501,
 * data validation 400) the API itself goes through for that same action. Nothing here is specific to
 * "send" — a future recurring-document job (item 5) enqueues the exact same shape for whichever
 * action it needs replayed later.
 */
export interface DocumentActionJobData {
  companyId: string;
  typeId: string;
  documentId: string;
  actionId: string;
  /** Mirrors `RunActionDto`'s own two fields (dto/documents.dto.ts) — kept as a nested object,
   *  rather than flattened alongside `companyId`/`typeId`/..., so the job's own "envelope" fields
   *  (who/what/which action) are visually distinct from the ACTION's own input, the same separation
   *  `ActionContext` already holds between `data` and `params`. */
  payload: {
    data: Record<string, unknown>;
    params: Record<string, unknown>;
  };
}

/**
 * The narrow shape an action handler needs to hand a job off to the queue — deliberately NOT the
 * concrete, BullMQ-backed `DocumentQueueDispatcher` (document-queue.dispatcher.ts): every action file
 * that enqueues a job (actions/async-send.ts) depends on THIS interface alone, so a jest spec can pass
 * a bare `{ enqueueAction: jest.fn() }` with no Nest module, no Redis, and no BullMQ involved at all —
 * the same "depend on the narrow shape, not the concrete class" discipline `TransportRegistry`'s own
 * `DocumentTransport` interface already holds for a transport's `send()`.
 */
export interface DocumentActionQueueDispatcher {
  enqueueAction(input: DocumentActionJobData): Promise<void>;
}
