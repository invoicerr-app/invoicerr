import * as nodemailer from 'nodemailer';

import { MailService } from '@/mail/mail.service';
import { resolveCompanyMailSettings } from '@/modules/company/mail-settings/company-mail-settings.resolver';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import { DocumentInstanceResult } from '../actions/action-registry';
import { ROW_ID_KEY } from '../row-selection/row-selection';
import * as persistence from '../persistence';
import * as settlementCredits from '../settlement/credits';
import * as settlementPayments from '../settlement/payments';
import { ReminderSweepRunner } from './reminder-sweep-runner';

// Only used by the "société → instance" cascade tests near the bottom of this file — every other
// test here keeps using a bare fake `{ sendForCompany: jest.fn() }`, never touching this at all.
jest.mock('@/modules/company/mail-settings/company-mail-settings.resolver', () => ({
  resolveCompanyMailSettings: jest.fn(),
}));
const mockedResolveCompanyMailSettings = resolveCompanyMailSettings as jest.Mock;

/**
 * Same mocking discipline as `settlement/client-statement.spec.ts` (this file's own model): `../persistence`
 * and `../settlement/payments` fully mocked (both reach Prisma directly), `../settlement/credits`
 * mocked ONLY for `listCreditNotes` (the one function there that reaches Prisma) —
 * `creditsForInvoiceFromNotes`/`toSettlementCreditInputs` stay the REAL, already-proven implementation
 * (credits.spec.ts), so this file never re-litigates rules that module already owns. `@/prisma/prisma.service`
 * is ALSO mocked, separately, for the calls `reminder-sweep-runner.ts` makes DIRECTLY (never through
 * `../persistence`): `company.findMany`, `client.findFirst`,
 * `documentReminder.findMany/create/deleteMany` — see that file's own header on why it stays a plain
 * `prisma` consumer rather than pulling in `ClientsService`. `create` is the CLAIM
 * (`claimReminderTier`, run BEFORE `mailService.sendForCompany`) and `deleteMany` is the compensating
 * release (`releaseReminderClaim`, run only if the send then fails) — see reminder-sweep-runner.ts's
 * own header ("Reservation, not record-after-send") for why the order is claim-then-send, not
 * send-then-record.
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
    documentReminder: { findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  },
}));

const listDocuments = persistence.listDocuments as jest.Mock;
const sumPaidMinorByDocument = settlementPayments.sumPaidMinorByDocument as jest.Mock;
const listCreditNotes = settlementCredits.listCreditNotes as jest.Mock;
const companyFindMany = prisma.company.findMany as jest.Mock;
const clientFindFirst = prisma.client.findFirst as jest.Mock;
const reminderFindMany = prisma.documentReminder.findMany as jest.Mock;
const reminderCreate = prisma.documentReminder.create as jest.Mock;
const reminderDeleteMany = prisma.documentReminder.deleteMany as jest.Mock;

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
    sendForCompany: jest.fn().mockResolvedValue({ message: 'Email sent successfully' }),
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
  reminderCreate.mockResolvedValue({ id: 'reminder-default' });
  reminderDeleteMany.mockResolvedValue({ count: 1 });
});

describe('ReminderSweepRunner.runSweep', () => {
  it('does nothing (zero result) when no company has opted in', async () => {
    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);

    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ companiesProcessed: 0, remindersSent: 0, skipped: 0 });
    expect(mailService.sendForCompany).not.toHaveBeenCalled();
  });

  it('sends the tier-7 reminder for an overdue, unpaid invoice of an OPTED-IN company', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 1, skipped: 0 });
    expect(mailService.sendForCompany).toHaveBeenCalledTimes(1);
    const [sentCompanyId, sendArgs] = (mailService.sendForCompany as jest.Mock).mock.calls[0];
    expect(sentCompanyId).toBe('company-1');
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
    expect(mailService.sendForCompany).not.toHaveBeenCalled();
  });

  it('does not re-send a tier already recorded — idempotency via the (documentId, tier) read', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    reminderFindMany.mockResolvedValue([{ documentId: 'inv-1', tier: 7 }]); // tier 7 already sent

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW); // still only 7 days overdue -> nothing NEW due

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 0, skipped: 0 });
    expect(mailService.sendForCompany).not.toHaveBeenCalled();
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
    expect(mailService.sendForCompany).not.toHaveBeenCalled();
  });

  it('skips (never throws) an invoice whose client has no resolvable contact email', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    clientFindFirst.mockResolvedValue({ contactEmail: null });

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 0, skipped: 1 });
    expect(mailService.sendForCompany).not.toHaveBeenCalled();
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

  it('a MailService.sendForCompany rejection for one invoice does not abort the others, and releases that reservation', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([
      invoice({ id: 'inv-1', displayNumber: 'INV-2026-0001', data: invoiceData() }),
      invoice({ id: 'inv-2', displayNumber: 'INV-2026-0002', data: invoiceData() }),
    ]);
    reminderCreate
      .mockResolvedValueOnce({ id: 'reminder-inv-1' })
      .mockResolvedValueOnce({ id: 'reminder-inv-2' });
    const mailService = {
      sendForCompany: jest
        .fn()
        .mockRejectedValueOnce(new Error('SMTP timeout'))
        .mockResolvedValueOnce({ message: 'Email sent successfully' }),
    } as unknown as MailService;

    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(mailService.sendForCompany).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 1, skipped: 1 });
    // BOTH invoices had their tier claimed BEFORE their own send attempt — the reservation write can
    // no longer be blamed for a resend, because it happens before the mail goes out, never after.
    expect(reminderCreate).toHaveBeenCalledTimes(2);
    expect(reminderCreate).toHaveBeenNthCalledWith(1, {
      data: { companyId: 'company-1', documentId: 'inv-1', tier: 7 },
    });
    expect(reminderCreate).toHaveBeenNthCalledWith(2, {
      data: { companyId: 'company-1', documentId: 'inv-2', tier: 7 },
    });
    // The first invoice's failed send released its claim (so a later pass can retry tier 7 for it),
    // instead of leaving a phantom "sent" row nobody will ever revisit — see this file's own header
    // ("Reservation, not record-after-send") for why a reserved-then-unsent tier must not stay blocked.
    expect(reminderDeleteMany).toHaveBeenCalledTimes(1);
    expect(reminderDeleteMany).toHaveBeenCalledWith({
      where: { id: 'reminder-inv-1', companyId: 'company-1', documentId: 'inv-1', tier: 7 },
    });
  });

  it('persists an admin-visible log entry when a reminder email fails to send', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    const mailService = {
      sendForCompany: jest.fn().mockRejectedValue(new Error('SMTP timeout')),
    } as unknown as MailService;
    // Real implementation runs (it never throws — see logger.service.ts's own header), only spied on
    // to assert the call: a silently-failing reminder must leave a trace in the PERSISTED logger
    // (Settings -> Logs), not just whatever `this.logger` (raw Nest logger, console-only) already did.
    const errorSpy = jest.spyOn(logger, 'error');

    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 0, skipped: 1 });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('tier-7'),
      expect.objectContaining({
        category: 'documents',
        details: expect.objectContaining({
          companyId: 'company-1',
          documentId: 'inv-1',
          tier: 7,
          reason: 'SMTP timeout',
        }),
      }),
    );
    // The claim made just before the failed send was released, not left stuck — see this file's own
    // header on why a reserved-then-unsent tier must not stay blocked forever.
    expect(reminderDeleteMany).toHaveBeenCalledWith({
      where: { id: 'reminder-default', companyId: 'company-1', documentId: 'inv-1', tier: 7 },
    });

    errorSpy.mockRestore();
  });

  // --- The fix for the duplicate-send bug this task closes -----------------------------------------
  //
  // Under the OLD order (send, then record), a `documentReminder.create` failure for any reason OTHER
  // than a genuine (documentId, tier) race happened AFTER a real, successful send — so the email had
  // already gone out, the tier was never marked, and the next day's pass re-sent the identical email.
  // The two tests below prove the NEW order (claim, then send) closes that hole: the write now always
  // happens BEFORE the send is even attempted, so a write failure can only ever prevent a send, never
  // silently follow one that already succeeded.

  it('never sends the email when the reservation write fails for a reason OTHER than a race — the send-then-record bug this closes', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    // A transient DB hiccup on the CLAIM itself — not a P2002 race. On the old (send-then-record)
    // order this mock has no bearing on whether the email goes out at all, since sendForCompany always
    // ran BEFORE this write was ever attempted; this test would therefore see `sendForCompany` called
    // on the pre-fix code. On the fixed (claim-then-send) order it must prevent the send entirely.
    reminderCreate.mockRejectedValue(new Error('connection reset by peer'));

    const mailService = buildMailService();
    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(mailService.sendForCompany).not.toHaveBeenCalled();
    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 0, skipped: 1 });
    // No claim ever landed, so nothing needs releasing either.
    expect(reminderDeleteMany).not.toHaveBeenCalled();
  });

  it('releases a claimed tier whose send then failed, so a later pass finds it unclaimed and retries — never blocked forever', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    reminderCreate.mockResolvedValue({ id: 'reminder-claim-1' });
    const mailService = {
      sendForCompany: jest.fn().mockRejectedValue(new Error('SMTP timeout')),
    } as unknown as MailService;

    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 0, skipped: 1 });
    expect(reminderCreate).toHaveBeenCalledWith({
      data: { companyId: 'company-1', documentId: 'inv-1', tier: 7 },
    });
    // The claim this call made is released by its own id AND the (companyId, documentId, tier)
    // invariant — the same belt-and-suspenders scoping `bank-reconciliation/persistence.ts#releaseLineClaim`
    // holds for its own compensating rollback.
    expect(reminderDeleteMany).toHaveBeenCalledWith({
      where: { id: 'reminder-claim-1', companyId: 'company-1', documentId: 'inv-1', tier: 7 },
    });
  });

  it('leaves a PERSISTED trace when the release itself also fails — the one case a tier can stay stuck as claimed', async () => {
    companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
    listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
    reminderCreate.mockResolvedValue({ id: 'reminder-claim-1' });
    reminderDeleteMany.mockRejectedValue(new Error('connection reset by peer'));
    const mailService = {
      sendForCompany: jest.fn().mockRejectedValue(new Error('SMTP timeout')),
    } as unknown as MailService;
    const errorSpy = jest.spyOn(logger, 'error');

    const runner = new ReminderSweepRunner(mailService);
    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ companiesProcessed: 1, remindersSent: 0, skipped: 1 });
    // Two distinct persisted facts: the send failed, AND separately, releasing its claim also failed —
    // this tier is now stuck "claimed" with no email ever delivered.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('tier-7'),
      expect.objectContaining({
        category: 'documents',
        details: expect.objectContaining({ reason: 'SMTP timeout' }),
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ALSO'),
      expect.objectContaining({
        category: 'documents',
        details: expect.objectContaining({
          companyId: 'company-1',
          documentId: 'inv-1',
          tier: 7,
          reason: 'connection reset by peer',
        }),
      }),
    );

    errorSpy.mockRestore();
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

  it('treats a race on the (documentId, tier) unique constraint as "already claimed", never a crash, and never sends a duplicate', async () => {
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
    // Claim-then-send (this file's own header, "Reservation, not record-after-send") means losing this
    // race must PREVENT the send, not just fail to record it afterwards — a concurrent pass already
    // owns this tier, so sending here too would be exactly the duplicate a reservation exists to rule
    // out. This is the behavioral improvement over the old send-then-record order, which really did
    // send the email twice in this same window.
    expect(mailService.sendForCompany).not.toHaveBeenCalled();
  });

  // The two tests below use a REAL `MailService` (only `resolveCompanyMailSettings` and
  // `nodemailer.createTransport` are mocked, the same doubles `mail.service.spec.ts` itself uses) —
  // every test above already proves the reminder's OWN content/timing against a fake
  // `sendForCompany`; this is the one place proving a reminder genuinely reaches the right transport.
  describe('reminders go through the société → instance → refus-nommé cascade', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
      jest.restoreAllMocks();
      mockedResolveCompanyMailSettings.mockReset();
      process.env = { ...ORIGINAL_ENV };
      delete process.env.MAIL_PROVIDER;
      delete process.env.RESEND_API_KEY;
      delete process.env.SMTP_HOST;
    });

    afterAll(() => {
      process.env = ORIGINAL_ENV;
    });

    it("sends the reminder through THIS company's own SMTP server when Settings → Mail has one configured", async () => {
      companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
      listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
      process.env.SMTP_HOST = 'instance-smtp.example.com'; // instance IS configured too — must be ignored
      mockedResolveCompanyMailSettings.mockResolvedValue({
        kind: 'smtp',
        host: 'company-smtp.example.com',
        port: 587,
        secure: false,
        username: 'user',
        password: 'pass',
        fromAddress: 'billing@company.example.com',
      });
      const sendMailMock = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock } as never);

      const runner = new ReminderSweepRunner(new MailService());
      const result = await runner.runSweep(NOW);

      expect(result.remindersSent).toBe(1);
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'company-smtp.example.com' }),
      );
    });

    it('falls back to the instance mail server when this company has none configured', async () => {
      companyFindMany.mockResolvedValue([{ id: 'company-1', name: 'Acme Corp' }]);
      listDocuments.mockResolvedValue([invoice({ data: invoiceData() })]);
      process.env.SMTP_HOST = 'instance-smtp.example.com';
      mockedResolveCompanyMailSettings.mockResolvedValue(null);
      const sendMailMock = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock } as never);

      const runner = new ReminderSweepRunner(new MailService());
      const result = await runner.runSweep(NOW);

      expect(result.remindersSent).toBe(1);
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'instance-smtp.example.com' }),
      );
    });
  });
});
