import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

/**
 * Makes room for a fresh job under a deterministic `jobId`. A TERMINAL (completed/failed) job under
 * that id is removed, because BullMQ refuses to add a job whose id already exists, INCLUDING one that
 * already finished; a job still WAITING, DELAYED or ACTIVE is left alone, which is exactly the
 * idempotency the deterministic id exists to provide. `document-queue.dispatcher.ts#enqueueAction`
 * documents the bug this fixed in full.
 *
 * Returns `true` when the caller may add its job, `false` when one is already in flight. `jobNoun`
 * names the job in the log lines ("job", "OCR job").
 */
export async function clearTerminalJob<Data>(
  queue: Pick<Queue<Data>, 'getJob'>,
  jobId: string,
  logger: Pick<Logger, 'log'>,
  jobNoun: string,
): Promise<boolean> {
  const existing = await queue.getJob(jobId);
  if (!existing) return true;
  const state = await existing.getState();
  if (state === 'completed' || state === 'failed') {
    await existing.remove();
    logger.log(`Cleared ${state} ${jobNoun} ${jobId} so a fresh attempt can run.`);
    return true;
  }
  const subject = `${jobNoun.charAt(0).toUpperCase()}${jobNoun.slice(1)}`;
  logger.log(`${subject} ${jobId} is already ${state} — not enqueuing a duplicate.`);
  return false;
}
