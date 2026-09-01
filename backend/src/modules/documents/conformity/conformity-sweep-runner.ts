/**
 * The Prisma/queue-touching half of the conformity sweep — `conformity-sweep.ts` holds the pure
 * decisions (`decideConformityAction`, `buildConformityPollJobId`); this class is what actually reads
 * `DocumentInstance`/`DocumentAuthorityEvent` rows, resolves pollers, and talks to the queue — the
 * same "pure core, thin persistence shell" split `schedules/schedule-sweep-runner.ts` already holds
 * for the recurrence mechanism, imitated deliberately (this task's own brief: "le motif du sweep de
 * récurrences résout déjà ça, imite-le").
 *
 * Consumed by `queue/processors/document-action.processor.ts` — the sweep repeatable and every POLL
 * job it dispatches both come off the SAME `Q_DOCUMENT_ACTION` queue that processor already owns,
 * distinguished by `job.name`, the identical reasoning that file's own header already documents for
 * the recurrence sweep's own two job names.
 */
import { Injectable, Logger } from '@nestjs/common';

import {
  createAuthorityEvents,
  findConformitySweepCandidates,
  journalSyntheticEvent,
} from './authority-events.persistence';
import { AuthorityStatusPollerRegistry, ChannelNotConnectedError } from './authority-status-poller';
import {
  BLOCKED_STATUS_CODE,
  buildConformityPollJobId,
  CONFORMITY_POLL_JOB_NAME,
  ConformityPollJobData,
  decideConformityAction,
  GAVE_UP_STATUS_CODE,
  readConformitySweepIntervalMs,
  readMaxPollAgeMs,
} from './conformity-sweep';
import { DocumentQueueDispatcher } from '../queue/document-queue.dispatcher';

export interface RunConformitySweepResult {
  /** How many candidates `findConformitySweepCandidates` returned (sent + transportRef + a pollable
   *  provider), BEFORE the terminal/age filter below — includes documents this pass turned out to
   *  skip or give up on. */
  candidates: number;
  /** How many poll jobs were actually enqueued this pass (lower than `candidates` for every document
   *  already terminal, or that just gave up). */
  polled: number;
  /** How many documents this pass gave up on for the first time (journaled 'poll:gave-up'). */
  gaveUp: number;
}

@Injectable()
export class ConformitySweepRunner {
  private readonly logger = new Logger(ConformitySweepRunner.name);

  constructor(
    private readonly pollerRegistry: AuthorityStatusPollerRegistry,
    private readonly queueDispatcher: DocumentQueueDispatcher,
  ) {}

  /**
   * One sweep pass — see `conformity-sweep.ts`'s own header for the full "why a wall-clock window,
   * why no per-document stored due date" reasoning. `now` is a parameter (not always `new Date()`)
   * for the exact same reason `DocumentScheduleSweepRunner.runSweep` takes one: a test (offline or
   * the real-Redis integration spec) can pass an IDENTICAL `now` to two concurrent calls to
   * deterministically reproduce the race the jobId dedup exists to survive.
   */
  async runSweep(now: Date = new Date()): Promise<RunConformitySweepResult> {
    const pollableProviderIds = this.pollerRegistry.pollableProviderIds();
    const candidates = await findConformitySweepCandidates(pollableProviderIds);

    const intervalMs = readConformitySweepIntervalMs();
    const maxPollAgeMs = readMaxPollAgeMs();

    let polled = 0;
    let gaveUp = 0;

    for (const candidate of candidates) {
      const poller = this.pollerRegistry.resolve(candidate.channelProviderId);
      if (!poller) {
        // Defensive only — `findConformitySweepCandidates` already filtered on
        // `pollableProviderIds`, so this branch is unreachable in practice unless the registry
        // itself changed between the two calls (it never does, at runtime). Loud, never silent.
        this.logger.warn(
          `Document ${candidate.id} named a pollable provider "${candidate.channelProviderId}" that ` +
            'the registry no longer resolves — skipping this pass.',
        );
        continue;
      }

      const decision = decideConformityAction(
        {
          id: candidate.id,
          companyId: candidate.companyId,
          transportRef: candidate.transportRef,
          channelProviderId: candidate.channelProviderId,
          sentAt: candidate.updatedAt,
          existingStatusCodes: candidate.existingStatusCodes,
        },
        (statusCode) => poller.isTerminal(statusCode),
        now,
        maxPollAgeMs,
      );

      if (decision.action === 'skip') continue;

      if (decision.action === 'gave-up') {
        // A plain, synchronous, idempotent write — never an external HTTP call, so there is no need
        // to hand this off to a queue job the way an actual poll is (see this file's own header on
        // why the recurrence sweep's own `advanceSchedule` write is likewise made inline). Journaled
        // "une seule fois" — never by an extra existence check here, but structurally, by the
        // model's own `@@unique`: a later pass recomputing 'gave-up' for the same document before
        // this write lands would simply hit `skipDuplicates` and count zero new rows.
        const created = await journalSyntheticEvent(
          candidate.companyId,
          candidate.id,
          candidate.channelProviderId,
          GAVE_UP_STATUS_CODE,
          `No terminal conformity verdict after ${Math.round(maxPollAgeMs / (24 * 60 * 60 * 1000))} day(s) — giving up.`,
          now,
        );
        if (created > 0) gaveUp++;
        continue;
      }

      // decision.action === 'poll'
      const jobId = buildConformityPollJobId(candidate.id, now, intervalMs);
      const jobData: ConformityPollJobData = {
        companyId: candidate.companyId,
        documentId: candidate.id,
        providerId: candidate.channelProviderId,
        transportRef: candidate.transportRef,
      };
      if (await this.queueDispatcher.enqueueConformityPoll(jobId, jobData)) polled++;
    }

    return { candidates: candidates.length, polled, gaveUp };
  }

