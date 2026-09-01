/**
 * `createAuthorityEvents`'s own dedup contract, proven against a STATEFUL fake `createMany` that
 * mimics Postgres's own `@@unique([documentId, providerId, statusCode])` + `skipDuplicates` behavior
 * (a real unique-constraint round trip is `queue/__tests__/document-conformity-queue.redis.spec.ts`'s
 * job — this file proves the FUNCTION builds the right call and reads the right count back, not that
 * Postgres itself enforces uniqueness). `findConformitySweepCandidates`'s own eligibility mapping is
 * proven against a plain mocked `findMany`.
 */
import prisma from '@/prisma/prisma.service';

import { RawAuthorityEvent } from './authority-status-poller';
import {
  createAuthorityEvents,
  findConformitySweepCandidates,
  journalSyntheticEvent,
  listAuthorityEvents,
} from './authority-events.persistence';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    documentAuthorityEvent: { createMany: jest.fn(), findMany: jest.fn() },
    documentInstance: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  documentAuthorityEvent: { createMany: jest.Mock; findMany: jest.Mock };
  documentInstance: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
};

/** A tiny in-memory stand-in for Postgres's own `@@unique([documentId, providerId, statusCode])` +
 *  `skipDuplicates: true` — real enough to prove "poll the same events twice -> 0 new the second
 *  time" without a real database. */
