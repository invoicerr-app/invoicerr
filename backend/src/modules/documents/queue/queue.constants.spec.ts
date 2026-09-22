/**
 * `readDocumentActionQueueAttempts` in isolation — the env read both `enqueueAction` and
 * `enqueueReport` go through. The value it returns is the one BullMQ compares against in
 * `this.attemptsMade + 1 < this.opts.attempts`, so anything that is not a positive integer means
 * "no retry at all" rather than "fewer retries": see that function's own header.
 */
import { DEFAULT_DOCUMENT_ACTION_QUEUE_ATTEMPTS, readDocumentActionQueueAttempts } from './queue.constants';

describe('readDocumentActionQueueAttempts', () => {
  const ORIGINAL = process.env.DOCUMENT_ACTION_QUEUE_ATTEMPTS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.DOCUMENT_ACTION_QUEUE_ATTEMPTS;
    else process.env.DOCUMENT_ACTION_QUEUE_ATTEMPTS = ORIGINAL;
  });

  it('defaults to 3 attempts when unset', () => {
    delete process.env.DOCUMENT_ACTION_QUEUE_ATTEMPTS;
    expect(readDocumentActionQueueAttempts()).toBe(3);
    expect(DEFAULT_DOCUMENT_ACTION_QUEUE_ATTEMPTS).toBe(3);
  });

  it('reads an override from the environment', () => {
    process.env.DOCUMENT_ACTION_QUEUE_ATTEMPTS = '7';
    expect(readDocumentActionQueueAttempts()).toBe(7);
  });

  // Every one of these makes `attemptsMade + 1 < attempts` false on the FIRST failure, so the job is
  // abandoned rather than retried: `NaN` compares false against anything, and `0`/a negative number
  // are already below `attemptsMade + 1`. A malformed value must therefore never reach BullMQ.
  it.each([
    'three',
    '',
    'NaN',
    '0',
    '-1',
  ])('refuses %p and falls back to 3 attempts rather than silently disabling retries', (value) => {
    process.env.DOCUMENT_ACTION_QUEUE_ATTEMPTS = value;
    expect(readDocumentActionQueueAttempts()).toBe(3);
  });
});
