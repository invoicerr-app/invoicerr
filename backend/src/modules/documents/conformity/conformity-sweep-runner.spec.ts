/**
 * `ConformitySweepRunner` in isolation — the persistence layer (`authority-events.persistence.ts`)
 * is mocked wholesale (the same `jest.mock('./schedule.persistence')` discipline
 * `schedule-sweep-runner.spec.ts` already holds for its own persistence module); the real Postgres/
 * Redis proof (concurrent sweeps, a real eligible document) is
 * `queue/__tests__/document-conformity-queue.redis.spec.ts`'s job. `DocumentQueueDispatcher` is a
 * plain mocked object (`{ enqueueConformityPoll } as unknown as DocumentQueueDispatcher`), the exact
 * same pattern `schedule-sweep-runner.spec.ts` already uses for its own dispatcher dependency.
 *
 * `../persistence` (TODO_PRODUIT.md T2bis) is ALSO mocked wholesale, ONLY for the "webhooks" describe
 * block below: `dispatchDocumentAuthorityEventWebhook` (`queue/document-authority-webhook.ts`) fetches
 * the row via `findOwnedDocument` before dispatching `DOCUMENT_AUTHORITY_EVENT` — every test ABOVE
 * that block never configures a `webhookDispatcher` at all, so that fetch never runs for them.
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
import * as persistence from '../persistence';
import { DocumentEventsPublisher } from '../queue/document-events-publisher';
import { DocumentQueueDispatcher } from '../queue/document-queue.dispatcher';

jest.mock('./authority-events.persistence');
jest.mock('../persistence');

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

// TODO_PRODUIT.md T1 / PLAN-V2 R8 — the worker→API SSE bridge. `eventsPublisher` is OPTIONAL (see
// `ConformitySweepRunner`'s own constructor header) — every test ABOVE this block constructs the
// runner with two args and must keep passing unchanged; these are the DEDICATED tests for the publish
// behavior: publish only on a GENUINELY NEW journal row, never on a dedup no-op, and only when the job
// data actually carries a typeId.
describe('ConformitySweepRunner — events (TODO_PRODUIT.md T1 / PLAN-V2 R8)', () => {
  let dispatcher: DocumentQueueDispatcher;
  let registry: AuthorityStatusPollerRegistry;
  let events: { publish: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    dispatcher = {
      enqueueConformityPoll: jest.fn().mockResolvedValue(true),
    } as unknown as DocumentQueueDispatcher;
    // NO default poller registered here, deliberately: the `runPoll` tests below each register their
    // OWN poller (a specific `poll` mock per scenario) — registering one here too would collide with
    // `AuthorityStatusPollerRegistry.register`'s own "already registered" guard the moment they do.
    // The `runSweep` tests register the plain `buildPdpPoller()` themselves, right where they need it.
    registry = new AuthorityStatusPollerRegistry();
    events = { publish: jest.fn().mockResolvedValue(undefined) };
  });

  it('runSweep: publishes an authority-event nudge when a candidate genuinely gives up', async () => {
    registry.register(buildPdpPoller());
    process.env.DOCUMENT_CONFORMITY_MAX_POLL_AGE_MS = String(24 * 60 * 60 * 1000);
    mockedFindCandidates.mockResolvedValue([
      {
        id: 'doc-1',
        companyId: 'company-1',
        typeId: 'invoice',
        transportRef: '123456',
        channelProviderId: 'pdp',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        existingStatusCodes: [],
      },
    ]);
    mockedJournalSynthetic.mockResolvedValue(1);

    const runner = new ConformitySweepRunner(
      registry,
      dispatcher,
      events as unknown as DocumentEventsPublisher,
    );
    await runner.runSweep(new Date('2026-08-10T00:00:00Z'));

    expect(events.publish).toHaveBeenCalledWith('company-1', {
      documentId: 'doc-1',
      typeId: 'invoice',
      kind: 'authority-event',
    });
    delete process.env.DOCUMENT_CONFORMITY_MAX_POLL_AGE_MS;
  });

  it('runSweep: never publishes when giving up was a dedup no-op (already journaled by another pass)', async () => {
    registry.register(buildPdpPoller());
    process.env.DOCUMENT_CONFORMITY_MAX_POLL_AGE_MS = String(24 * 60 * 60 * 1000);
    mockedFindCandidates.mockResolvedValue([
      {
        id: 'doc-1',
        companyId: 'company-1',
        typeId: 'invoice',
        transportRef: '123456',
        channelProviderId: 'pdp',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        existingStatusCodes: [],
      },
    ]);
    mockedJournalSynthetic.mockResolvedValue(0);

    const runner = new ConformitySweepRunner(
      registry,
      dispatcher,
      events as unknown as DocumentEventsPublisher,
    );
    await runner.runSweep(new Date('2026-08-10T00:00:00Z'));

    expect(events.publish).not.toHaveBeenCalled();
    delete process.env.DOCUMENT_CONFORMITY_MAX_POLL_AGE_MS;
  });

  it("runSweep: threads the candidate's own typeId into the enqueued poll job", async () => {
    registry.register(buildPdpPoller());
    mockedFindCandidates.mockResolvedValue([
      {
        id: 'doc-1',
        companyId: 'company-1',
        typeId: 'invoice',
        transportRef: '123456',
        channelProviderId: 'pdp',
        updatedAt: new Date('2026-08-29T10:00:00Z'),
        existingStatusCodes: ['fr:200'],
      },
    ]);
    const enqueueConformityPoll = jest.fn().mockResolvedValue(true);
    dispatcher = { enqueueConformityPoll } as unknown as DocumentQueueDispatcher;

    const runner = new ConformitySweepRunner(
      registry,
      dispatcher,
      events as unknown as DocumentEventsPublisher,
    );
    await runner.runSweep(new Date('2026-08-29T10:05:00Z'));

    const [, jobData] = enqueueConformityPoll.mock.calls[0];
    expect(jobData).toEqual({
      companyId: 'company-1',
      documentId: 'doc-1',
      providerId: 'pdp',
      transportRef: '123456',
      typeId: 'invoice',
    });
  });

  it('runPoll: publishes an authority-event nudge when new events are genuinely journaled', async () => {
    const pollEvents = [{ statusCode: 'fr:200', observedAt: new Date() }];
    registry.register(buildPdpPoller({ poll: jest.fn().mockResolvedValue(pollEvents) }));
    mockedCreateEvents.mockResolvedValue(1);

    const runner = new ConformitySweepRunner(
      registry,
      dispatcher,
      events as unknown as DocumentEventsPublisher,
    );
    await runner.runPoll({
      companyId: 'company-1',
      documentId: 'doc-1',
      providerId: 'pdp',
      transportRef: '123456',
      typeId: 'invoice',
    });

    expect(events.publish).toHaveBeenCalledWith('company-1', {
      documentId: 'doc-1',
      typeId: 'invoice',
      kind: 'authority-event',
    });
  });

  it('runPoll: never publishes when nothing new was journaled (a re-poll rediscovering known events)', async () => {
    registry.register(
      buildPdpPoller({
        poll: jest.fn().mockResolvedValue([{ statusCode: 'fr:200', observedAt: new Date() }]),
      }),
    );
    mockedCreateEvents.mockResolvedValue(0);

    const runner = new ConformitySweepRunner(
      registry,
      dispatcher,
      events as unknown as DocumentEventsPublisher,
    );
    await runner.runPoll({
      companyId: 'company-1',
      documentId: 'doc-1',
      providerId: 'pdp',
      transportRef: '123456',
      typeId: 'invoice',
    });

    expect(events.publish).not.toHaveBeenCalled();
  });

  it('runPoll: never publishes when the job data carries no typeId (nothing to invalidate a query for)', async () => {
    registry.register(
      buildPdpPoller({
        poll: jest.fn().mockResolvedValue([{ statusCode: 'fr:200', observedAt: new Date() }]),
      }),
    );
    mockedCreateEvents.mockResolvedValue(1);

    const runner = new ConformitySweepRunner(
      registry,
      dispatcher,
      events as unknown as DocumentEventsPublisher,
    );
    await runner.runPoll({
      companyId: 'company-1',
      documentId: 'doc-1',
      providerId: 'pdp',
      transportRef: '123456',
    });

    expect(events.publish).not.toHaveBeenCalled();
  });

  it('runPoll: publishes on a NEWLY-journaled poll:blocked verdict too', async () => {
    registry.register(
      buildPdpPoller({ poll: jest.fn().mockRejectedValue(new ChannelNotConnectedError('pdp')) }),
    );
    mockedJournalSynthetic.mockResolvedValue(1);

    const runner = new ConformitySweepRunner(
      registry,
      dispatcher,
      events as unknown as DocumentEventsPublisher,
    );
    await runner.runPoll({
      companyId: 'company-1',
      documentId: 'doc-1',
      providerId: 'pdp',
      transportRef: 'x',
      typeId: 'invoice',
    });

    expect(events.publish).toHaveBeenCalledWith('company-1', {
      documentId: 'doc-1',
      typeId: 'invoice',
      kind: 'authority-event',
    });
  });

  it('never touches events at all when absent — every pre-existing caller keeps working unchanged', async () => {
    mockedFindCandidates.mockResolvedValue([]);
    const runner = new ConformitySweepRunner(registry, dispatcher); // no eventsPublisher
    await expect(runner.runSweep(new Date())).resolves.toEqual({ candidates: 0, polled: 0, gaveUp: 0 });
  });
});

// TODO_PRODUIT.md T2bis — `DOCUMENT_AUTHORITY_EVENT`, dispatched via `dispatchDocumentAuthorityEventWebhook`
// at the SAME "genuinely new row" gates the "events" describe block above already proves for the SSE
// nudge. `webhookDispatcher` is this runner's 4th constructor arg (a PLAIN class provider — unlike
// `ReportingRunner`, Nest's own reflection-based DI resolves this with no factory pitfall, see that
// class's own header) — every test ABOVE this block omits it and must keep passing unchanged.
describe('ConformitySweepRunner — webhooks (TODO_PRODUIT.md T2bis)', () => {
  let dispatcher: DocumentQueueDispatcher;
  let registry: AuthorityStatusPollerRegistry;
  const mockedFindOwnedDocument = persistence.findOwnedDocument as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    dispatcher = {
      enqueueConformityPoll: jest.fn().mockResolvedValue(true),
    } as unknown as DocumentQueueDispatcher;
    registry = new AuthorityStatusPollerRegistry();
    mockedFindOwnedDocument.mockResolvedValue({ id: 'doc-1', typeId: 'invoice', status: 'sent' });
  });

  it('runSweep: dispatches DOCUMENT_AUTHORITY_EVENT (GAVE_UP_STATUS_CODE) when a candidate genuinely gives up', async () => {
    registry.register(buildPdpPoller());
    process.env.DOCUMENT_CONFORMITY_MAX_POLL_AGE_MS = String(24 * 60 * 60 * 1000);
    mockedFindCandidates.mockResolvedValue([
      {
        id: 'doc-1',
        companyId: 'company-1',
        typeId: 'invoice',
        transportRef: '123456',
        channelProviderId: 'pdp',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        existingStatusCodes: [],
      },
    ]);
    mockedJournalSynthetic.mockResolvedValue(1);
    const webhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };

    const runner = new ConformitySweepRunner(registry, dispatcher, undefined, webhooks);
    await runner.runSweep(new Date('2026-08-10T00:00:00Z'));

    expect(webhooks.dispatch).toHaveBeenCalledWith('DOCUMENT_AUTHORITY_EVENT', {
      documentId: 'doc-1',
      typeId: 'invoice',
      companyId: 'company-1',
      occurredAt: expect.any(String),
      document: { id: 'doc-1', typeId: 'invoice', status: 'sent' },
      providerId: 'pdp',
      statusCode: GAVE_UP_STATUS_CODE,
    });
  });

  it('runPoll: dispatches DOCUMENT_AUTHORITY_EVENT with the MOST RECENT observed statusCode', async () => {
    const pollEvents = [
      { statusCode: 'fr:200', observedAt: new Date('2026-08-10T00:00:00Z') },
      { statusCode: 'fr:202', observedAt: new Date('2026-08-10T00:05:00Z') },
    ];
    registry.register(buildPdpPoller({ poll: jest.fn().mockResolvedValue(pollEvents) }));
    mockedCreateEvents.mockResolvedValue(2);
    const webhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };

    const runner = new ConformitySweepRunner(registry, dispatcher, undefined, webhooks);
    await runner.runPoll({
      companyId: 'company-1',
      documentId: 'doc-1',
      providerId: 'pdp',
      transportRef: '123456',
      typeId: 'invoice',
    });

    expect(webhooks.dispatch).toHaveBeenCalledWith(
      'DOCUMENT_AUTHORITY_EVENT',
      expect.objectContaining({ providerId: 'pdp', statusCode: 'fr:202' }),
    );
  });

  it('runPoll: never dispatches when nothing new was journaled (a re-poll rediscovering known events)', async () => {
    registry.register(
      buildPdpPoller({
        poll: jest.fn().mockResolvedValue([{ statusCode: 'fr:200', observedAt: new Date() }]),
      }),
    );
    mockedCreateEvents.mockResolvedValue(0);
    const webhooks = { dispatch: jest.fn() };

    const runner = new ConformitySweepRunner(registry, dispatcher, undefined, webhooks);
    await runner.runPoll({
      companyId: 'company-1',
      documentId: 'doc-1',
      providerId: 'pdp',
      transportRef: '123456',
      typeId: 'invoice',
    });

    expect(webhooks.dispatch).not.toHaveBeenCalled();
  });

  // THE MUTATION TARGET this task's own brief names: a dead webhook endpoint must never look like the
  // poll itself failed.
  it('a dispatch failure NEVER propagates — runPoll still returns normally', async () => {
    registry.register(
      buildPdpPoller({
        poll: jest.fn().mockResolvedValue([{ statusCode: 'fr:200', observedAt: new Date() }]),
      }),
    );
    mockedCreateEvents.mockResolvedValue(1);
    const webhooks = { dispatch: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };

    const runner = new ConformitySweepRunner(registry, dispatcher, undefined, webhooks);
    await expect(
      runner.runPoll({
        companyId: 'company-1',
        documentId: 'doc-1',
        providerId: 'pdp',
        transportRef: '123456',
        typeId: 'invoice',
      }),
    ).resolves.toEqual({ journaled: 1 });
  });

  it('never touches webhookDispatcher at all when absent — every pre-existing caller keeps working unchanged', async () => {
    mockedFindCandidates.mockResolvedValue([]);
    const runner = new ConformitySweepRunner(registry, dispatcher); // no webhookDispatcher
    await expect(runner.runSweep(new Date())).resolves.toEqual({ candidates: 0, polled: 0, gaveUp: 0 });
  });
});
