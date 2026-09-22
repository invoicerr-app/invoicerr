/**
 * Retires the repeatable (cron/interval) sweep definitions a queue still holds in Redis but the
 * CURRENT configuration no longer names — shared by every `*QueueWorkerModule` in this codebase that
 * registers one at boot.
 *
 * ## The defect this exists to prevent
 * A repeatable registered through `Queue.add(name, data, { repeat })` is keyed by a HASH of its own
 * schedule (BullMQ builds it from `name:jobId:endDate:tz:<pattern-or-every>`). Change the cron
 * expression or the interval and the next boot registers a job under a DIFFERENT key — it never
 * replaces the old one, which keeps its own entry in the `repeat` sorted set and keeps firing.
 * Redis outlives the deployment, so an operator who temporarily set a sweep to run every minute,
 * reverted the value and rolled every pod found the per-minute schedule still firing, with nothing
 * in the configuration to explain it. Removing a schedule from the configuration ENTIRELY had the
 * same outcome: the definition simply stayed.
 *
 * ## Why this is safe with several replicas booting at once
 * The decision here is a pure function of the CONFIGURATION — "keep exactly the schedules the
 * caller names, remove every other definition on this queue" — never a diff against whatever
 * happened to be registered a moment ago. Every replica reads the same environment, so every
 * replica computes the same wanted set and issues the same removals; one replica can never delete a
 * definition another replica just created, because a replica only ever creates definitions that are
 * in that same wanted set. Registration itself stays idempotent (BullMQ dedups by the key above), so
 * ordering between replicas does not matter either.
 *
 * The one case this genuinely cannot settle on its own is a rolling deploy where an OLD replica
 * boots after a new one has already pruned: it re-registers its own, older schedule. That window
 * closes as soon as the rollout finishes and the next up-to-date replica boots — whereas before,
 * nothing closed it at all.
 *
 * ## Identity, and why it is name + schedule
 * `Queue.getJobSchedulers()` reports what BullMQ actually stores for a definition — its job name,
 * `tz`, and either `pattern` or `every`. The `jobId` each call site passes at registration is NOT
 * part of that record, so it cannot take part in the comparison; it does not need to, because every
 * sweep on a given queue already has its own distinct job name.
 */
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

/** One schedule the current configuration names — exactly the `name` and `repeat` its call site
 *  passes to `Queue.add`, so a registration and its wanted-set entry can never describe different
 *  things. */
export interface ConfiguredRepeatable {
  name: string;
  repeat: { pattern?: string; every?: number; tz?: string };
}

const logger = new Logger('QueueRepeatables');

function repeatableIdentity(
  name: string,
  repeat: { pattern?: string | null; every?: number | null; tz?: string | null },
): string {
  return `${name}:${repeat.tz ?? ''}:${repeat.pattern ?? repeat.every ?? ''}`;
}

/**
 * Removes every repeatable definition on `queue` that is not in `configured`, and returns the
 * identities it removed (for a caller that wants to assert on them — the log line below is the
 * operational signal).
 *
 * Call this AFTER registering the configured schedules, never before: registering first means the
 * queue is never, even momentarily, left with no definition at all for a sweep that is still
 * configured.
 */
export async function retireSupersededRepeatables(
  queue: Queue,
  configured: ConfiguredRepeatable[],
): Promise<string[]> {
  const wanted = new Set(configured.map((entry) => repeatableIdentity(entry.name, entry.repeat)));
  const registered = await queue.getJobSchedulers();
  const retired: string[] = [];

  for (const scheduler of registered) {
    // BullMQ hands back `undefined` for a sorted-set entry whose own metadata hash is gone — an
    // orphan it offers no key to act on, so there is nothing to remove and nothing to keep.
    if (!scheduler) continue;

    const identity = repeatableIdentity(scheduler.name, scheduler);
    if (wanted.has(identity)) continue;

    await queue.removeJobScheduler(scheduler.key);
    retired.push(identity);
    logger.warn(
      `Retired superseded repeatable "${identity}" on queue "${queue.name}" — no longer named by the ` +
        'current configuration.',
    );
  }

  return retired;
}
