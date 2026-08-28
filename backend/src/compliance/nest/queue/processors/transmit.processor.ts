import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ApplySignalService } from '../../apply-signal';
import { FormatBuildError, FormatValidationError } from '../../../execution/types';
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

    let outcome: Awaited<ReturnType<ComplianceService['computeSendOutcome']>>;
    try {
      outcome = await this.complianceService.computeSendOutcome(rec, { idempotencyKey });
    } catch (err) {
      if (err instanceof FormatValidationError) {
        // M-1 (parity with ComplianceService.send()): the artifact failed format validation, so the
        // executor aborted before any transmission. Record the first-class VALIDATION_BLOCKED event
        // (shared ComplianceService method — same event shape as the sync path) and RETURN NORMALLY.
        // A format-validation failure is DETERMINISTIC: rebuilding the same invalid artifact on a
        // BullMQ retry would fail identically, so rethrowing here would only burn pointless retries
        // and, after removeOnFail, leave the document stuck at ISSUED with no surfaced state. Instead
        // the document stays at ISSUED (never transmitted) with the VALIDATION_BLOCKED event visible
        // — exactly the state outcome the sync path produces. Any OTHER error is transient (e.g. a
        // network hiccup) and MUST rethrow so BullMQ retries it.
        await this.complianceService.recordValidationBlocked(documentId, err);
        this.logger.warn(
          `[TRANSMIT] document ${documentId} blocked by format validation — recorded VALIDATION_BLOCKED, not retrying (job ${job.id}): ${err.message}`,
        );
        return;
      }
      if (err instanceof FormatBuildError) {
        // Same reasoning one step earlier in the pipeline. A validation failure means an artifact
        // was produced and then refused; a BUILD failure means the renderer would not produce one
        // at all. Both are deterministic — the same document from the same data fails identically —
        // so retrying is pure delay, and after `removeOnFail` the document sat at ISSUED with no
        // event, which a user cannot tell apart from "nothing has happened yet". That is exactly
        // the outcome the comment above says this branch exists to prevent; it just had no type to
        // recognise the case by, so the failure went out through the transient door.
        await this.complianceService.recordBuildFailed(documentId, err);
        // And PROJECT it, because an event nobody surfaces is an event nobody has.
        //
        // Recording BUILD_FAILED left the document at ISSUED, and the invoice screen keys its
        // failure banner on the invoice STATUS — so the first version of this fix produced a
        // perfectly good event that changed nothing a user could see. Which is the same defect,
        // one layer along, as the ones this whole sequence was fixing.
        //
        // TRANSMISSION_FAILED is the honest projection and not a convenience: the artifact could
        // not be produced, so nothing was ever transmitted and no authority ever saw anything.
        // That is precisely what the status means, and the runtime already allows the transition
        // from ISSUED.
        await this.applySignal.apply(documentId, {
          type: 'COMMAND',
          event: 'TRANSMISSION_FAIL',
        });
        this.logger.warn(
          `[TRANSMIT] document ${documentId} could not be built — recorded BUILD_FAILED and projected TRANSMISSION_FAILED, not retrying (job ${job.id}): ${err.message}`,
        );
        return;
      }
      throw err;
    }

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
