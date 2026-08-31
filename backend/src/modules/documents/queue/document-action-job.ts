/**
 * Pure functions building a document-action job's identity and data — no BullMQ, no Nest, no I/O, so
 * this is testable (document-action-job.spec.ts) without a broker, exactly what TODO.md item 22 asks
 * for. `document-queue.dispatcher.ts` is the only caller in production; a jest spec calls these
 * directly.
 */
import { DocumentActionJobData } from './queue.constants';

/**
 * The job's deterministic id: `<actionId>-<typeId>-<documentId>`. Deterministic so re-enqueueing the
 * SAME (type, document, action) is idempotent — see document-queue.dispatcher.ts's own header for how
 * a stale (completed/failed) job under this same id is cleared before a fresh one is added, and why a
 * still in-flight one is left alone rather than duplicated.
 *
 * `-`, never `:`, as the separator — carried over from the pre-refonte compliance queue dispatcher
 * (`avant-refonte-documents`, compliance-queue.dispatcher.ts): BullMQ's `Job.validateOptions` rejects
 * any custom jobId containing a SINGLE `:` (reserved for its own internal repeatable-job id format,
 * which requires exactly two). That bug was latent in the old code until its dispatcher was actually
 * exercised end-to-end — never re-introduced here.
 */
export function buildDocumentActionJobId(typeId: string, documentId: string, actionId: string): string {
  return `${actionId}-${typeId}-${documentId}`;
}

/** The action's OWN inputs a job carries — see `DocumentActionJobData.payload`'s own comment for why
 *  this stays a nested object rather than flattened fields. */
export interface DocumentActionJobPayload {
  data: Record<string, unknown>;
  params: Record<string, unknown>;
}

export function buildDocumentActionJobData(input: {
  companyId: string;
  typeId: string;
  documentId: string;
  actionId: string;
  payload: DocumentActionJobPayload;
}): DocumentActionJobData {
  return {
    companyId: input.companyId,
    typeId: input.typeId,
    documentId: input.documentId,
    actionId: input.actionId,
    payload: input.payload,
  };
}
