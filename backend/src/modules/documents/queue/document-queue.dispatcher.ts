/**
 * The single point of enqueueing for the document-action queue — the Nest-injectable, BullMQ-backed
 * implementation of `DocumentActionQueueDispatcher` (queue.constants.ts) that action handlers
 * (actions/async-send.ts) are actually wired against in production (documents.module.ts). A jest spec
 * never needs this class at all — it depends on the narrow interface instead (see that file's own
 * header).
 */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { buildDocumentActionJobId } from './document-action-job';
import { DocumentActionJobData, DocumentActionQueueDispatcher, Q_DOCUMENT_ACTION } from './queue.constants';

@Injectable()
export class DocumentQueueDispatcher implements DocumentActionQueueDispatcher {
  private readonly logger = new Logger(DocumentQueueDispatcher.name);

  constructor(@InjectQueue(Q_DOCUMENT_ACTION) private readonly queue: Queue<DocumentActionJobData>) {}

  /**
   * Enqueues one document-action job under its deterministic jobId. Carried over from the
   * pre-refonte compliance queue's own `enqueueTransmit` (`avant-refonte-documents`,
   * compliance-queue.dispatcher.ts) almost verbatim, including the exact bug fix its own comment
   * documents: a TERMINAL (completed/failed) job under this same id must be cleared before adding a
   * fresh one — BullMQ refuses to add a job whose id already exists, INCLUDING one that already
   * finished, and `removeOnFail` deliberately keeps a failure around for diagnosis. Without this, once
   * a document's first send attempt had exhausted its retries, every later re-`send` (the retry IS the
   * action itself — see actions/async-send.ts) would be silently accepted and do nothing: no new
   * attempt, no error, a document stuck at "send_failed" with a working-looking Retry button that
   * could not retry. Only a job that is WAITING, DELAYED, or ACTIVE — genuinely still in flight — is
   * left alone: that is exactly the idempotency this deterministic id exists to provide.
   */
  async enqueueAction(input: DocumentActionJobData): Promise<void> {
    const jobId = buildDocumentActionJobId(input.typeId, input.documentId, input.actionId);

    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove();
        this.logger.log(`Cleared ${state} job ${jobId} so a fresh attempt can run.`);
      } else {
        this.logger.log(`Job ${jobId} is already ${state} — not enqueuing a duplicate.`);
        return;
      }
    }

    const attempts = parseInt(process.env.DOCUMENT_ACTION_QUEUE_ATTEMPTS ?? '3', 10);
    await this.queue.add('run', input, {
      jobId,
      attempts,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      // Kept around (capped) on failure — queue/mark-send-failed.ts and a human reading the queue
      // both need SOMETHING to inspect once every retry is spent, the same reasoning the pre-refonte
      // dispatcher's own `removeOnFail: { count: 50 }` already documents.
      removeOnFail: { count: 50 },
    });
    this.logger.log(`Job ${jobId} enqueued (action="${input.actionId}", type="${input.typeId}").`);
  }
}