  /**
   * Runs ONE poll — resolves the poller fresh (never a value cached at enqueue time, the identical
   * discipline `schedule-sweep-runner.ts#runOccurrence` already holds for its own re-read source
   * document), calls it, and journals whatever comes back.
   *
   * NEVER throws — see `authority-status-poller.ts`'s own header ("un handler d'événement ne tue
   * jamais le processus", this task's own explicit rule): a missing/invalid credential
   * (`ChannelNotConnectedError`) OR any other unexpected failure (a network error, a malformed
   * response) both end up journaling `BLOCKED_STATUS_CODE` with the failure's own message as
   * `reason` — loud (logged, and visible on the document as a "blocked" badge), never a crashed
   * worker process and never a silently-swallowed poll.
   */
  async runPoll(data: ConformityPollJobData): Promise<{ journaled: number }> {
    const poller = this.pollerRegistry.resolve(data.providerId);
    if (!poller) {
      this.logger.warn(`No authority-status poller registered for "${data.providerId}" — nothing polled.`);
      return { journaled: 0 };
    }

    try {
      const events = await poller.poll(data.companyId, data.transportRef);
      const journaled = await createAuthorityEvents(data.companyId, data.documentId, data.providerId, events);
      this.logger.log(
        `Conformity poll for document ${data.documentId} ("${data.providerId}"): ` +
          `${events.length} event(s) observed, ${journaled} newly journaled.`,
      );
      return { journaled };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isBlocked = error instanceof ChannelNotConnectedError;
      this.logger.warn(
        `Conformity poll for document ${data.documentId} ("${data.providerId}") could not run: ${message}` +
          (isBlocked ? '' : ' (unexpected failure, not merely "not connected")'),
      );
      // BELT AND SUSPENDERS — found necessary by this task's own mutation testing (mutation #2,
      // "dedup cassée"): with the DB's own `@@unique` constraint still in place but the application-
      // level `skipDuplicates` removed, a SECOND blocked poll for the SAME document collided on its
      // OWN previous 'poll:blocked' row and threw straight out of this method — exactly the "never
      // crashes the process" rule this whole mechanism exists to uphold, broken by its own
      // compensating write. Never trust the fallback write itself not to fail either — the identical
      // discipline `archive/archive-on-send.ts`'s own compensating write already holds.
      try {
        const journaled = await journalSyntheticEvent(
          data.companyId,
          data.documentId,
          data.providerId,
          BLOCKED_STATUS_CODE,
          message,
        );
        return { journaled };
      } catch (journalError) {
        this.logger.error(
          `Could not even journal poll:blocked for document ${data.documentId} — original failure: ` +
            `${message}; journaling failure: ` +
            `${journalError instanceof Error ? journalError.message : String(journalError)}`,
        );
        return { journaled: 0 };
      }
    }
  }
}

/** Re-exported so a caller needing only the job-name constant doesn't have to reach into
 *  conformity-sweep.ts directly for it — same convenience `schedule-sweep-runner.ts` offers for
 *  `DocumentScheduleRecord`. */
export { CONFORMITY_POLL_JOB_NAME };
