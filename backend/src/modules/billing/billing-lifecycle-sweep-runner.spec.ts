import { vi, type Mock } from 'vitest';

import { Logger } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { BillingLifecycleSweepRunner } from './billing-lifecycle-sweep-runner';
import { listAdvanceableCompanySubscriptions } from './company-subscription.store';
import { deleteCompanyPermanently } from './deletion';
import { ExportZipTooLargeError } from './export-zip.service';
import { addDays, BLOCKED_DAYS, MIN_RETRIEVAL_DAYS, PAID_ZIP_GRACE_DAYS } from './lifecycle';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companySubscription: { update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    userCompany: { findFirst: vi.fn() },
  },
}));
vi.mock('./company-subscription.store');
vi.mock('./deletion');

const update = prisma.companySubscription.update as Mock;
const updateMany = prisma.companySubscription.updateMany as Mock;
const findSub = prisma.companySubscription.findUnique as Mock;
const findFirstOwner = prisma.userCompany.findFirst as Mock;
const listSubs = listAdvanceableCompanySubscriptions as Mock;
const deleteCompany = deleteCompanyPermanently as Mock;

function fakeExportService(zip: Buffer = Buffer.from('zip-bytes')) {
  return {
    buildCompanyZip: vi.fn().mockResolvedValue(zip),
  } as unknown as import('./export-zip.service').BillingExportService;
}

function fakeMailService(overrides: { sendForCompany?: Mock; sendMail?: Mock } = {}) {
  return {
    sendForCompany: overrides.sendForCompany ?? vi.fn().mockResolvedValue({ message: 'ok' }),
    sendMail: overrides.sendMail ?? vi.fn().mockResolvedValue({ message: 'ok' }),
  } as unknown as import('@/mail/mail.service').MailService;
}

/** Every field `runSweep`/`sendDueBillingWarnings` reads off a `CompanySubscription` row — a single
 *  place so every test fixture stays valid as the shape grows (this spec used to hand-roll a slightly
 *  different object per test, which is exactly what silently broke once `billingWarningMilestonesSent`
 *  was added: `computeDueBillingWarnings` reads it unconditionally). */
function subRow(overrides: Record<string, unknown>) {
  return {
    companyId: 'c1',
    status: 'TRIAL',
    trialEndsAt: NOW,
    blockedAt: null,
    zipSentAt: null,
    deletionDueAt: null,
    firstPaidAt: null,
    currentPeriodEnd: null,
    lastBillingFactAt: null,
    billingWarningMilestonesSent: [] as string[],
    ...overrides,
  };
}

/** `findUnique` doubles as the CAS re-read `applyOne#matchesCurrentSnapshot` performs right before
 *  mailing the zip export — defaults it to "nothing has moved on", matching whatever `subRow` a given
 *  test already put in `listSubs`, so every pre-existing zip-path scenario (written before that guard
 *  existed) keeps behaving exactly as before unless a test deliberately says otherwise. */
function mockUnchangedSnapshot(sub: { status: string; lastBillingFactAt: unknown }) {
  findSub.mockResolvedValue({ status: sub.status, lastBillingFactAt: sub.lastBillingFactAt });
}

/** The base `runSweep` result shape every test compares against with `toEqual` — spread with only the
 *  fields a given scenario actually changes. */
function baseResult(overrides: Partial<Record<string, number>> = {}) {
  return {
    processed: 0,
    blocked: 0,
    zipped: 0,
    zipFailed: 0,
    deleted: 0,
    warningsSent: 0,
    ...overrides,
  };
}

const NOW = new Date('2026-09-15T00:00:00.000Z');

