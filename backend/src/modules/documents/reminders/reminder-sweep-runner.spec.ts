import { MailService } from '@/mail/mail.service';
import prisma from '@/prisma/prisma.service';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import { DocumentInstanceResult } from '../actions/action-registry';
import { ROW_ID_KEY } from '../row-selection/row-selection';
import * as persistence from '../persistence';
import * as settlementCredits from '../settlement/credits';
import * as settlementPayments from '../settlement/payments';
import { ReminderSweepRunner } from './reminder-sweep-runner';

/**
 * Same mocking discipline as `settlement/client-statement.spec.ts` (this file's own model): `../persistence`
 * and `../settlement/payments` fully mocked (both reach Prisma directly), `../settlement/credits`
 * mocked ONLY for `listCreditNotes` (the one function there that reaches Prisma) —
 * `creditsForInvoiceFromNotes`/`toSettlementCreditInputs` stay the REAL, already-proven implementation
 * (credits.spec.ts), so this file never re-litigates rules that module already owns. `@/prisma/prisma.service`
 * is ALSO mocked, separately, for the calls `reminder-sweep-runner.ts` makes DIRECTLY (never through
 * `../persistence`): `company.findMany`, `client.findFirst`, `documentReminder.findMany/create` — see
 * that file's own header on why it stays a plain `prisma` consumer rather than pulling in
 * `ClientsService`.
 */
jest.mock('../persistence');
jest.mock('../settlement/payments');
jest.mock('../settlement/credits', () => {
  const actual = jest.requireActual('../settlement/credits');
  return { ...actual, listCreditNotes: jest.fn() };
});
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findMany: jest.fn() },
    client: { findFirst: jest.fn() },
    documentReminder: { findMany: jest.fn(), create: jest.fn() },
  },
}));

const listDocuments = persistence.listDocuments as jest.Mock;
const sumPaidMinorByDocument = settlementPayments.sumPaidMinorByDocument as jest.Mock;
const listCreditNotes = settlementCredits.listCreditNotes as jest.Mock;
const companyFindMany = prisma.company.findMany as jest.Mock;
const clientFindFirst = prisma.client.findFirst as jest.Mock;
const reminderFindMany = prisma.documentReminder.findMany as jest.Mock;
const reminderCreate = prisma.documentReminder.create as jest.Mock;

// One line, 100 EUR net, 20% VAT -> 120 EUR / 12000 minor gross — same fixture shape
// `client-statement.spec.ts` already uses, kept minimal since this file's own focus is tier
// selection/sending, not totals arithmetic (already proven elsewhere).
function invoiceData(overrides: Record<string, unknown> = {}) {
  return {
    client: 'client-1',
    issueDate: '2026-01-01',
    dueDate: '2026-06-01',
    currency: 'EUR',
    lines: [{ [ROW_ID_KEY]: 'line-1', description: 'Widget', quantity: 1, unitPrice: 100, vatRate: '20' }],
    ...overrides,
  };
}

