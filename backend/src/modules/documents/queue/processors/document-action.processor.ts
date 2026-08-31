/**
 * The document-action queue's ONLY processor — one generic worker for every declared action, not one
 * processor per business need (TODO.md item 22: "un mécanisme générique, pas un job ad hoc"). Lives in
 * its OWN module (document-queue-worker.module.ts), gated by WORKER_INLINE, so a scaled deployment can
 * run it in a dedicated process without the API also consuming (see that module's own header).
 *
 * `process()` replays the job through `DocumentsService.runAction` — the EXACT SAME entry point the
 * HTTP controller calls (documents.controller.ts) — never a shortcut straight to `ActionRegistry`.
 * THIS is what makes "an action forbidden by the country policy must be refused in the worker too"
 * true by construction: `runAction` is where all four gates live (country policy 403, status 409,
 * implementation 501, data validation 400), and this processor has no other way to run an action.
 * Mutating this call to bypass `runAction` (e.g. calling the registry directly) is exactly THE
 * MUTATION TARGET #1 this task's own instructions ask to prove against — see
 * document-action.processor.spec.ts.
 */
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { ActionResult } from '../../actions/action-registry';
import { DocumentsService } from '../../documents.service';
import { markSendFailed } from '../mark-send-failed';
import { DocumentActionJobData, Q_DOCUMENT_ACTION } from '../queue.constants';

@Processor(Q_DOCUMENT_ACTION)
export class DocumentActionProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentActionProcessor.name);

  constructor(private readonly documentsService: DocumentsService) {
    super();
  }

  async process(job: Job<DocumentActionJobData>): Promise<ActionResult> {
    const { companyId, typeId, documentId, actionId, payload } = job.data;
    this.logger.log(`Running "${actionId}" on ${typeId}/${documentId} (job ${job.id}, company ${companyId})`);

    // No try/catch here: a thrown error (a forbidden action, a transient delivery failure inside the
    // action's own handler, ...) must propagate so BullMQ records this ATTEMPT as failed and applies
    // its own retry/backoff — swallowing it here would silently turn every failure into a single,
    // un-retried attempt. THE MUTATION TARGET #2 ("l'échec du job persiste sent quand même") lives in
    // the action handler itself (actions/async-send.ts) and in `onFailed` below, not in this method.
    return this.documentsService.runAction(companyId, typeId, actionId, {
      documentId,
      data: payload.data,
      params: payload.params,
    });
  }

  /**
   * Fires after EVERY failed attempt, not only the last one — `job.attemptsMade` (already
   * incremented for this attempt by BullMQ before the event fires) compared against the job's own
   * configured `attempts` (document-queue.dispatcher.ts) is what tells "one more retry is coming"
   * apart from "this was the terminal failure". Only the terminal case calls `markSendFailed` — an
   * earlier attempt failing is exactly what BullMQ's backoff is FOR, not something this record's
   * status should reflect yet (it stays "sending" through every retry).
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<DocumentActionJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;

    const attempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      this.logger.warn(
        `Job ${job.id} failed (attempt ${job.attemptsMade}/${attempts}) — BullMQ will retry: ${error.message}`,
      );
      return;
    }

    this.logger.error(
      `Job ${job.id} failed permanently after ${job.attemptsMade} attempt(s): ${error.message}`,
    );
    const { companyId, typeId, documentId, actionId } = job.data;
    await markSendFailed((id) => this.documentsService.getType(id), {
      companyId,
      typeId,
      documentId,
      actionId,
      error,
    });
  }
}
