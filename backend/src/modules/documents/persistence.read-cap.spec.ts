/**
 * The read primitive itself: `listAllDocuments` must return the WHOLE matching set, and
 * `listDocumentsPage`'s date-filtered `total` must count the whole filtered set rather than the page
 * it happened to read.
 *
 * Fixtures deliberately CROSS the caps involved — 2 400 rows, past both the 1 000-row scan batch and
 * the 2 000-row cap the date-filtered list path used to apply. A fixture sized under a cap makes a
 * test that cannot fail: it would pass identically against the very code this proves wrong.
 *
 * Runs the REAL persistence layer against the in-memory table (`__tests__/fake-document-instance-
 * table.ts`), which honours `take` exactly like Postgres — mocking `./persistence` instead would test
 * the mock.
 */
import { vi } from 'vitest';

import {
  documentInstanceRow,
  fakePrismaClient,
  seedDocumentInstances,
} from './__tests__/fake-document-instance-table';

vi.mock('@/prisma/prisma.service', async () => {
  const module = await import('./__tests__/fake-document-instance-table');
  return { default: module.fakePrismaClient, prisma: module.fakePrismaClient };
});

const { listAllDocuments, listDocumentsPage } = await import('./persistence');

/** Past the 1 000-row scan batch AND past the 2 000-row cap the date-filtered path used to apply. */
const INVOICE_COUNT = 2400;
/** Every invoice carries the same amount, so a missing row is a missing 10 000 minor units and the
 *  assertion reads as money rather than as a row count. */
const AMOUNT_MINOR = 10_000;

function sumAmountMinor(rows: { data: unknown }[]): number {
  return rows.reduce(
    (total, row) => total + Number((row.data as Record<string, unknown>).amountMinor ?? 0),
    0,
  );
}

beforeEach(() => {
  expect(fakePrismaClient.documentInstance).toBeDefined();
  seedDocumentInstances(
    Array.from({ length: INVOICE_COUNT }, (_, index) =>
      documentInstanceRow({
        // Zero-padded so the id ordering the keyset scan pages on is the insertion order.
        id: `inv-${String(index).padStart(5, '0')}`,
        companyId: 'company-1',
        typeId: 'invoice',
        status: 'sent',
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        data: { client: 'client-1', issueDate: '2026-01-01', amountMinor: AMOUNT_MINOR },
      }),
    ),
  );
});

describe('listAllDocuments', () => {
  it('pages until the set is exhausted — the summed amount is the whole company, not one page', async () => {
    const all = await listAllDocuments('company-1', { typeId: 'invoice' });

    expect(sumAmountMinor(all)).toBe(INVOICE_COUNT * AMOUNT_MINOR);
  });

  it('pushes status and the client field into the query and still covers every match', async () => {
    seedDocumentInstances([
      ...Array.from({ length: INVOICE_COUNT }, (_, index) =>
        documentInstanceRow({
          id: `mine-${String(index).padStart(5, '0')}`,
          status: 'sent',
          data: { client: 'client-1', amountMinor: AMOUNT_MINOR },
        }),
      ),
      // Noise the filter must exclude: another client, and a draft of the right client.
      documentInstanceRow({
        id: 'other-client',
        status: 'sent',
        data: { client: 'client-2', amountMinor: 999 },
      }),
      documentInstanceRow({
        id: 'still-draft',
        status: 'draft',
        data: { client: 'client-1', amountMinor: 999 },
      }),
    ]);

    const mine = await listAllDocuments('company-1', {
      typeId: 'invoice',
      status: ['sent'],
      dataEquals: { client: 'client-1' },
    });

    expect(sumAmountMinor(mine)).toBe(INVOICE_COUNT * AMOUNT_MINOR);
  });

  it('never scopes past the company it was asked for', async () => {
    seedDocumentInstances([
      documentInstanceRow({ id: 'ours', companyId: 'company-1', data: { amountMinor: AMOUNT_MINOR } }),
      documentInstanceRow({ id: 'theirs', companyId: 'company-2', data: { amountMinor: 999_999 } }),
    ]);

    expect(sumAmountMinor(await listAllDocuments('company-1'))).toBe(AMOUNT_MINOR);
  });
});

describe('listDocumentsPage with a date filter', () => {
  it('reports a total counted over every matching document, not over the page it read', async () => {
    const page = await listDocumentsPage('company-1', {
      typeId: 'invoice',
      page: 1,
      pageSize: 20,
      sort: 'updatedAt',
      order: 'desc',
      dateFieldKey: 'issueDate',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-01',
    });

    expect(page.total).toBe(INVOICE_COUNT);
    expect(page.items).toHaveLength(20);
  });

  it('can still reach a document whose issue date is in range but which is not recently touched', async () => {
    // The one invoice of an older period, and the LEAST recently updated row in the table — exactly
    // what a capped, `updatedAt`-ordered read dropped first.
    seedDocumentInstances([
      documentInstanceRow({
        id: 'inv-00000-old',
        updatedAt: new Date(Date.UTC(2020, 0, 1)),
        data: { client: 'client-1', issueDate: '2020-03-15', amountMinor: 4242 },
      }),
      ...Array.from({ length: INVOICE_COUNT }, (_, index) =>
        documentInstanceRow({
          id: `inv-${String(index).padStart(5, '0')}`,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
          data: { client: 'client-1', issueDate: '2026-01-01', amountMinor: AMOUNT_MINOR },
        }),
      ),
    ]);

    const page = await listDocumentsPage('company-1', {
      typeId: 'invoice',
      page: 1,
      pageSize: 20,
      sort: 'updatedAt',
      order: 'desc',
      dateFieldKey: 'issueDate',
      dateFrom: '2020-01-01',
      dateTo: '2020-12-31',
    });

    expect(page.total).toBe(1);
    expect(sumAmountMinor(page.items)).toBe(4242);
  });
});
