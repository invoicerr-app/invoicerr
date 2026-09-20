/**
 * The overdue-invoice reminder sweep, over a company whose invoice history crosses the read cap.
 *
 * The invoices this sweep exists to chase are, by definition, the ones NOT recently touched — which
 * is exactly what a capped `updatedAt`-DESC read discarded first. Past the cap a company's oldest
 * debts simply stopped being reminded, and the pass reported a clean result while doing it. The
 * fixture makes every one of the 600 invoices overdue and puts them ALL past the cap, then asserts
 * how many reminders actually went out — the assertion is the work done, not a row count.
 *
 * `reminder-sweep-runner.spec.ts` next door mocks `../persistence` wholesale, so it can never see
 * this; here the real read runs against the in-memory document table, with the sweep's own direct
 * Prisma calls (companies, clients, reminder claims) stubbed alongside it.
 */
import { vi, type Mock } from 'vitest';

import { MailService } from '@/mail/mail.service';

import { documentInstanceRow, seedDocumentInstances } from '../__tests__/fake-document-instance-table';
import { ROW_ID_KEY } from '../row-selection/row-selection';

vi.mock('@/prisma/prisma.service', async () => {
  const module = await import('../__tests__/fake-document-instance-table');
  return {
    __esModule: true,
    default: {
      documentInstance: module.fakeDocumentInstanceDelegate,
      company: {
        findMany: vi.fn().mockResolvedValue([{ id: 'company-1', name: 'Repro SARL', language: 'en' }]),
      },
      client: {
        findFirst: vi.fn().mockResolvedValue({ contactEmail: 'client@example.invalid', language: 'en' }),
      },
      // No tier has ever been claimed, and every claim below succeeds.
      documentReminder: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(async () => ({ id: 'reminder-1' })),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    },
  };
});
vi.mock('../settlement/payments', () => ({
  sumPaidMinorByDocument: vi.fn().mockResolvedValue(new Map()),
}));

const { ReminderSweepRunner } = await import('./reminder-sweep-runner');

/** Past the 500-row cap this read used to apply. */
const INVOICE_COUNT = 600;

function invoiceData() {
  return {
    client: 'client-1',
    issueDate: '2026-01-01',
    dueDate: '2026-02-01',
    currency: 'EUR',
    lines: [{ [ROW_ID_KEY]: 'line-1', description: 'Widget', quantity: 1, unitPrice: 100, vatRate: '0' }],
  };
}

function runner(): { runner: InstanceType<typeof ReminderSweepRunner>; sendForCompany: Mock } {
  const sendForCompany = vi.fn().mockResolvedValue(undefined);
  return {
    runner: new ReminderSweepRunner({ sendForCompany } as unknown as MailService),
    sendForCompany,
  };
}

beforeEach(() => {
  seedDocumentInstances(
    Array.from({ length: INVOICE_COUNT }, (_, index) =>
      documentInstanceRow({
        id: `inv-${String(index).padStart(5, '0')}`,
        typeId: 'invoice',
        status: 'sent',
        displayNumber: `INV-${index}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        data: invoiceData(),
      }),
    ),
  );
});

describe('the reminder sweep past the read cap', () => {
  it('reminds on every overdue invoice of the company, not on one page of them', async () => {
    const { runner: sweep, sendForCompany } = runner();

    // 30 days past the fixture's own due date — the first reminder tier for every invoice.
    const result = await sweep.runSweep(new Date('2026-03-03T09:00:00.000Z'));

    expect(result.remindersSent).toBe(INVOICE_COUNT);
    expect(result.skipped).toBe(0);
    expect(sendForCompany).toHaveBeenCalledTimes(INVOICE_COUNT);
  });

  it('reminds on the OLDEST invoice — the one a capped, recency-ordered read dropped first', async () => {
    const { runner: sweep, sendForCompany } = runner();

    await sweep.runSweep(new Date('2026-03-03T09:00:00.000Z'));

    const bodies = sendForCompany.mock.calls.map(([, message]) => String(message.text));
    expect(bodies.some((body) => body.includes('INV-0'))).toBe(true);
  });

  it('reminds on nothing when no invoice is overdue yet', async () => {
    const { runner: sweep, sendForCompany } = runner();

    const result = await sweep.runSweep(new Date('2026-01-15T09:00:00.000Z'));

    expect(result.remindersSent).toBe(0);
    expect(sendForCompany).not.toHaveBeenCalled();
  });
});