function invoice(
  overrides: Partial<DocumentInstanceResult> & { data: Record<string, unknown> },
): DocumentInstanceResult {
  return {
    id: 'inv-1',
    typeId: 'invoice',
    status: 'sent',
    displayNumber: 'INV-2026-0001',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

const NOW = new Date('2026-06-08T00:00:00Z'); // exactly 7 days after the fixture's own 2026-06-01 dueDate

function buildMailService(): MailService {
  return {
    sendMail: jest.fn().mockResolvedValue({ message: 'Email sent successfully' }),
  } as unknown as MailService;
}

beforeEach(() => {
  jest.clearAllMocks();
  listDocuments.mockResolvedValue([]);
  sumPaidMinorByDocument.mockResolvedValue(new Map());
  listCreditNotes.mockResolvedValue([]);
  companyFindMany.mockResolvedValue([]);
  clientFindFirst.mockResolvedValue({ contactEmail: 'client@example.com' });
  reminderFindMany.mockResolvedValue([]);
  reminderCreate.mockResolvedValue({});
});

describe('ReminderSweepRunner.runSweep', () => {
  it('does nothing (zero result) when no company has opted in', async () => {
    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);

    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ companiesProcessed: 0, remindersSent: 0, skipped: 0 });
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('sends the tier-7 reminder for an overdue, unpaid invoice of an OPTED-IN company', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 1, skipped: 0 });
    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    const [sendArgs] = (mailService.sendMail as jest.Mock).mock.calls[0];
    expect(sendArgs.to).toBe('client@example.com');
    expect(sendArgs.subject).toContain('INV-2026-0001');
    expect(sendArgs.text).toContain('120.00 EUR'); // full gross unpaid, no payments/credits recorded
    expect(reminderCreate).toHaveBeenCalledWith({
      data: { companyId: 'company-1', documentId: 'inv-1', tier: 7 },
    });
  });

  it('does NOT send anything for a company that has not opted in — findMany already filters it out', async () => {
    // The runner's own query is `where: { remindersEnabled: true }` — a disabled company never even
    // reaches `listDocuments` at all, proven here by `companyFindMany` simply returning nothing.
    companyFindMany.mockResolvedValue([]);

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(result.remindersSent).toBe(0);
    expect(listDocuments).not.toHaveBeenCalled();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('does not re-send a tier already recorded — idempotency via the (documentId, tier) read', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    reminderFindMany.mockResolvedValue([{ documentId: 'inv-1', tier: 7 }]); // tier 7 already sent

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW); // still only 7 days overdue -> nothing NEW due

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 0, skipped: 0 });
    expect(mailService.sendMail).not.toHaveBeenCalled();
    expect(reminderCreate).not.toHaveBeenCalled();
  });

  it('climbs to tier 14 once due, when tier 7 was already sent', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    reminderFindMany.mockResolvedValue([{ documentId: 'inv-1', tier: 7 }]);

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const fourteenDaysLater = new Date('2026-06-15T00:00:00Z');
    const result = await runner.runSweep(fourteenDaysLater);

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 1, skipped: 0 });
    expect(reminderCreate).toHaveBeenCalledWith({
      data: { companyId: 'company-1', documentId: 'inv-1', tier: 14 },
    });
  });

  it('sends only tier 7 (never a burst) for an invoice 30 days overdue with nothing sent yet', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const thirtyDaysLater = new Date('2026-07-01T00:00:00Z'); // 30 days past the 2026-06-01 dueDate
    const result = await runner.runSweep(thirtyDaysLater);

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 1, skipped: 0 });
    expect(reminderCreate).toHaveBeenCalledTimes(1);
    expect(reminderCreate).toHaveBeenCalledWith({
      data: { companyId: 'company-1', documentId: 'inv-1', tier: 7 },
    });
  });

  it('does not email a fully paid invoice at all, even if its due date is long past', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    sumPaidMinorByDocument.mockResolvedValue(new Map([['inv-1', 12000]])); // 120 EUR gross, fully paid

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 0, skipped: 0 });
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('skips (never throws) an invoice whose client has no resolvable contact email', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    clientFindFirst.mockResolvedValue({ contactEmail: null });

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 0, skipped: 1 });
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('skips (never throws) an invoice whose data.client points at no client at all', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData({ client: undefined }) })]);
    clientFindFirst.mockResolvedValue(null);

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 0, skipped: 1 });
    expect(clientFindFirst).not.toHaveBeenCalled(); // no clientId at all -> never even queried
  });

  it('a MailService.sendMail rejection for one invoice does not abort the others', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([
      invoice({ id: 'inv-1', displayNumber: 'INV-2026-0001', data: invoiceData() }),
      invoice({ id: 'inv-2', displayNumber: 'INV-2026-0002', data: invoiceData() }),
    ]);
    const mailService = {
      sendMail: jest
        .fn()
        .mockRejectedValueOnce(new Error('SMTP timeout'))
        .mockResolvedValueOnce({ message: 'Email sent successfully' }),
    } as unknown as MailService;

    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(mailService.sendMail).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 1, skipped: 1 });
    // Only the SECOND invoice's tier was actually recorded — the first one's failed send never reached
    // the record-write step at all.
    expect(reminderCreate).toHaveBeenCalledTimes(1);
    expect(reminderCreate).toHaveBeenCalledWith({
      data: { companyId: 'company-1', documentId: 'inv-2', tier: 7 },
    });
  });

  it('never throws when a per-company query fails — that company is skipped, others still run', async () => {
    companyFindMany.mockResolvedValue([
      { id: 'company-broken', name: 'Broken Co' },
      { id: 'company-1', name: 'Acme Corp' },
    ]);
    listDocuments
      .mockRejectedValueOnce(new Error('DB hiccup for company-broken'))
      .mockResolvedValueOnce([invoice({ data: invoiceData() })]);

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);

    await expect(runner.runSweep(NOW)).resolves.toEqual({
      companiesProcessed: 2,
      remindersSent: 1,
      skipped: 0,
    });
  });

  it('never throws even when listing opted-in companies itself fails', async () => {
    companyFindMany.mockRejectedValue(new Error('DB unreachable'));

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);

    await expect(runner.runSweep(NOW)).resolves.toEqual({
      companiesProcessed: 0,
      remindersSent: 0,
      skipped: 0,
    });
  });

  it('treats a race on the (documentId, tier) unique constraint as "already sent", never a crash', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    reminderCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`documentId`,`tier`)',
        {
          code: 'P2002',
          clientVersion: '7.8.0',
        },
      ),
    );

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);

    // The assertion itself IS the proof: a throwing runSweep would reject this promise.
    await expect(runner.runSweep(NOW)).resolves.toEqual({
      companiesProcessed: 1,
      remindersSent: 0,
      skipped: 1,
    });
    expect(mailService.sendMail).toHaveBeenCalledTimes(1); // the email really was sent
  });
});
