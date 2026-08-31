import { DocumentQueueDispatcher } from './document-queue.dispatcher';
import { DocumentActionJobData } from './queue.constants';

/**
 * `DocumentQueueDispatcher` against a FAKE `Queue` (no BullMQ, no Redis) — proves the idempotent
 * "clear a terminal job before re-adding" logic and the deterministic jobId this class is actually
 * responsible for, without a broker. The real enqueue -> consume round trip is
 * queue/__tests__/document-action-queue.redis.spec.ts (gated on REDIS_URL).
 */
function fakeQueue() {
  return {
    getJob: jest.fn(),
    add: jest.fn().mockResolvedValue(undefined),
  };
}

const INPUT: DocumentActionJobData = {
  companyId: 'company-1',
  typeId: 'quote',
  documentId: 'doc-1',
  actionId: 'send',
  payload: { data: {}, params: {} },
};

describe('DocumentQueueDispatcher.enqueueAction', () => {
  afterEach(() => jest.resetAllMocks());

  it('adds the job under its deterministic jobId when nothing exists under it yet', async () => {
    const queue = fakeQueue();
    queue.getJob.mockResolvedValue(undefined);
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    await dispatcher.enqueueAction(INPUT);

    expect(queue.add).toHaveBeenCalledWith(
      'run',
      INPUT,
      expect.objectContaining({ jobId: 'send-quote-doc-1' }),
    );
  });

  it.each([
    'completed',
    'failed',
  ])('clears a TERMINAL (%s) job under the same id before adding a fresh one', async (state) => {
    const queue = fakeQueue();
    const existing = { getState: jest.fn().mockResolvedValue(state), remove: jest.fn() };
    queue.getJob.mockResolvedValue(existing);
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    await dispatcher.enqueueAction(INPUT);

    expect(existing.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });

  it.each([
    'waiting',
    'active',
    'delayed',
  ])('leaves a still IN-FLIGHT (%s) job alone — never enqueues a duplicate', async (state) => {
    const queue = fakeQueue();
    const existing = { getState: jest.fn().mockResolvedValue(state), remove: jest.fn() };
    queue.getJob.mockResolvedValue(existing);
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    await dispatcher.enqueueAction(INPUT);

    expect(existing.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
