/**
 * PDP RECEPTION sweep's own pure decisions/constants — split from `reception-sweep-runner.ts` (the
 * Prisma/`DocumentsService`/BullMQ-touching half) for the exact same reason `conformity-sweep.ts` is
 * split from `conformity-sweep-runner.ts` (see that file's own header): "what job name/id does this
 * mechanism use" and "how often does it run" are both plain facts, testable without a broker, a
 * database, or a real PDP client.
 *
 * ONE repeatable job, not one per company — same reasoning as the conformity sweep and the
 * recurrence sweep before it: the repeatable is a metronome; `PdpReceptionSweepRunner.runSweep()`
 * itself re-derives "which companies have PDP connected" (`ChannelCredentialsService.
 * listActiveByProvider`) fresh, every pass, from the database — nothing about a company's own
 * connection state is cached in the job or the repeatable definition.
 */

export const RECEPTION_SWEEP_JOB_NAME = 'document-pdp-reception-sweep';
export const RECEPTION_SWEEP_JOB_ID = 'document-pdp-reception-sweep-singleton';

/** Default 5 minutes — reception has no legal SLA this codebase found requiring a shorter cadence
 *  (contrast the conformity sweep's own default 60s, chasing a fr:200→202 verdict that superpdp's
 *  sandbox answers in under a second — see `pdp.live.spec.ts`'s own header); a supplier's invoice
 *  sitting a few extra minutes before it appears as a `received-invoice` costs nothing a human would
 *  notice, and polling less often is kinder to the platform's own rate limits. */
export function readReceptionSweepIntervalMs(): number {
  return parseInt(process.env.DOCUMENT_PDP_RECEPTION_SWEEP_INTERVAL_MS ?? '300000', 10);
}
