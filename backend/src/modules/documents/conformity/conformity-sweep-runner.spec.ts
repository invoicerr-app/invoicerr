/**
 * `ConformitySweepRunner` in isolation — the persistence layer (`authority-events.persistence.ts`)
 * is mocked wholesale (the same `jest.mock('./schedule.persistence')` discipline
 * `schedule-sweep-runner.spec.ts` already holds for its own persistence module); the real Postgres/
 * Redis proof (concurrent sweeps, a real eligible document) is
 * `queue/__tests__/document-conformity-queue.redis.spec.ts`'s job. `DocumentQueueDispatcher` is a
 * plain mocked object (`{ enqueueConformityPoll } as unknown as DocumentQueueDispatcher`), the exact
 * same pattern `schedule-sweep-runner.spec.ts` already uses for its own dispatcher dependency.
 */
import {
  createAuthorityEvents,
  findConformitySweepCandidates,
  journalSyntheticEvent,
} from './authority-events.persistence';
import {
  AuthorityStatusPoller,
  AuthorityStatusPollerRegistry,
  ChannelNotConnectedError,
} from './authority-status-poller';
import { BLOCKED_STATUS_CODE, GAVE_UP_STATUS_CODE } from './conformity-sweep';
import { ConformitySweepRunner } from './conformity-sweep-runner';
import { DocumentQueueDispatcher } from '../queue/document-queue.dispatcher';

jest.mock('./authority-events.persistence');

const mockedFindCandidates = findConformitySweepCandidates as jest.Mock;
const mockedCreateEvents = createAuthorityEvents as jest.Mock;
const mockedJournalSynthetic = journalSyntheticEvent as jest.Mock;

function buildPdpPoller(overrides: Partial<AuthorityStatusPoller> = {}): AuthorityStatusPoller {
  return {
    providerId: 'pdp',
    isTerminal: (code) => code === 'fr:202' || code === 'fr:213',
    poll: jest.fn(),
    ...overrides,
  };
}

describe('ConformitySweepRunner.runSweep', () => {
  let enqueueConformityPoll: jest.Mock;
  let dispatcher: DocumentQueueDispatcher;
  let registry: AuthorityStatusPollerRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    enqueueConformityPoll = jest.fn().mockResolvedValue(true);
    dispatcher = { enqueueConformityPoll } as unknown as DocumentQueueDispatcher;
    registry = new AuthorityStatusPollerRegistry();
    registry.register(buildPdpPoller());
  });

  it('dispatches ONE poll job for an eligible, non-terminal candidate', async () => {
    mockedFindCandidates.mockResolvedValue([
      {
        id: 'doc-1',
        companyId: 'company-1',
        transportRef: '123456',
        channelProviderId: 'pdp',
        updatedAt: new Date('2026-08-29T10:00:00Z'),
        existingStatusCodes: ['fr:200'],
      },
    ]);

    const runner = new ConformitySweepRunner(registry, dispatcher);
    const result = await runner.runSweep(new Date('2026-08-29T10:05:00Z'));

    expect(result).toEqual({ candidates: 1, polled: 1, gaveUp: 0 });
    expect(enqueueConformityPoll).toHaveBeenCalledTimes(1);
    const [, jobData] = enqueueConformityPoll.mock.calls[0];
    expect(jobData).toEqual({
      companyId: 'company-1',
      documentId: 'doc-1',
      providerId: 'pdp',
      transportRef: '123456',
    });
  });

  it('never dispatches a poll for a document already carrying a terminal verdict (fr:202)', async () => {
    mockedFindCandidates.mockResolvedValue([
      {
        id: 'doc-1',
        companyId: 'company-1',
        transportRef: '123456',
        channelProviderId: 'pdp',
        updatedAt: new Date('2026-08-29T10:00:00Z'),
        existingStatusCodes: ['fr:200', 'fr:201', 'fr:202'],
      },
    ]);

    const runner = new ConformitySweepRunner(registry, dispatcher);
    const result = await runner.runSweep(new Date('2026-08-29T10:05:00Z'));

    expect(result).toEqual({ candidates: 1, polled: 0, gaveUp: 0 });
    expect(enqueueConformityPoll).not.toHaveBeenCalled();
  });

  it('gives up (journals synthetically, never polls) once the max poll age is exceeded', async () => {
    process.env.DOCUMENT_CONFORMITY_MAX_POLL_AGE_MS = String(24 * 60 * 60 * 1000); // 1 day, for this test
    mockedFindCandidates.mockResolvedValue([
      {
        id: 'doc-1',
        companyId: 'company-1',
        transportRef: '123456',
        channelProviderId: 'pdp',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        existingStatusCodes: [],
      },
    ]);
    mockedJournalSynthetic.mockResolvedValue(1);

    const runner = new ConformitySweepRunner(registry, dispatcher);
    const result = await runner.runSweep(new Date('2026-08-10T00:00:00Z')); // 9 days later

    expect(result).toEqual({ candidates: 1, polled: 0, gaveUp: 1 });
    expect(mockedJournalSynthetic).toHaveBeenCalledWith(
      'company-1',
      'doc-1',
      'pdp',
      GAVE_UP_STATUS_CODE,
      expect.any(String),
      expect.any(Date),
    );
    expect(enqueueConformityPoll).not.toHaveBeenCalled();
    delete process.env.DOCUMENT_CONFORMITY_MAX_POLL_AGE_MS;
  });

  it('does not double-count "gave up" when the write itself was a dedup no-op (already journaled)', async () => {
    process.env.DOCUMENT_CONFORMITY_MAX_POLL_AGE_MS = String(24 * 60 * 60 * 1000);
    mockedFindCandidates.mockResolvedValue([
      {
        id: 'doc-1',
        companyId: 'company-1',
        transportRef: '123456',
        channelProviderId: 'pdp',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        existingStatusCodes: [],
      },
    ]);
    mockedJournalSynthetic.mockResolvedValue(0); // another pass already wrote it first

    const runner = new ConformitySweepRunner(registry, dispatcher);
    const result = await runner.runSweep(new Date('2026-08-10T00:00:00Z'));

    expect(result.gaveUp).toBe(0);
    delete process.env.DOCUMENT_CONFORMITY_MAX_POLL_AGE_MS;
  });

  it('skips a candidate silently if the registry no longer resolves its provider (defensive)', async () => {
    mockedFindCandidates.mockResolvedValue([
      {
        id: 'doc-1',
        companyId: 'company-1',
        transportRef: 'x',
        channelProviderId: 'unknown-provider',
        updatedAt: new Date(),
        existingStatusCodes: [],
      },
    ]);
    const runner = new ConformitySweepRunner(registry, dispatcher);
    await expect(runner.runSweep(new Date())).resolves.toEqual({ candidates: 1, polled: 0, gaveUp: 0 });
  });
});

