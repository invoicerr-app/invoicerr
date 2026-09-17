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
  findDocumentByTransportRef,
  findOwnedDocumentByTransportRef,
  journalSyntheticEvent,
  listAuthorityEvents,
  markConformityResolved,
} from './authority-events.persistence';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    documentAuthorityEvent: { createMany: jest.fn(), findMany: jest.fn() },
    documentInstance: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  documentAuthorityEvent: { createMany: jest.Mock; findMany: jest.Mock };
  documentInstance: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
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
    expect(second).toBe(0); // THIS is the dedup guarantee
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
    expect(second).toBe(0); // "journaled only once" — proven here, not merely asserted
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

  it('filters on status "sent", a non-null transportRef, a pollable channelProviderId, and NOT YET resolved', async () => {
    mockedPrisma.documentInstance.findMany.mockResolvedValue([]);
    await findConformitySweepCandidates(['pdp', 'ksef']);
    expect(mockedPrisma.documentInstance.findMany).toHaveBeenCalledWith({
      where: {
        status: 'sent',
        transportRef: { not: null },
        channelProviderId: { in: ['pdp', 'ksef'] },
        conformityResolvedAt: null,
      },
      orderBy: { updatedAt: 'asc' },
      take: expect.any(Number),
      include: { authorityEvents: { select: { statusCode: true } } },
    });
  });

  // The fix for "chargeant toutes les factures... sans borne" — a resolved document must never be
  // fetched again, and even the unresolved set is bounded by an explicit `take`.
  it('defaults `take` to the configured sweep batch size, and honors an explicit override', async () => {
    const originalEnv = process.env.DOCUMENT_CONFORMITY_SWEEP_BATCH_SIZE;
    try {
      process.env.DOCUMENT_CONFORMITY_SWEEP_BATCH_SIZE = '250';
      mockedPrisma.documentInstance.findMany.mockResolvedValue([]);
      await findConformitySweepCandidates(['pdp']);
      expect(mockedPrisma.documentInstance.findMany.mock.calls[0][0].take).toBe(250);

      await findConformitySweepCandidates(['pdp'], 7);
      expect(mockedPrisma.documentInstance.findMany.mock.calls[1][0].take).toBe(7);
    } finally {
      process.env.DOCUMENT_CONFORMITY_SWEEP_BATCH_SIZE = originalEnv;
    }
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

  // "email = non": a document sent by email has
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

// "the lifecycle status NEVER moves" — proven
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

describe('markConformityResolved', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes conformityResolvedAt on the named document, by id', async () => {
    const resolvedAt = new Date('2026-09-17T00:00:00Z');
    await markConformityResolved('doc-1', resolvedAt);
    expect(mockedPrisma.documentInstance.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { conformityResolvedAt: resolvedAt },
    });
  });

  it('defaults to "now" when no timestamp is given', async () => {
    await markConformityResolved('doc-1');
    const call = mockedPrisma.documentInstance.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'doc-1' });
    expect(call.data.conformityResolvedAt).toBeInstanceOf(Date);
  });
});

describe("findDocumentByTransportRef — CROSS-TENANT by construction, for SdI's own SOAP push", () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves by (channelProviderId, transportRef) ALONE — no companyId in the WHERE clause at all', async () => {
    mockedPrisma.documentInstance.findFirst.mockResolvedValue({
      id: 'doc-1',
      companyId: 'company-1',
      typeId: 'invoice',
    });

    await findDocumentByTransportRef('sdi', 'IT01234567890_00001.xml');

    expect(mockedPrisma.documentInstance.findFirst).toHaveBeenCalledWith({
      where: { channelProviderId: 'sdi', transportRef: 'IT01234567890_00001.xml' },
      select: { id: true, companyId: true, typeId: true },
    });
  });

  it('null for an unknown ref — never throws', async () => {
    mockedPrisma.documentInstance.findFirst.mockResolvedValue(null);
    await expect(findDocumentByTransportRef('sdi', 'unknown')).resolves.toBeNull();
  });
});

// THE MUTATION TARGET: `pec-notifiche.service.ts` used to call `findDocumentByTransportRef` — the
// CROSS-TENANT variant above — even though it already knows exactly which company's own mailbox it
// is draining. This is the scoped sibling that closes that gap.
describe('findOwnedDocumentByTransportRef — scoped by companyId, for a caller that already knows it', () => {
  beforeEach(() => jest.clearAllMocks());

  it('includes companyId in the WHERE clause alongside channelProviderId/transportRef', async () => {
    mockedPrisma.documentInstance.findFirst.mockResolvedValue({
      id: 'doc-1',
      companyId: 'company-1',
      typeId: 'invoice',
    });

    await findOwnedDocumentByTransportRef('company-1', 'sdi-pec', 'IT01234567890_00001.xml');

    expect(mockedPrisma.documentInstance.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        channelProviderId: 'sdi-pec',
        transportRef: 'IT01234567890_00001.xml',
      },
      select: { id: true, companyId: true, typeId: true },
    });
  });

  it('null when a document with this ref exists but belongs to a DIFFERENT company — never leaks it as a match', async () => {
    // A real Prisma call scoped by `companyId` in its own WHERE clause would simply find no row for
    // "company-2" when the only matching row belongs to "company-1" — modeled here by the mock
    // returning null, the same shape a real cross-tenant miss would produce.
    mockedPrisma.documentInstance.findFirst.mockResolvedValue(null);

    const result = await findOwnedDocumentByTransportRef('company-2', 'sdi-pec', 'IT01234567890_00001.xml');

    expect(result).toBeNull();
    expect(mockedPrisma.documentInstance.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'company-2',
        channelProviderId: 'sdi-pec',
        transportRef: 'IT01234567890_00001.xml',
      },
      select: { id: true, companyId: true, typeId: true },
    });
  });
});
