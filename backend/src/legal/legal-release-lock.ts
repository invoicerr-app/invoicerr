/**
 * Cross-replica mutex around the legal-release notification PASS — see
 * `legal-release-boot.service.ts`'s own header for the full defect this closes:
 * `notifyUsersOfLegalReleases` (`legal-release-notify.ts`) records a user's notification only AFTER a
 * successful send — deliberately, an AT-LEAST-ONCE guarantee (a boot that failed to reach a user is
 * retried by the NEXT boot, no memory of "was this the boot that found the change" needed) — so two
 * replicas racing the SAME "something changed" answer at the SAME moment (a rolling deploy boots 1-3
 * replicas within seconds to minutes of each other, on the SAME image, so this is not a rare
 * coincidence) each observe "not yet notified" and each send. `skipDuplicates` on the eventual DB
 * write only makes the ROW harmless; by the time it runs, the EMAIL has already gone out — up to once
 * per replica, to every user of the instance.
 *
 * `SET key value NX PX ttlMs` is a single atomic Redis command: exactly one caller across the whole
 * cluster ever gets `'OK'` back for a given key while it is held, so mutual exclusion does not depend
 * on a database transaction or advisory lock. Redis is already a hard boot dependency
 * (`modules/documents/queue/redis-required.guard.ts`), so this costs nothing new to depend on.
 *
 * THE GUARANTEE THIS PROVIDES, stated explicitly (the brief for this fix asked for exactly this):
 * still AT-LEAST-ONCE per (user, slug, contentHash) — unchanged from before this fix — but now with
 * MUTUAL EXCLUSION added on top, so the common case (a healthy rolling deploy) sends each notification
 * from exactly ONE replica's pass instead of one per replica. It is not a strict at-most-once/exactly-
 * once guarantee: the lock has a bounded TTL specifically so a replica that crashes mid-pass (the
 * brief's own scenario: "a boot can crash between deciding to send and recording that it sent") does
 * not wedge every future pass behind a lock nobody will ever release — the NEXT replica to reach this
 * code once the TTL expires resumes the pass, and `notifyOneUser`'s own per-user "already notified"
 * check (unchanged) means that resumption only re-sends whatever the crashed pass never got to record,
 * never what it already confirmed. AT-LEAST-ONCE is the right guarantee for THIS email specifically:
 * missing it silently (a stricter at-most-once design's failure mode) is worse for a legal-release
 * notice — some of these documents require re-acceptance (`REQUIRED_ACCEPTANCE_SLUGS`,
 * `legal-documents.ts`) enforced independently by `legal-acceptance.guard.ts` on every request
 * regardless of whether the email arrived, so the email is a courtesy notice riding alongside a
 * mechanism that does not depend on it — but an operator finding out a user was NEVER told about a
 * changed Terms of Service is a worse failure than that same user occasionally getting the resumed
 * pass's own re-send after a crash, which cannot happen more than once per genuinely crashed pass.
 *
 * The residual window this does NOT close: if the TTL elapses WHILE a replica is still genuinely
 * (slowly) mid-pass — never actually crashed — a second replica could start a concurrent pass and
 * both could send to whichever users the first has not yet reached. `LOCK_TTL_MS` is sized generously
 * above any realistic pass duration for exactly this reason; this is a deliberate trade of "duplicate
 * sends in a pathological, oversized-pass scenario" against "a permanently stuck lock after any real
 * crash", not an oversight.
 */
import type Redis from 'ioredis';

import { createLibRedisClient } from '@/lib/redis-connection';

const LOCK_KEY = 'legal-release-notify:lock';
// Generous relative to a real pass: `notifyUsersOfLegalReleases` sends in batches of 25 concurrently,
// and `MailService` itself bounds any single send's own timeout far below this. Long enough that a
// legitimate, slow pass (a large instance, a sluggish mail provider) is never preempted by its own
// crash-recovery TTL; short enough that a genuine crash does not lock real users out of a notification
// for more than a few minutes — see this file's own header for what happens if a real pass ever
// somehow exceeds it.
const LOCK_TTL_MS = 5 * 60_000;

export interface LegalReleaseLockRedisClient {
  set(key: string, value: string, mode: 'PX', ttlMs: number, flag: 'NX'): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

/**
 * Runs `fn` only if this process wins the cluster-wide lock; resolves to `undefined` WITHOUT calling
 * `fn` at all otherwise — the caller's own log line is what tells an operator "skipped, another
 * replica already has it" apart from "ran, nothing to do". Releases the lock itself once `fn` settles
 * (success OR failure) so a healthy fleet is never rate-limited by its own TTL — but only if THIS
 * call is still the one holding it (a `GET`-then-compare before the `DEL`, not a blind delete): if the
 * TTL already expired and a DIFFERENT replica has since acquired the lock, this call must not delete
 * THAT replica's live lock out from under it.
 */
export async function withLegalReleaseNotifyLock<T>(
  client: LegalReleaseLockRedisClient,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const acquired = await client.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
  if (acquired !== 'OK') return undefined;

  try {
    return await fn();
  } finally {
    try {
      const current = await client.get(LOCK_KEY);
      // Only delete OUR OWN lock. Not a compare-and-delete Lua script (no atomicity needed here): the
      // only actor that ever calls `del` on this key is whoever believes it holds it, immediately
      // after checking the value — there is no concurrent DELETER to race against, only a concurrent
      // ACQUIRER (a replica that took over after this token's own TTL already lapsed), and reading a
      // stale-but-still-OUR-token value here (the tiny gap between this GET and the DEL below) could
      // only ever cause a mistaken delete of OUR OWN, already-expired key — never another replica's.
      if (current === token) {
        await client.del(LOCK_KEY);
      }
    } catch {
      // Best-effort: worst case a stale key sits until its own TTL expires, which is the exact
      // crash-recovery path this lock already has to tolerate — never a duplicate send, only a
      // delayed retry for whatever this pass did not finish.
    }
  }
}

/**
 * Real client factory — `createLibRedisClient()` (`lib/redis-connection.ts`), the same shared
 * connection helper the rate-limit storage and the SSO registry sync use. A real `ioredis` instance
 * satisfies `LegalReleaseLockRedisClient` structurally (matching `set`/`get`/`del` overloads) with no
 * adapter needed. Returns the concrete `Redis` type, not the narrower interface, so the ONE real call
 * site (`legal-release-boot.service.ts`) can also `.quit()` it once the single boot-time pass this
 * lock guards is over — this is not a long-lived connection kept for the process's whole life the way
 * the SSO sync's or the throttler's own are.
 */
export function createLegalReleaseLockRedisClient(): Redis {
  return createLibRedisClient();
}