describe('BillingLifecycleSweepRunner.runSweep', () => {
  beforeEach(() => {
    // The CAS write's default "yes, the row still matched" outcome — a test proving the OTHER branch
    // (a concurrent write already moved the row) overrides this with `{ count: 0 }` explicitly.
    updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.resetAllMocks());

  it('does nothing for a subscription still mid-trial', async () => {
    listSubs.mockResolvedValue([subRow({ status: 'TRIAL', trialEndsAt: addDays(NOW, 1) })]);
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result).toEqual(baseResult({ processed: 1 }));
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks a trial whose 14 days elapsed', async () => {
    listSubs.mockResolvedValue([subRow({ status: 'TRIAL', trialEndsAt: NOW })]);
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.blocked).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', status: 'TRIAL', lastBillingFactAt: null },
      data: { status: 'BLOCKED', blockedAt: NOW },
    });
  });

  describe('a PAST_DUE company that has already paid through 2026-10-31', () => {
    // The everyday case: the card is refused at renewal, the billing provider keeps retrying for days, and the
    // company has October in hand either way.
    const pastDue = () =>
      subRow({
        status: 'PAST_DUE',
        firstPaidAt: new Date('2026-08-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-10-31T06:00:00.000Z'),
      });

    it('is left alone while the period it bought is still running — no write at all', async () => {
      listSubs.mockResolvedValue([pastDue()]);
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(new Date('2026-10-20T00:00:00.000Z'));

      expect(result).toEqual(baseResult({ processed: 1 }));
      expect(updateMany).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('is still left alone on the last millisecond of the last day paid for', async () => {
      listSubs.mockResolvedValue([pastDue()]);
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(new Date('2026-10-31T23:59:59.999Z'));

      expect(result.blocked).toBe(0);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('is blocked on the first tick of the day it has NOT paid for', async () => {
      const now = new Date('2026-11-01T00:00:00.000Z');
      listSubs.mockResolvedValue([pastDue()]);
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(now);

      expect(result.blocked).toBe(1);
      expect(updateMany).toHaveBeenCalledWith({
        where: { companyId: 'c1', status: 'PAST_DUE', lastBillingFactAt: null },
        data: { status: 'BLOCKED', blockedAt: now },
      });
    });
  });

  it('blocks a PAST_DUE company with no paid period on file on the very next tick', async () => {
    listSubs.mockResolvedValue([subRow({ status: 'PAST_DUE', currentPeriodEnd: null })]);
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.blocked).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', status: 'PAST_DUE', lastBillingFactAt: null },
      data: { status: 'BLOCKED', blockedAt: NOW },
    });
  });

  it('never counts a block, and never advances, when a webhook already moved the row past the snapshot this tick read (race)', async () => {
    listSubs.mockResolvedValue([subRow({ status: 'TRIAL', trialEndsAt: NOW })]);
    // The CAS write finds zero matching rows — exactly what happens when a webhook's own write (the
    // company just paid, `applySubscriptionWebhook`) landed between this tick's read and this write.
    updateMany.mockResolvedValue({ count: 0 });
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.blocked).toBe(0);
    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', status: 'TRIAL', lastBillingFactAt: null },
      data: { status: 'BLOCKED', blockedAt: NOW },
    });
  });

  it('sends the zip and enters ZIPPED when a blocked subscription reaches its 14-day mark, mailing the oldest OWNER', async () => {
    const blockedAt = addDays(NOW, -14);
    const sub = subRow({ status: 'BLOCKED', blockedAt });
    listSubs.mockResolvedValue([sub]);
    mockUnchangedSnapshot(sub);
    findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
    const sendForCompany = vi.fn().mockResolvedValue({ message: 'ok' });
    const exportService = fakeExportService();
    const runner = new BillingLifecycleSweepRunner(exportService, fakeMailService({ sendForCompany }));

    const result = await runner.runSweep(NOW);

    expect(result.zipped).toBe(1);
    expect(exportService.buildCompanyZip).toHaveBeenCalledWith('c1');
    expect(sendForCompany).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        to: 'owner@example.com',
        attachments: [expect.objectContaining({ filename: 'invoicerr-export.zip' })],
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', status: 'BLOCKED', lastBillingFactAt: null },
      data: { status: 'ZIPPED', zipSentAt: NOW, deletionDueAt: addDays(NOW, MIN_RETRIEVAL_DAYS) },
    });
  });

  it("mails the zip export in the OWNER's own resolved language, never a hardcoded English default", async () => {
    const blockedAt = addDays(NOW, -14);
    const sub = subRow({ status: 'BLOCKED', blockedAt });
    listSubs.mockResolvedValue([sub]);
    mockUnchangedSnapshot(sub);
    findFirstOwner.mockResolvedValue({
      user: { email: 'proprietaire@example.com', locale: 'fr' },
      company: { language: 'de' }, // the OWNER's own locale wins over the company's fallback language.
    });
    const sendForCompany = vi.fn().mockResolvedValue({ message: 'ok' });
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendForCompany }));

    await runner.runSweep(NOW);

    expect(sendForCompany).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ subject: 'Export de vos données de société' }),
    );
  });

  it('never mails the zip export, and never advances, when the row moved on since this tick read it (the OWNER already paid)', async () => {
    const blockedAt = addDays(NOW, -14);
    listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
    // The fresh re-read disagrees with the snapshot this tick started from — a webhook already
    // reactivated the company.
    findSub.mockResolvedValue({ status: 'ACTIVE', lastBillingFactAt: null });
    const sendForCompany = vi.fn().mockResolvedValue({ message: 'ok' });
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendForCompany }));

    const result = await runner.runSweep(NOW);

    expect(result.zipped).toBe(0);
    expect(result.zipFailed).toBe(0);
    expect(sendForCompany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ZIPPED' }) }),
    );
  });

  it('leaves the subscription BLOCKED (retried next tick) when the mail send fails', async () => {
    const blockedAt = addDays(NOW, -14);
    const sub = subRow({ status: 'BLOCKED', blockedAt });
    listSubs.mockResolvedValue([sub]);
    mockUnchangedSnapshot(sub);
    findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
    const sendForCompany = vi.fn().mockRejectedValue(new Error('no mail server configured'));
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendForCompany }));

    const result = await runner.runSweep(NOW);

    expect(result.zipFailed).toBe(1);
    expect(result.zipped).toBe(0);
    // The ZIP transition itself never wrote — a blocked-14-days row also crosses both warning
    // milestones in the same tick (an unrelated, independent concern), so `update` legitimately runs
    // for THOSE, just never with a ZIPPED status.
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ZIPPED' }) }),
    );
  });

  it('leaves the subscription untouched when the company has no OWNER membership at all', async () => {
    const blockedAt = addDays(NOW, -14);
    const sub = subRow({ status: 'BLOCKED', blockedAt });
    listSubs.mockResolvedValue([sub]);
    mockUnchangedSnapshot(sub);
    findFirstOwner.mockResolvedValue(null);
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.zipFailed).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('counts a bounded export failure (ExportZipTooLargeError) as zipFailed and logs it by name, distinct from a generic mail failure', async () => {
    const blockedAt = addDays(NOW, -14);
    const sub = subRow({ status: 'BLOCKED', blockedAt });
    listSubs.mockResolvedValue([sub]);
    mockUnchangedSnapshot(sub);
    findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
    const exportService = {
      buildCompanyZip: vi.fn().mockRejectedValue(new ExportZipTooLargeError('c1', 20 * 1024 * 1024)),
    } as unknown as import('./export-zip.service').BillingExportService;
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const runner = new BillingLifecycleSweepRunner(exportService, fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.zipFailed).toBe(1);
    expect(result.zipped).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('exceeded its size/time bound'),
      expect.objectContaining({ error: expect.stringContaining('bytes while building') }),
    );
    // Never the generic "Failed to send the data export" message this same catch block also logs for
    // an ordinary mail-send failure — the whole point of the named error is telling the two apart.
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Failed to send the data export'), {
      error: expect.anything(),
    });
    errorSpy.mockRestore();
  });

  it("isolates one company's export failure from the rest of the sweep — the next company is still zipped and mailed", async () => {
    const blockedAt = addDays(NOW, -14);
    const failingSub = subRow({ companyId: 'c-fails', status: 'BLOCKED', blockedAt });
    const okSub = subRow({ companyId: 'c-ok', status: 'BLOCKED', blockedAt });
    listSubs.mockResolvedValue([failingSub, okSub]);
    findSub.mockImplementation(async ({ where }: { where: { companyId: string } }) =>
      where.companyId === 'c-fails'
        ? { status: failingSub.status, lastBillingFactAt: failingSub.lastBillingFactAt }
        : { status: okSub.status, lastBillingFactAt: okSub.lastBillingFactAt },
    );
    findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
    const buildCompanyZip = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('render exploded')))
      .mockImplementationOnce(() => Promise.resolve(Buffer.from('zip-bytes')));
    const exportService = {
      buildCompanyZip,
    } as unknown as import('./export-zip.service').BillingExportService;
    const sendForCompany = vi.fn().mockResolvedValue({ message: 'ok' });
    const runner = new BillingLifecycleSweepRunner(exportService, fakeMailService({ sendForCompany }));

    const result = await runner.runSweep(NOW);

    expect(result.zipFailed).toBe(1);
    expect(result.zipped).toBe(1);
    expect(buildCompanyZip).toHaveBeenCalledWith('c-fails');
    expect(buildCompanyZip).toHaveBeenCalledWith('c-ok');
    expect(sendForCompany).toHaveBeenCalledWith('c-ok', expect.objectContaining({ to: 'owner@example.com' }));
    expect(sendForCompany).toHaveBeenCalledTimes(1);
  });

  it('deletes the company once a zipped subscription reaches its deletionDueAt', async () => {
    listSubs.mockResolvedValue([
      subRow({
        status: 'ZIPPED',
        zipSentAt: addDays(NOW, -1),
        deletionDueAt: NOW,
        blockedAt: addDays(NOW, -15),
      }),
    ]);
    deleteCompany.mockResolvedValue(true);
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.deleted).toBe(1);
    expect(deleteCompany).toHaveBeenCalledWith('c1', NOW);
  });

  it('never counts a deletion the guarded deleteCompanyPermanently refused (the row moved on since the sweep read it)', async () => {
    listSubs.mockResolvedValue([
      subRow({
        status: 'ZIPPED',
        zipSentAt: addDays(NOW, -1),
        deletionDueAt: NOW,
        blockedAt: addDays(NOW, -15),
      }),
    ]);
    deleteCompany.mockResolvedValue(false); // deletion.ts's own re-read found it no longer due
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.deleted).toBe(0);
  });

  it('one failing subscription does not stop the rest of the pass', async () => {
    listSubs.mockResolvedValue([
      subRow({ companyId: 'bad', status: 'TRIAL', trialEndsAt: NOW }),
      subRow({ companyId: 'good', status: 'TRIAL', trialEndsAt: NOW }),
    ]);
    updateMany.mockRejectedValueOnce(new Error('db hiccup')).mockResolvedValueOnce({ count: 1 });
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.processed).toBe(2);
    expect(result.blocked).toBe(1); // only "good" succeeded
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  describe('OWNER warning emails (J-7/J-1)', () => {
    it('sends the blocked_d7 warning exactly 7 days into BLOCKED, via the INSTANCE mail provider (never sendForCompany)', async () => {
      const blockedAt = addDays(NOW, -7);
      listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
      findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
      const sendMail = vi.fn().mockResolvedValue({ message: 'ok' });
      const sendForCompany = vi.fn().mockResolvedValue({ message: 'ok' });
      const runner = new BillingLifecycleSweepRunner(
        fakeExportService(),
        fakeMailService({ sendMail, sendForCompany }),
      );

      const result = await runner.runSweep(NOW);

      expect(result.warningsSent).toBe(1);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@example.com', subject: expect.stringContaining('7 days') }),
      );
      // Distinct from the zip export mail, which goes through the COMPANY's own mail server.
      expect(sendForCompany).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith({
        where: { companyId: 'c1' },
        data: { billingWarningMilestonesSent: { push: 'blocked_d7' } },
      });
    });

    it("falls back to the company's own language when the OWNER never set a personal locale", async () => {
      const blockedAt = addDays(NOW, -7);
      listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
      findFirstOwner.mockResolvedValue({
        user: { email: 'owner@example.com', locale: null },
        company: { language: 'fr' },
      });
      const sendMail = vi.fn().mockResolvedValue({ message: 'ok' });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendMail }));

      await runner.runSweep(NOW);

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Action requise : vos données Invoicerr seront archivées dans 7 jours',
        }),
      );
    });

    it('never re-sends a milestone already recorded in billingWarningMilestonesSent', async () => {
      const blockedAt = addDays(NOW, -7);
      listSubs.mockResolvedValue([
        subRow({ status: 'BLOCKED', blockedAt, billingWarningMilestonesSent: ['blocked_d7'] }),
      ]);
      findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
      const sendMail = vi.fn().mockResolvedValue({ message: 'ok' });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendMail }));

      const result = await runner.runSweep(NOW);

      expect(result.warningsSent).toBe(0);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('sends BOTH blocked_d7 and blocked_d1 when a missed tick catches up on both, each recorded separately', async () => {
      const blockedAt = addDays(NOW, -(BLOCKED_DAYS - 1));
      listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
      findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
      const sendMail = vi.fn().mockResolvedValue({ message: 'ok' });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendMail }));

      const result = await runner.runSweep(NOW);

      expect(result.warningsSent).toBe(2);
      expect(update).toHaveBeenCalledWith({
        where: { companyId: 'c1' },
        data: { billingWarningMilestonesSent: { push: 'blocked_d7' } },
      });
      expect(update).toHaveBeenCalledWith({
        where: { companyId: 'c1' },
        data: { billingWarningMilestonesSent: { push: 'blocked_d1' } },
      });
    });

    it('sends the zipped_d1 deletion warning for a paid-then-stopped company nearing its 180-day grace end', async () => {
      const zipSentAt = addDays(NOW, -(PAID_ZIP_GRACE_DAYS - 1));
      const deletionDueAt = addDays(zipSentAt, PAID_ZIP_GRACE_DAYS);
      listSubs.mockResolvedValue([
        subRow({
          status: 'ZIPPED',
          zipSentAt,
          deletionDueAt,
          blockedAt: addDays(zipSentAt, -14),
          firstPaidAt: new Date('2026-08-01T00:00:00.000Z'),
          billingWarningMilestonesSent: ['blocked_d7', 'blocked_d1', 'zipped_d7'],
        }),
      ]);
      findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
      const sendMail = vi.fn().mockResolvedValue({ message: 'ok' });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendMail }));

      const result = await runner.runSweep(NOW);

      expect(result.warningsSent).toBe(1);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringMatching(/permanently deleted/i) }),
      );
    });

    it('sends the zipped_d1 deletion warning for a never-paid company nearing its own 30-day floor too', async () => {
      const zipSentAt = addDays(NOW, -(MIN_RETRIEVAL_DAYS - 1));
      const deletionDueAt = addDays(zipSentAt, MIN_RETRIEVAL_DAYS);
      listSubs.mockResolvedValue([
        subRow({
          status: 'ZIPPED',
          zipSentAt,
          deletionDueAt,
          blockedAt: addDays(zipSentAt, -14),
          billingWarningMilestonesSent: ['blocked_d7', 'blocked_d1', 'zipped_d7'],
        }),
      ]);
      findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
      const sendMail = vi.fn().mockResolvedValue({ message: 'ok' });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendMail }));

      const result = await runner.runSweep(NOW);

      expect(result.warningsSent).toBe(1);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringMatching(/permanently deleted/i) }),
      );
    });

    it('a row somehow written with a sub-7-day window (should not happen) never gets a zipped warning', async () => {
      listSubs.mockResolvedValue([
        subRow({
          status: 'ZIPPED',
          zipSentAt: NOW,
          deletionDueAt: NOW, // defensive case — see lifecycle.ts's own `hasRealZippedGraceWindow` comment
          blockedAt: addDays(NOW, -14),
        }),
      ]);
      const sendMail = vi.fn().mockResolvedValue({ message: 'ok' });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendMail }));

      const result = await runner.runSweep(NOW);

      expect(result.warningsSent).toBe(0);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('a warning mail failure for one milestone never blocks the rest of the sweep, and is retried next tick', async () => {
      const blockedAt = addDays(NOW, -(BLOCKED_DAYS - 1)); // both blocked_d7 and blocked_d1 due
      listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
      findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
      const sendMail = vi
        .fn()
        .mockRejectedValueOnce(new Error('mail down'))
        .mockResolvedValueOnce({ message: 'ok' });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendMail }));

      const result = await runner.runSweep(NOW);

      // Only the ONE that actually succeeded was recorded/counted.
      expect(result.warningsSent).toBe(1);
      expect(update).toHaveBeenCalledTimes(1);
    });
  });
});