describe('ConformitySweepRunner.runPoll', () => {
  const dispatcher = {} as DocumentQueueDispatcher; // runPoll never touches the queue dispatcher at all
  let registry: AuthorityStatusPollerRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new AuthorityStatusPollerRegistry();
  });

  it('journals every event the poller returns', async () => {
    const events = [
      { statusCode: 'fr:200', observedAt: new Date() },
      { statusCode: 'fr:202', observedAt: new Date() },
    ];
    registry.register(buildPdpPoller({ poll: jest.fn().mockResolvedValue(events) }));
    mockedCreateEvents.mockResolvedValue(2);

    const runner = new ConformitySweepRunner(registry, dispatcher);
    const result = await runner.runPoll({
      companyId: 'company-1',
      documentId: 'doc-1',
      providerId: 'pdp',
      transportRef: '123456',
    });

    expect(result).toEqual({ journaled: 2 });
    expect(mockedCreateEvents).toHaveBeenCalledWith('company-1', 'doc-1', 'pdp', events);
  });

  it('journals poll:blocked (never throws) when the channel has no connected credentials', async () => {
    registry.register(
      buildPdpPoller({ poll: jest.fn().mockRejectedValue(new ChannelNotConnectedError('pdp')) }),
    );
    mockedJournalSynthetic.mockResolvedValue(1);

    const runner = new ConformitySweepRunner(registry, dispatcher);
    await expect(
      runner.runPoll({ companyId: 'company-1', documentId: 'doc-1', providerId: 'pdp', transportRef: 'x' }),
    ).resolves.toEqual({ journaled: 1 });

    expect(mockedJournalSynthetic).toHaveBeenCalledWith(
      'company-1',
      'doc-1',
      'pdp',
      BLOCKED_STATUS_CODE,
      expect.stringContaining('not connected'),
    );
  });

  it('NEVER THROWS even for a totally unexpected failure (network error, malformed response, …)', async () => {
    registry.register(buildPdpPoller({ poll: jest.fn().mockRejectedValue(new Error('ECONNRESET')) }));
    mockedJournalSynthetic.mockResolvedValue(1);

    const runner = new ConformitySweepRunner(registry, dispatcher);
    // The assertion itself IS the proof: a throwing runPoll would reject this promise and fail the
    // test at `await`, never reach the `resolves` matcher below.
    await expect(
      runner.runPoll({ companyId: 'company-1', documentId: 'doc-1', providerId: 'pdp', transportRef: 'x' }),
    ).resolves.toEqual({ journaled: 1 });
    expect(mockedJournalSynthetic).toHaveBeenCalledWith(
      'company-1',
      'doc-1',
      'pdp',
      BLOCKED_STATUS_CODE,
      'ECONNRESET',
    );
  });

  it('no-ops (never throws) for a provider the registry does not resolve', async () => {
    const runner = new ConformitySweepRunner(registry, dispatcher);
    await expect(
      runner.runPoll({ companyId: 'c', documentId: 'd', providerId: 'sdi', transportRef: 'x' }),
    ).resolves.toEqual({ journaled: 0 });
  });

  // BELT AND SUSPENDERS — found by this task's own mutation testing (mutation #2): the compensating
  // 'poll:blocked' write is not itself guaranteed to succeed (a real DB outage, or — as mutation
  // testing actually demonstrated live — a broken dedup colliding with a PREVIOUS 'poll:blocked' row
  // for the same document). `runPoll` must survive that too, never propagate it.
  it('NEVER THROWS even when journaling poll:blocked itself fails', async () => {
    const poller = buildPdpPoller({ poll: jest.fn().mockRejectedValue(new Error('ECONNRESET')) });
    registry.register(poller);
    mockedJournalSynthetic.mockRejectedValue(new Error('db unreachable'));

    const runner = new ConformitySweepRunner(registry, dispatcher);
    await expect(
      runner.runPoll({ companyId: 'company-1', documentId: 'doc-1', providerId: 'pdp', transportRef: 'x' }),
    ).resolves.toEqual({ journaled: 0 });
  });
});
