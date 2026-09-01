/**
 * Shared, TARGETED cleanup for the three `document-action` Redis integration specs in this
 * directory — see each spec's own `afterAll` for why this exists and `document-queue.dispatcher.ts`
 * for the repeatable registrations it must never touch.
 *
 * These three specs all share the SAME `Q_DOCUMENT_ACTION` queue with a persistent `start:test`
 * backend (:4000, `WORKER_INLINE`) that may be running alongside them — the same queue that backend
 * registers its OWN two repeatables on at boot (`registerScheduleSweepRepeatable`,
 * `registerConformitySweepRepeatable`, both in document-queue.dispatcher.ts). `queue.obliterate()`
 * used to run here instead of this helper: it does not distinguish "this spec's own jobs" from
 * "everything else on the queue", so it silently deleted those two repeatable registrations too —
 * registered ONLY at process boot, never again, so once obliterated they stayed gone until the
 * backend was restarted. The visible symptom was the recurrence sweep (and the conformity sweep)
 * going permanently silent after any local run of this suite, with nothing in this suite's own
 * output pointing at the cause.
 *
 * The fix: every job this mechanism ever adds to `Q_DOCUMENT_ACTION` — an ordinary action job
 * (queue.constants.ts's `DocumentActionJobData`), a schedule occurrence (schedule-sweep.ts's
 * `ScheduleOccurrenceJobData`), or a conformity poll (conformity-sweep.ts's `ConformityPollJobData`)
 * — carries a `companyId` field. Each of these three specs creates exactly one, disposable `Company`
 * row in `beforeAll` and deletes it in `afterAll`, so "every job whose OWN data carries this spec's
 * `companyId`" is an unambiguous, exhaustive description of "this spec's own jobs", in ANY state
 * (waiting/active/delayed/completed/failed/...) — never a job belonging to another document, another
 * company, or the real backend's own unrelated traffic.
 *
 * This is also why it is safe WITHOUT ever inspecting `job.name`: the two repeatables' own job
 * INSTANCES are added with a literal `{}` payload (`as unknown as DocumentActionJobData` —
 * document-queue.dispatcher.ts's `registerScheduleSweepRepeatable`/`registerConformitySweepRepeatable`),
 * so `job.data.companyId` on those is always `undefined` and never matches a real company id — they
 * are excluded by construction, not by an extra check that could later be forgotten. The repeatable
 * DEFINITIONS themselves (the `bull:document-action:repeat:*` scheduler entries BullMQ consults to
 * produce those instances) are a separate structure entirely; `queue.getJobs()` never returns them,
 * so there is nothing here that could touch them even by accident.
 */
import { Queue } from 'bullmq';

/** Every state a job on this queue could plausibly be sitting in when a spec's `afterAll` runs —
 *  deliberately broad (a slow assertion earlier in the same `it()` throwing before a job settles
 *  should still leave nothing behind) rather than only the terminal ones. */
const ALL_JOB_STATES = [
  'completed',
  'failed',
  'active',
  'delayed',
  'waiting',
  'waiting-children',
  'prioritized',
  'paused',
] as const;

/**
 * Removes every job on `queue` whose own `data.companyId` equals `companyId` — see this file's own
 * header for why that is an exhaustive, unambiguous description of "this spec's own jobs" on a queue
 * shared with a live backend, and why it can never reach a repeatable's registration.
 */
export async function removeQueueJobsForCompany(queue: Queue, companyId: string): Promise<void> {
  const jobs = await queue.getJobs([...ALL_JOB_STATES]);
  const mine = jobs.filter(
    (job) => (job.data as { companyId?: string } | undefined)?.companyId === companyId,
  );
  await Promise.all(mine.map((job) => job.remove().catch(() => undefined)));
}
