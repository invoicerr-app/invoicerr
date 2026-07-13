import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ApplySignalService } from '../../apply-signal';
import { PrismaComplianceDocumentStore } from '../../../persistence/prisma-document-store';
import { ComplianceService } from '../../../operations/compliance-service';
import { TransmitJobData, Q_TRANSMIT } from '../queue.constants';

/**
 * QUEUE_IMPL_PLAN.md §4.5/§9 Phase 2 — the real "send" path.
 *
 * Loads the document, guards idempotency (a document that already moved past ISSUED/
 * TRANSMISSION_FAILED is a NOOP — e.g. a duplicate/retried job after the first one already
 * succeeded), then reuses `ComplianceService.computeSendOutcome()` (extracted from `send()` —
 * compliance-service.ts) to run the REAL executor/registry transmit and derive the outcome event.
 * The event is fed into `ApplySignalService.apply()` — the event-sourced LifecycleRuntime path —
 * with `transmitRef` so a subsequent SCHEDULE_POLL effect polls the authority with the real
 * external reference (not the internal documentId).
 *
 * Does NOT reimplement transmission: all network I/O happens inside `executor.execute()` via the
 * DI-wired (credentialed — F-3) TransmissionProviderRegistry, exactly as `send()` uses it.
 */
@Processor(Q_TRANSMIT)
export class TransmitProcessor extends WorkerHost {
  private readonly logger = new Logger(TransmitProcessor.name);

  constructor(
    private readonly docStore: PrismaComplianceDocumentStore,
    private readonly complianceService: ComplianceService,
    private readonly applySignal: ApplySignalService,
  ) {
    super();
  }

  async process(job: Job<TransmitJobData>): Promise<void> {
    const { documentId, idempotencyKey } = job.data;
    const rec = await this.docStore.get(documentId);
    if (!rec) {
      this.logger.warn(`[TRANSMIT] document ${documentId} not found — skipping`);
      return;
    }

    // Idempotent NOOP: only ISSUED (first attempt) and TRANSMISSION_FAILED (retry — Phase 4 endpoint)
    // are valid entry points. Anything else means a previous run of this same job (or a direct
    // ComplianceService.send() call) already advanced the document — re-processing would either
    // throw (illegal COMMAND) or double-transmit, so this guard makes at-least-once delivery safe.
    if (rec.status !== 'ISSUED' && rec.status !== 'TRANSMISSION_FAILED') {
      this.logger.log(`[TRANSMIT] document ${documentId} is already ${rec.status} — NOOP (job ${job.id})`);
      return;
    }

    const outcome = await this.complianceService.computeSendOutcome(rec, { idempotencyKey });

    // Parity with ComplianceService.send(): persist the resolved regime authorityIds alongside the
    // transition (applySignal's transaction only touches status/events; it does not know about
    // authorityIds, which are a send()-only concept coming out of the regime handler).
    if (outcome.execution.regime.authorityIds.length > 0) {
      await this.docStore.update(documentId, {
        authorityIds: [...rec.authorityIds, ...outcome.execution.regime.authorityIds],
      });
    }

    await this.applySignal.apply(documentId, { type: 'COMMAND', event: outcome.event }, undefined, {
      transmitRef: outcome.transmitRef,
    });

    this.logger.log(
      `[TRANSMIT] document ${documentId} -> ${outcome.event} (ref=${outcome.transmitRef ?? 'n/a'}) [job ${job.id}]`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(`[TRANSMIT] job ${job?.id} (doc=${job?.data?.documentId}) failed: ${error.message}`);
  }
}