function statefulCreateManyMock() {
  const seen = new Set<string>();
  return jest.fn((args: { data: { documentId: string; providerId: string; statusCode: string }[] }) => {
    let count = 0;
    for (const row of args.data) {
      const key = `${row.documentId}|${row.providerId}|${row.statusCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      count++;
    }
    return Promise.resolve({ count });
  });
}

describe('createAuthorityEvents — dedup', () => {
  beforeEach(() => jest.clearAllMocks());

  const events: RawAuthorityEvent[] = [
    { statusCode: 'fr:200', statusText: 'Déposée (validée)', observedAt: new Date('2026-08-29T10:00:00Z') },
    {
      statusCode: 'fr:201',
      statusText: 'Émise par la plateforme',
      observedAt: new Date('2026-08-29T10:00:01Z'),
    },
    {
      statusCode: 'fr:202',
      statusText: 'Reçue par la plateforme',
      observedAt: new Date('2026-08-29T10:00:02Z'),
    },
  ];

  it('journals every NEW event the first time', async () => {
    mockedPrisma.documentAuthorityEvent.createMany.mockImplementation(statefulCreateManyMock());
    const count = await createAuthorityEvents('company-1', 'doc-1', 'pdp', events);
    expect(count).toBe(3);
  });

  it('re-polling the EXACT SAME events journals ZERO new rows the second time', async () => {
    const fake = statefulCreateManyMock();
    mockedPrisma.documentAuthorityEvent.createMany.mockImplementation(fake);

    const first = await createAuthorityEvents('company-1', 'doc-1', 'pdp', events);
    const second = await createAuthorityEvents('company-1', 'doc-1', 'pdp', events);

    expect(first).toBe(3);
    expect(second).toBe(0); // THIS is the dedup guarantee this task's own tests must prove
  });

  it('passes skipDuplicates: true — the actual mechanism the unique index relies on', async () => {
    mockedPrisma.documentAuthorityEvent.createMany.mockResolvedValue({ count: 1 });
    await createAuthorityEvents('company-1', 'doc-1', 'pdp', [events[0]]);
    expect(mockedPrisma.documentAuthorityEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('is a no-op (never calls Prisma) for an empty event list', async () => {
    const count = await createAuthorityEvents('company-1', 'doc-1', 'pdp', []);
    expect(count).toBe(0);
    expect(mockedPrisma.documentAuthorityEvent.createMany).not.toHaveBeenCalled();
  });

  it('journalSyntheticEvent writes exactly one event, once — a second call for the SAME code dedups', async () => {
    const fake = statefulCreateManyMock();
    mockedPrisma.documentAuthorityEvent.createMany.mockImplementation(fake);

    const first = await journalSyntheticEvent('company-1', 'doc-1', 'pdp', 'poll:gave-up', 'too old');
    const second = await journalSyntheticEvent(
      'company-1',
      'doc-1',
      'pdp',
      'poll:gave-up',
      'too old (again)',
    );

    expect(first).toBe(1);
    expect(second).toBe(0); // "journalisé une seule fois" — proven here, not merely asserted
  });
});

describe('listAuthorityEvents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads every event for (companyId, documentId), most recent first', async () => {
    mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([{ id: 'evt-1' }]);
    const result = await listAuthorityEvents('company-1', 'doc-1');
    expect(result).toEqual([{ id: 'evt-1' }]);
    expect(mockedPrisma.documentAuthorityEvent.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', documentId: 'doc-1' },
      orderBy: { observedAt: 'desc' },
    });
  });
});

describe('findConformitySweepCandidates — eligibility', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns nothing at all when no provider is pollable (never even queries)', async () => {
    const result = await findConformitySweepCandidates([]);
    expect(result).toEqual([]);
    expect(mockedPrisma.documentInstance.findMany).not.toHaveBeenCalled();
  });

  it('filters on status "sent", a non-null transportRef, and a pollable channelProviderId', async () => {
    mockedPrisma.documentInstance.findMany.mockResolvedValue([]);
    await findConformitySweepCandidates(['pdp', 'ksef']);
    expect(mockedPrisma.documentInstance.findMany).toHaveBeenCalledWith({
      where: {
        status: 'sent',
        transportRef: { not: null },
        channelProviderId: { in: ['pdp', 'ksef'] },
      },
      include: { authorityEvents: { select: { statusCode: true } } },
    });
  });

  it("maps a row's own authorityEvents relation down to a flat statusCode list", async () => {
    mockedPrisma.documentInstance.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        companyId: 'company-1',
        transportRef: '123456',
        channelProviderId: 'pdp',
        updatedAt: new Date('2026-08-29T10:00:00Z'),
        authorityEvents: [{ statusCode: 'fr:200' }, { statusCode: 'fr:201' }],
      },
    ]);
    const result = await findConformitySweepCandidates(['pdp']);
    expect(result).toEqual([
      {
        id: 'doc-1',
        companyId: 'company-1',
        transportRef: '123456',
        channelProviderId: 'pdp',
        updatedAt: new Date('2026-08-29T10:00:00Z'),
        existingStatusCodes: ['fr:200', 'fr:201'],
      },
    ]);
  });

  // "email = non" (this task's own eligibility test): a document sent by email has
  // `channelProviderId: null`, which the WHERE clause's `{ in: pollableProviderIds }` can never match
  // — proven here by asserting the QUERY the Prisma layer is asked to run, since a mocked `findMany`
  // cannot itself demonstrate what Postgres would filter out; the real filtering behavior is exactly
  // what `queue/__tests__/document-conformity-queue.redis.spec.ts` proves against a real database.
  it('the query itself can never match a null channelProviderId (the "sent by email" case)', async () => {
    mockedPrisma.documentInstance.findMany.mockResolvedValue([]);
    await findConformitySweepCandidates(['pdp']);
    const where = mockedPrisma.documentInstance.findMany.mock.calls[0][0].where;
    expect(where.channelProviderId).toEqual({ in: ['pdp'] });
    // `null` structurally cannot appear in a list of provider id strings — an "email" document
    // (channelProviderId: null) is therefore excluded by construction, not by a runtime check this
    // test could otherwise assert away by mistake.
    expect(where.channelProviderId.in as unknown[]).not.toContain(null);
  });
});

// THE DEDICATED TEST this task's own brief requires: "le statut lifecycle ne bouge JAMAIS" — proven
// structurally, at the exact point a mutation could sneak one in, rather than merely asserted in
// prose. `DocumentInstance.status` is written ONLY through `../persistence.ts` (upsertDocument /
// updateDocumentStatus) — neither of which this file, nor any function it calls, ever imports or
// invokes. `createAuthorityEvents` and `journalSyntheticEvent` — this journal's ONLY two writers —
// touch `documentAuthorityEvent` alone; if either were ever changed to also flip a document's status
// (e.g. "helpfully" marking a rejected deposit as `send_failed`), THIS assertion fails immediately.
describe('the document lifecycle status never moves because of a conformity write', () => {
  beforeEach(() => jest.clearAllMocks());

  it('journaling a REJECTION (fr:213) never touches DocumentInstance at all', async () => {
    mockedPrisma.documentAuthorityEvent.createMany.mockResolvedValue({ count: 1 });
    await createAuthorityEvents('company-1', 'doc-1', 'pdp', [
      { statusCode: 'fr:213', statusText: 'Rejetée', reason: 'BT-23 absent', observedAt: new Date() },
    ]);
    expect(mockedPrisma.documentInstance.update).not.toHaveBeenCalled();
    expect(mockedPrisma.documentInstance.updateMany).not.toHaveBeenCalled();
  });

  it('journaling a synthetic poll:gave-up never touches DocumentInstance either', async () => {
    mockedPrisma.documentAuthorityEvent.createMany.mockResolvedValue({ count: 1 });
    await journalSyntheticEvent('company-1', 'doc-1', 'pdp', 'poll:gave-up', 'too old');
    expect(mockedPrisma.documentInstance.update).not.toHaveBeenCalled();
    expect(mockedPrisma.documentInstance.updateMany).not.toHaveBeenCalled();
  });
});
