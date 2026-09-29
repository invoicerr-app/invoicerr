/**
 * #478: two saves of the same client's contacts at the same moment. Real Postgres, real concurrent
 * transactions on separate pool connections, never a mock: the bug lived in how two transactions
 * interleave against the partial unique index `ClientContact_clientId_primary_key`, which only a real
 * database can show.
 *
 * The chosen behaviour is last-writer-wins (see `writeClientContacts`'s own header for why, not a
 * 409): both saves succeed, the second one to commit is what the client ends up with, and it ends up
 * with it WHOLE (its address and its contacts, never one writer's address beside the other's
 * contacts), with exactly one primary.
 *
 * Neither test relies on timing luck to get the two writes to overlap. Each one parks a transaction
 * on purpose and waits until Postgres itself reports the other writer blocked on a lock
 * (`pg_stat_activity.wait_event_type = 'Lock'`), which is the proof that both writes were in flight
 * at the same time, before letting the first one commit.
 */
import { vi } from 'vitest';

vi.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: vi.fn(),
}));

import { ClientsService } from './clients.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { VatValidationPort } from '../documents/tax/vat-validation';
import { writeClientContacts } from './contacts/client-contacts';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: vi.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

const fakeVatValidator = { validate: vi.fn() } as unknown as VatValidationPort;

// Generous: a parked transaction must outlive Prisma's 5 s interactive-transaction default while the
// test waits for the other writer to block.
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 'fulfilled', or the rejection's own message, so a failure names the database error instead of
 *  just "rejected". */
function outcome(result: PromiseSettledResult<unknown>): string {
  return result.status === 'fulfilled'
    ? 'fulfilled'
    : String((result.reason as Error)?.message ?? result.reason);
}

/** Resolves once at least `count` sessions of THIS database are blocked on a lock while running a
 *  statement that touches `Client`/`ClientContact`. Fails the test after 10 s rather than hanging. */
async function waitForLockWaiters(count: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%"Client%'`;
    if (Number(rows[0].n) >= count) return;
    if (Date.now() > deadline) throw new Error(`expected ${count} lock waiter(s), saw ${rows[0].n}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('ClientsService - concurrent contact saves (#478)', () => {
  let companyId: string;
  let service: ClientsService;

  const base = {
    postalCode: '10000',
    city: 'Paris',
    country: 'France',
    currency: 'EUR',
    isActive: true,
  };

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Concurrent Contacts Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000478',
        email: `contacts-478-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;
    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('writeClientContacts: a second writer arriving while the first is uncommitted waits, then wins', async () => {
    const client = await service.createClient(companyId, {
      name: 'Interleaved Writers SARL',
      address: 'Start',
      ...base,
      contacts: [{ firstName: 'Original' }],
    } as never);

    const firstWrote = deferred();
    const releaseFirst = deferred();

    // Writer A replaces the contacts, then stays open (uncommitted) until told to commit.
    const writerA = prisma.$transaction(async (tx) => {
      await writeClientContacts(tx, client.id, {}, [{ firstName: 'A-one' }, { firstName: 'A-two' }]);
      firstWrote.resolve();
      await releaseFirst.promise;
    }, TX_OPTIONS);

    await firstWrote.promise;

    // Writer B starts while A holds uncommitted rows, including A's primary.
    const writerB = prisma.$transaction(
      (tx) => writeClientContacts(tx, client.id, {}, [{ firstName: 'B-only', isPrimary: true }]),
      TX_OPTIONS,
    );

    await waitForLockWaiters(1);
    releaseFirst.resolve();

    const [a, b] = await Promise.allSettled([writerA, writerB]);
    expect(outcome(a)).toBe('fulfilled');
    expect(outcome(b)).toBe('fulfilled');

    const rows = await prisma.clientContact.findMany({ where: { clientId: client.id } });
    expect(rows.map((r) => r.firstName)).toEqual(['B-only']);
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
  });

  it('editClientsInfo: two saves released at once both succeed, and the client ends up with ONE of them, whole', async () => {
    const client = await service.createClient(companyId, {
      name: 'Two Tabs SARL',
      address: 'Start',
      ...base,
      contacts: [{ firstName: 'Original' }],
    } as never);

    // Hold the client's row lock from outside, so both saves are provably in flight (both blocked)
    // before either is allowed to write anything.
    const lockHeld = deferred();
    const releaseLock = deferred();
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${client.id} FOR UPDATE`;
      lockHeld.resolve();
      await releaseLock.promise;
    }, TX_OPTIONS);
    await lockHeld.promise;

    const tabA = service.editClientsInfo(companyId, {
      id: client.id,
      name: 'Two Tabs SARL',
      address: 'Address from tab A',
      ...base,
      contacts: [{ firstName: 'A-one' }, { firstName: 'A-two', isPrimary: true }],
    } as never);
    const tabB = service.editClientsInfo(companyId, {
      id: client.id,
      name: 'Two Tabs SARL',
      address: 'Address from tab B',
      ...base,
      contacts: [{ firstName: 'B-only' }],
    } as never);

    await waitForLockWaiters(2);
    releaseLock.resolve();
    await holder;

    const [a, b] = await Promise.allSettled([tabA, tabB]);
    expect(outcome(a)).toBe('fulfilled');
    expect(outcome(b)).toBe('fulfilled');

    const stored = await prisma.client.findUniqueOrThrow({
      where: { id: client.id },
      include: { contacts: { orderBy: { position: 'asc' } } },
    });
    const expectedContacts: Record<string, string[]> = {
      'Address from tab A': ['A-one', 'A-two'],
      'Address from tab B': ['B-only'],
    };
    expect(Object.keys(expectedContacts)).toContain(stored.address);
    expect(stored.contacts.map((c) => c.firstName)).toEqual(expectedContacts[stored.address]);
    expect(stored.contacts.filter((c) => c.isPrimary)).toHaveLength(1);
  });
});
