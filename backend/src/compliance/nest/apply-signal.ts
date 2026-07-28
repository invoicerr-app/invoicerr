import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ChannelType } from '../types';
import { ComplianceLogger, defaultLogger } from '../execution/logger';
import { AuthorityIdentifier } from '../execution/types';
import { assembleLifecycle, phaseContextFromPlan } from '../lifecycle/assembler';
import { ComplianceDocumentRecord } from '../operations/types';
import { Effect, LifecycleRuntime, LifecycleSignal } from '../lifecycle/runtime';
import { createPollJob, nextDelaySeconds } from '../lifecycle/drivers/poll-job';
import { createTimerJob } from '../lifecycle/drivers/timer-job';
import { createRegistration } from '../lifecycle/drivers/inbound-job';
import {
  defaultTransmissionRegistry,
  TransmissionProviderRegistry,
} from '../providers/transmission/registry';
import { TransmissionProvider } from '../providers/transmission/transmission-provider';
import { PrismaComplianceDocumentStore } from '../persistence/prisma-document-store';
import { PrismaPollJobStore, PrismaTimerJobStore } from '../persistence/prisma-scheduled-job-store';
import { PrismaCallbackStore } from '../persistence/prisma-callback-store';
import { ComplianceQueueDispatcher } from './queue/compliance-queue.dispatcher';

let seq = 0;
function genId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/**
 * M-12b: private sentinel thrown INSIDE the `$transaction` callback to abort it cleanly when the
 * optimistic CAS (`PrismaComplianceDocumentStore.transitionIfStatus`) loses — i.e. some other signal
 * already advanced the document past the status this signal's effects were computed from. Throwing
 * inside a Prisma interactive transaction rolls back every write the callback made so far (including
 * any driver cancel/arm calls that ran before the CAS), so a losing signal leaves the database
 * completely untouched. Caught immediately outside the `$transaction` call — never escapes `apply()`.
 */
class StaleSignalAbort extends Error {}

/**
 * Merge authority identifiers (KSeF number, UPO URL, …) returned by an async poll into a document's
 * existing set, deduping by (scheme, value) so a re-poll of an already-recorded id — or two poll
 * cycles that both observe the same clearance — never creates duplicate rows. Mirrors
 * `ComplianceService.markCleared`'s merge semantics (append, keep the existing entries first).
 */
function mergeAuthorityIds(
  existing: AuthorityIdentifier[],
  incoming: AuthorityIdentifier[],
): AuthorityIdentifier[] {
  const merged = [...existing];
  for (const id of incoming) {
    if (!merged.some((e) => e.scheme === id.scheme && e.value === id.value)) {
      merged.push(id);
    }
  }
  return merged;
}

/**
 * The real `applySignal` bridge: loads a document's runtime, dispatches the signal, and persists the
 * result. Every write for one signal — the status/event update, cancelling the drivers that guarded
 * the OLD state, and arming the drivers for the NEW state — happens inside a single Prisma
 * transaction, so a partial failure never leaves the document and its scheduled jobs inconsistent.
 *
 * A signal that resolves to a NOOP (stale/duplicate/inapplicable) writes nothing and never opens a
 * transaction — the runtime-level safety (no matching transition ⇒ NOOP) is enough; we don't also need
 * to touch the database for it.
 */
export class ApplySignalService {
  constructor(
    private readonly prisma: PrismaService,
    // F-3 (QUEUE_IMPL_PLAN.md §5.2): the DI factory (compliance.module.ts / compliance-core.module.ts)
    // always passes the CREDENTIALED registry here. The `defaultTransmissionRegistry` fallback exists
    // only so offline callers (e.g. apply-signal.live.spec.ts, which does `new ApplySignalService(prisma)`
    // with a single arg) keep working without needing a real Redis/BullMQ or credentials wiring.
    private readonly txRegistry: TransmissionProviderRegistry = defaultTransmissionRegistry,
    // Post-commit BullMQ projection (QUEUE_IMPL_PLAN.md Décision 5 — outbox-lite). Optional so this
    // class stays constructible without a live queue (unit/live-DB specs); when absent, SCHEDULE_POLL
    // effects are still persisted to ScheduledJob (the durable registry) but are NOT projected onto
    // compliance-poll — a real deployment always injects the real dispatcher (see compliance-core.module.ts).
    private readonly dispatcher?: ComplianceQueueDispatcher,
    private readonly log: ComplianceLogger = defaultLogger,
  ) {}

  /**
   * `ctx.transmitRef` (QUEUE_IMPL_PLAN.md F-2/F-3) is the accepted channel's authority/transmission
   * ref, computed by `ComplianceService.computeSendOutcome()` in the TransmitProcessor. It is
   * threaded into:
   *  - `SCHEDULE_POLL` (`ref`), so the poll driver interrogates the authority with the real external
   *    reference instead of falling back to the internal documentId.
   *  - `AWAIT_CALLBACK` (`correlationKey`, F-2 fix, Phase 4 — QUEUE_IMPL_PLAN.md §5.2): the armed
   *    `CallbackRegistration` correlates on `effect.correlationKey ?? ctx.transmitRef ?? documentId`.
   *    An inbound webhook (SdI notifica, PDP status push, Peppol MLR) carries the AUTHORITY's ref
   *    (e.g. PDP `invoice_id`, SdI `idSdI`) — never the internal documentId — so without this the
   *    registration would never correlate and `InboundRouter.receive()` would report UNMATCHED.
   *
   * F-2 fallback POLL (Phase 4 — QUEUE_IMPL_PLAN.md §5.2): whenever an `AWAIT_CALLBACK` is armed for
   * a channel whose provider declares `feedback === 'ASYNC_CALLBACK'`, we ALSO arm a belt-and-
   * suspenders `SCHEDULE_POLL` using that provider's own `pollPolicy` (already declared alongside
   * `feedback` for exactly this purpose — see e.g. PdpTransmissionProvider's "poll() is the fallback"
   * comment). If the webhook never arrives, the periodic poll still resolves the document to a
   * terminal status; whichever driver resolves first cancels the other via the normal
   * `cancelForDocument` cleanup on APPLIED.
   *
   * Phase 3 (QUEUE_IMPL_PLAN.md §5.2/§9): ARM_TIMER effects are now ALSO projected post-commit onto
   * `compliance-timer`, same outbox-lite pattern as SCHEDULE_POLL below (durable ScheduledJob row
   * written inside the transaction; BullMQ delayed job enqueued only once it has actually committed).
   */
  async apply(
    documentId: string,
    signal: LifecycleSignal,
    log?: ComplianceLogger,
    ctx?: { transmitRef?: string },
  ): Promise<void> {
    const l = log ?? this.log;
    const docStore = new PrismaComplianceDocumentStore(this.prisma);
    const rec = await docStore.get(documentId);
    if (!rec) {
      l.warn('nest/apply-signal', `document ${documentId} not found`);
      return;
    }

    const runtime = await this.buildRuntime(rec);
    const effects = runtime.dispatch(signal);
    if (effects.length === 1 && effects[0].kind === 'NOOP') return;

    const now = new Date().toISOString();
    let hasApplied = false;
    // Post-commit BullMQ projection queue (Décision 5): the ScheduledJob row is the durable source of
    // truth, written inside the transaction below; the BullMQ delayed job is a projection of it,
    // enqueued only once the transaction has actually committed.
    const pollProjections: Array<{ scheduledJobId: string; delayMs: number }> = [];
    const timerProjections: Array<{ scheduledJobId: string; delayMs: number }> = [];

    try {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const txDocStore = new PrismaComplianceDocumentStore(tx as unknown as PrismaService);
        const txPollStore = new PrismaPollJobStore(tx as unknown as PrismaService);
        const txTimerStore = new PrismaTimerJobStore(tx as unknown as PrismaService);
        const txCallbackStore = new PrismaCallbackStore(tx as unknown as PrismaService);

        const applied = effects.find((e): e is Extract<Effect, { kind: 'APPLIED' }> => e.kind === 'APPLIED');
        if (applied) {
          // M-12b: CAS the status write FIRST, conditioned on the document still being in
          // `rec.status` (the status this whole `effects` computation was derived from). Two
          // concurrent signals (e.g. a poll resolving CLEAR and a webhook resolving REJECT) both read
          // the same stale `rec.status` and both compute an APPLIED effect — only the one that gets
          // here first still finds the document in `rec.status`; the loser's `updateMany` matches
          // zero rows and we abort the whole transaction below, so it never touches the drivers or
          // the event log.
          const cas = await txDocStore.transitionIfStatus(documentId, rec.status, {
            status: applied.to,
            events: [...rec.events, { id: randomUUID(), type: applied.event, at: now, actor: 'system' }],
          });
          if (!cas.applied) {
            throw new StaleSignalAbort(
              `document ${documentId} already advanced from ${rec.status} — concurrent signal lost the CAS`,
            );
          }
          hasApplied = true;
          // Only now that the CAS has actually won: the document really did just leave `rec.status`
          // for `applied.to`, so any driver still guarding the OLD state is now obsolete. (A stale
          // fire is already a safe runtime no-op; this keeps the scheduled-job/callback tables from
          // accumulating dead rows that poll a resolved document for up to their full timeout — e.g.
          // a leaked MX PAC poll every 30s for 24h.)
          await Promise.all([
            txPollStore.cancelForDocument(documentId),
            txTimerStore.cancelForDocument(documentId),
            txCallbackStore.cancelForDocument(documentId),
          ]);

          // Bug fix: a POLL_RESULT signal carries the authority identifiers (KSeF number, UPO URL, …)
          // its provider.poll() observed alongside the CLEARED/REJECTED status — the async-poll
          // counterpart of the synchronous path, where ComplianceService already persists
          // execution.regime.authorityIds on send()/markCleared(). Persist them ONLY now that the CAS
          // has actually committed this transition (never on a losing CAS — the StaleSignalAbort below
          // rolls back this entire transaction, including this write) and merge-dedup against the
          // document's existing ids (rec.authorityIds, read before this signal) so a re-poll observing
          // the same id twice never duplicates it.
          if (signal.type === 'POLL_RESULT' && signal.authorityIds && signal.authorityIds.length > 0) {
            const merged = mergeAuthorityIds(rec.authorityIds, signal.authorityIds);
            await txDocStore.update(documentId, { authorityIds: merged });
          }
        }

        for (const effect of effects) {
          if (effect.kind === 'SCHEDULE_POLL') {
            const provider = effect.channelProviderId
              ? this.txRegistry.getById(effect.channelProviderId)
              : null;
            const scheduledJobId = genId('poll');
            const job = createPollJob(
              {
                id: scheduledJobId,
                documentId,
                providerId: effect.channelProviderId ?? '(unknown)',
                channel: provider?.channel ?? 'GOV_PORTAL_API',
                ref: ctx?.transmitRef,
                awaiting: effect.awaiting,
                policy: effect.poll,
              },
              new Date(),
            );
            await txPollStore.enqueue(job);
            pollProjections.push({ scheduledJobId, delayMs: nextDelaySeconds(effect.poll, 0) * 1000 });
          } else if (effect.kind === 'ARM_TIMER') {
            if (effect.deadlineHours == null) continue; // open-ended response window: no silence timer
            const scheduledJobId = genId('timer');
            const job = createTimerJob(
              {
                id: scheduledJobId,
                documentId,
                awaiting: effect.awaiting,
                onElapse: effect.onElapse,
                deadlineHours: effect.deadlineHours,
              },
              new Date(),
            );
            await txTimerStore.arm(job);
            timerProjections.push({ scheduledJobId, delayMs: effect.deadlineHours * 3_600_000 });
          } else if (effect.kind === 'AWAIT_CALLBACK') {
            const channel = this.resolveChannel(rec);
            if (!channel) continue;
            const reg = createRegistration(
              {
                id: genId('cb'),
                documentId,
                channel,
                // F-2 fix (QUEUE_IMPL_PLAN.md §5.2): correlate on the authority's EXTERNAL ref, not the
                // internal documentId the inbound webhook never sees.
                correlationKey: effect.correlationKey ?? ctx?.transmitRef ?? documentId,
                awaiting: effect.awaiting,
              },
              new Date(),
            );
            await txCallbackStore.register(reg);

            // F-2 fallback POLL (Phase 4): belt-and-suspenders for ASYNC_CALLBACK channels — see the
            // class docstring above. Reuses the provider's own pollPolicy; no new cadence invented.
            const provider = this.resolveProvider(rec);
            if (
              provider?.feedback === 'ASYNC_CALLBACK' &&
              provider.pollPolicy &&
              typeof provider.poll === 'function'
            ) {
              const scheduledJobId = genId('poll');
              const job = createPollJob(
                {
                  id: scheduledJobId,
                  documentId,
                  providerId: provider.id,
                  channel,
                  ref: ctx?.transmitRef,
                  awaiting: effect.awaiting,
                  policy: provider.pollPolicy,
                },
                new Date(),
              );
              await txPollStore.enqueue(job);
              pollProjections.push({
                scheduledJobId,
                delayMs: nextDelaySeconds(provider.pollPolicy, 0) * 1000,
              });
            }
          }
        }
      });
    } catch (e) {
      if (e instanceof StaleSignalAbort) {
        // M-12b: the CAS lost — some other signal already advanced this document past `rec.status`.
        // The transaction rolled back everything the callback wrote (drivers cancelled, status/event
        // write), so the database is exactly as it was before this call. Treat the whole signal as a
        // clean NOOP: no further post-commit projection work, nothing to log as an error.
        l.info(
          'nest/apply-signal',
          `stale signal — document ${documentId} already advanced from ${rec.status} (${signal.type}); discarding`,
        );
        return;
      }
      throw e;
    }

    // Post-commit projection (Décision 5): only after the transaction has committed do we touch
    // BullMQ, so a crash between the DB write and the enqueue leaves the durable ScheduledJob row as
    // the source of truth (a future sweep — Phase 3 — re-projects it). `dispatcher` is optional (see
    // constructor note) so callers without a live queue (tests, live-DB specs) still work.
    if (this.dispatcher) {
      if (hasApplied) {
        await this.dispatcher.removeForDocument(documentId);
      }
      for (const { scheduledJobId, delayMs } of pollProjections) {
        await this.dispatcher.enqueuePoll(documentId, scheduledJobId, delayMs);
      }
      for (const { scheduledJobId, delayMs } of timerProjections) {
        await this.dispatcher.enqueueTimer(documentId, scheduledJobId, delayMs);
      }
    } else if (pollProjections.length > 0 || timerProjections.length > 0) {
      l.warn(
        'nest/apply-signal',
        `no queue dispatcher configured — SCHEDULE_POLL/ARM_TIMER effect(s) for ${documentId} were persisted but not projected to BullMQ`,
      );
    }
  }

  private async buildRuntime(rec: ComplianceDocumentRecord): Promise<LifecycleRuntime> {
    const plan = rec.plan;
    if (!plan) throw new Error(`Document ${rec.id} has no plan — cannot build lifecycle runtime`);
    const pctx = phaseContextFromPlan(plan, this.txRegistry);
    const graph = assembleLifecycle(plan, pctx);
    return new LifecycleRuntime(graph, rec.status, this.log);
  }

  private resolveChannel(rec: ComplianceDocumentRecord): ChannelType | null {
    const plan = rec.plan;
    if (!plan || !plan.channels.length) return null;
    return plan.channels[0].type as ChannelType;
  }

  /** Resolve the primary channel's TransmissionProvider (for its `feedback`/`pollPolicy` metadata). */
  private resolveProvider(rec: ComplianceDocumentRecord): TransmissionProvider | null {
    const plan = rec.plan;
    if (!plan || !plan.channels.length) return null;
    return this.txRegistry.resolve(plan.channels[0]);
  }
}
