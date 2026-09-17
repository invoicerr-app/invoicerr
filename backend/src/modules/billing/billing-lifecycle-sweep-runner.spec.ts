import { Logger } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { BillingLifecycleSweepRunner } from './billing-lifecycle-sweep-runner';
import { listAdvanceableCompanySubscriptions } from './company-subscription.store';
import { reconcileMissingCompanyCustomers } from './customer-provisioning';
import { syncPolarCustomerOnCompanyChange } from './customer-sync';
import { deleteCompanyPermanently } from './deletion';
import { ExportZipTooLargeError } from './export-zip.service';
import { addDays, BLOCKED_DAYS, PAID_ZIP_GRACE_DAYS } from './lifecycle';
import { reconcileCompanySeats } from './seat-reconcile';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companySubscription: { update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
    userCompany: { findFirst: jest.fn() },
    company: { findUnique: jest.fn() },
  },
}));
jest.mock('./company-subscription.store');
jest.mock('./customer-provisioning');
jest.mock('./deletion');
jest.mock('./seat-reconcile');
jest.mock('./customer-sync');

const update = prisma.companySubscription.update as jest.Mock;
const updateMany = prisma.companySubscription.updateMany as jest.Mock;
const findSub = prisma.companySubscription.findUnique as jest.Mock;
const findFirstOwner = prisma.userCompany.findFirst as jest.Mock;
const findCompany = prisma.company.findUnique as jest.Mock;
const listSubs = listAdvanceableCompanySubscriptions as jest.Mock;
const deleteCompany = deleteCompanyPermanently as jest.Mock;
const reconcileSeats = reconcileCompanySeats as jest.Mock;
const syncCustomer = syncPolarCustomerOnCompanyChange as jest.Mock;
const provisionCustomers = reconcileMissingCompanyCustomers as jest.Mock;

/** Every test gets this NO-OP-shaped default — `runSweep` calls `reconcileMissingCompanyCustomers`
 *  unconditionally, company-WIDE, on every single tick (see that call's own comment in
 *  `billing-lifecycle-sweep-runner.ts`), so every pre-existing scenario in this file that never cared
 *  about it needs a resolved value to compare its own `result` against a `customersProvisioned: 0`
 *  baseline (`baseResult`'s own default) rather than an unrelated rejection polluting its assertions. */
const NO_CUSTOMERS_PROVISIONED = {
  total: 0,
  alreadyExisted: 0,
  created: 0,
  emailTaken: 0,
  skipped: 0,
  failed: 0,
};

function fakeExportService(zip: Buffer = Buffer.from('zip-bytes')) {
  return {
    buildCompanyZip: jest.fn().mockResolvedValue(zip),
  } as unknown as import('./export-zip.service').BillingExportService;
}

function fakeMailService(overrides: { sendForCompany?: jest.Mock; sendMail?: jest.Mock } = {}) {
  return {
    sendForCompany: overrides.sendForCompany ?? jest.fn().mockResolvedValue({ message: 'ok' }),
    sendMail: overrides.sendMail ?? jest.fn().mockResolvedValue({ message: 'ok' }),
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
    polarSubscriptionId: null,
    customerSyncFailedAt: null,
    lastPolarFactAt: null,
    billingWarningMilestonesSent: [] as string[],
    ...overrides,
  };
}

/** `findUnique` doubles as the CAS re-read `applyOne#matchesCurrentSnapshot` performs right before
 *  mailing the zip export — defaults it to "nothing has moved on", matching whatever `subRow` a given
 *  test already put in `listSubs`, so every pre-existing zip-path scenario (written before that guard
 *  existed) keeps behaving exactly as before unless a test deliberately says otherwise. */
function mockUnchangedSnapshot(sub: { status: string; lastPolarFactAt: unknown }) {
  findSub.mockResolvedValue({ status: sub.status, lastPolarFactAt: sub.lastPolarFactAt });
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
    seatsReconciled: 0,
    customerSyncRetried: 0,
    customersProvisioned: 0,
    customersSkipped: 0,
    warningsSent: 0,
    ...overrides,
  };
}

const NOW = new Date('2026-09-15T00:00:00.000Z');

describe('BillingLifecycleSweepRunner.runSweep', () => {
  beforeEach(() => {
    provisionCustomers.mockResolvedValue(NO_CUSTOMERS_PROVISIONED);
    // The CAS write's default "yes, the row still matched" outcome — a test proving the OTHER branch
    // (a concurrent write already moved the row) overrides this with `{ count: 0 }` explicitly.
    updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => jest.resetAllMocks());

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
      where: { companyId: 'c1', status: 'TRIAL', lastPolarFactAt: null },
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
      where: { companyId: 'c1', status: 'TRIAL', lastPolarFactAt: null },
      data: { status: 'BLOCKED', blockedAt: NOW },
    });
  });

  it('sends the zip and enters ZIPPED when a blocked subscription reaches its 14-day mark, mailing the oldest OWNER', async () => {
    const blockedAt = addDays(NOW, -14);
    const sub = subRow({ status: 'BLOCKED', blockedAt });
    listSubs.mockResolvedValue([sub]);
    mockUnchangedSnapshot(sub);
    findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
    const sendForCompany = jest.fn().mockResolvedValue({ message: 'ok' });
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
      where: { companyId: 'c1', status: 'BLOCKED', lastPolarFactAt: null },
      data: { status: 'ZIPPED', zipSentAt: NOW, deletionDueAt: NOW },
    });
  });

  it('never mails the zip export, and never advances, when the row moved on since this tick read it (the OWNER already paid)', async () => {
    const blockedAt = addDays(NOW, -14);
    listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
    // The fresh re-read disagrees with the snapshot this tick started from — a webhook already
    // reactivated the company.
    findSub.mockResolvedValue({ status: 'ACTIVE', lastPolarFactAt: null });
    const sendForCompany = jest.fn().mockResolvedValue({ message: 'ok' });
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
    const sendForCompany = jest.fn().mockRejectedValue(new Error('no mail server configured'));
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
      buildCompanyZip: jest.fn().mockRejectedValue(new ExportZipTooLargeError('c1', 20 * 1024 * 1024)),
    } as unknown as import('./export-zip.service').BillingExportService;
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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
        ? { status: failingSub.status, lastPolarFactAt: failingSub.lastPolarFactAt }
        : { status: okSub.status, lastPolarFactAt: okSub.lastPolarFactAt },
    );
    findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
    const buildCompanyZip = jest
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('render exploded')))
      .mockImplementationOnce(() => Promise.resolve(Buffer.from('zip-bytes')));
    const exportService = {
      buildCompanyZip,
    } as unknown as import('./export-zip.service').BillingExportService;
    const sendForCompany = jest.fn().mockResolvedValue({ message: 'ok' });
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

  it('reconciles seats for every ACTIVE, subscribed company and counts a correction', async () => {
    listSubs.mockResolvedValue([subRow({ status: 'ACTIVE', polarSubscriptionId: 'sub_1' })]);
    reconcileSeats.mockResolvedValue({ corrected: true, localSeats: 5, polarSeats: 2 });
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(reconcileSeats).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'c1', polarSubscriptionId: 'sub_1' }),
    );
    expect(result.seatsReconciled).toBe(1);
  });

  it('never reconciles seats for a non-ACTIVE subscription', async () => {
    listSubs.mockResolvedValue([
      subRow({ status: 'TRIAL', trialEndsAt: addDays(NOW, 1), polarSubscriptionId: 'sub_1' }),
    ]);
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    await runner.runSweep(NOW);

    expect(reconcileSeats).not.toHaveBeenCalled();
  });

  it('a seat reconciliation failure for one company never blocks the rest of the sweep', async () => {
    listSubs.mockResolvedValue([
      subRow({ companyId: 'bad', status: 'ACTIVE', polarSubscriptionId: 'sub_bad' }),
      subRow({ companyId: 'good', status: 'ACTIVE', polarSubscriptionId: 'sub_good' }),
    ]);
    reconcileSeats
      .mockRejectedValueOnce(new Error('polar unreachable'))
      .mockResolvedValueOnce({ corrected: true, localSeats: 4, polarSeats: 1 });
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.processed).toBe(2);
    expect(result.seatsReconciled).toBe(1); // only "good" succeeded
    expect(reconcileSeats).toHaveBeenCalledTimes(2);
  });

  describe('Polar customer sync retry', () => {
    it('retries a failed customer sync and counts it once the flag clears', async () => {
      listSubs.mockResolvedValue([subRow({ status: 'ACTIVE', customerSyncFailedAt: addDays(NOW, -1) })]);
      findCompany.mockResolvedValue({ name: 'Acme', email: 'a@acme.test', billingEmail: null });
      findSub.mockResolvedValue({ customerSyncFailedAt: null }); // the retry just succeeded
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(NOW);

      expect(syncCustomer).toHaveBeenCalledWith('c1', {
        name: 'Acme',
        email: 'a@acme.test',
        billingEmail: null,
      });
      expect(result.customerSyncRetried).toBe(1);
    });

    it('never retries a company whose sync never failed', async () => {
      listSubs.mockResolvedValue([subRow({ status: 'ACTIVE', customerSyncFailedAt: null })]);
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      await runner.runSweep(NOW);

      expect(syncCustomer).not.toHaveBeenCalled();
    });

    it("doesn't count a retry that failed again (customerSyncFailedAt still set)", async () => {
      listSubs.mockResolvedValue([subRow({ status: 'ACTIVE', customerSyncFailedAt: addDays(NOW, -1) })]);
      findCompany.mockResolvedValue({ name: 'Acme', email: 'a@acme.test', billingEmail: null });
      findSub.mockResolvedValue({ customerSyncFailedAt: NOW }); // synced again, but failed AGAIN
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(NOW);

      expect(result.customerSyncRetried).toBe(0);
    });

    it('a customer-sync retry failure for one company never blocks the rest of the sweep', async () => {
      listSubs.mockResolvedValue([
        subRow({ companyId: 'bad', status: 'ACTIVE', customerSyncFailedAt: addDays(NOW, -1) }),
        subRow({ companyId: 'good', status: 'TRIAL', trialEndsAt: addDays(NOW, 1) }),
      ]);
      findCompany.mockRejectedValue(new Error('db hiccup'));
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(NOW);

      expect(result.processed).toBe(2);
    });
  });

  describe('Polar customer provisioning', () => {
    it('surfaces the created count from reconcileMissingCompanyCustomers, unconditionally, even with no subscriptions at all', async () => {
      listSubs.mockResolvedValue([]);
      provisionCustomers.mockResolvedValue({
        total: 3,
        alreadyExisted: 1,
        created: 2,
        emailTaken: 0,
        skipped: 0,
        failed: 0,
      });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(NOW);

      expect(provisionCustomers).toHaveBeenCalledWith();
      expect(result.customersProvisioned).toBe(2);
    });

    it('surfaces the skipped count (no billing email anywhere) separately from created/failed', async () => {
      listSubs.mockResolvedValue([]);
      provisionCustomers.mockResolvedValue({
        total: 4,
        alreadyExisted: 1,
        created: 1,
        emailTaken: 0,
        skipped: 2,
        failed: 0,
      });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(NOW);

      expect(result.customersSkipped).toBe(2);
      expect(result.customersProvisioned).toBe(1);
    });

    it('leaves customersSkipped undefined, same as customersProvisioned, when the provisioning pass throws', async () => {
      listSubs.mockResolvedValue([]);
      provisionCustomers.mockRejectedValue(new Error('polar is down'));
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(NOW);

      expect(result.customersSkipped).toBeUndefined();
    });

    it('never blocks the rest of the sweep when the provisioning pass itself throws', async () => {
      listSubs.mockResolvedValue([subRow({ status: 'TRIAL', trialEndsAt: NOW })]);
      provisionCustomers.mockRejectedValue(new Error('polar is down'));
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(NOW);

      // The provisioning pass failed outright (no count to report), but the ordinary lifecycle
      // transition below it still ran and is reflected in the result untouched.
      expect(result.customersProvisioned).toBeUndefined();
      expect(result.blocked).toBe(1);
      expect(updateMany).toHaveBeenCalledWith({
        where: { companyId: 'c1', status: 'TRIAL', lastPolarFactAt: null },
        data: { status: 'BLOCKED', blockedAt: NOW },
      });
    });

    it('counts an emailTaken/failed-only pass as zero created, without throwing', async () => {
      listSubs.mockResolvedValue([]);
      provisionCustomers.mockResolvedValue({
        total: 2,
        alreadyExisted: 0,
        created: 0,
        emailTaken: 1,
        skipped: 0,
        failed: 1,
      });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(NOW);

      expect(result.customersProvisioned).toBe(0);
    });
  });

  describe('OWNER warning emails (J-7/J-1)', () => {
    it('sends the blocked_d7 warning exactly 7 days into BLOCKED, via the INSTANCE mail provider (never sendForCompany)', async () => {
      const blockedAt = addDays(NOW, -7);
      listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
      findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
      const sendMail = jest.fn().mockResolvedValue({ message: 'ok' });
      const sendForCompany = jest.fn().mockResolvedValue({ message: 'ok' });
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

    it('never re-sends a milestone already recorded in billingWarningMilestonesSent', async () => {
      const blockedAt = addDays(NOW, -7);
      listSubs.mockResolvedValue([
        subRow({ status: 'BLOCKED', blockedAt, billingWarningMilestonesSent: ['blocked_d7'] }),
      ]);
      findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
      const sendMail = jest.fn().mockResolvedValue({ message: 'ok' });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendMail }));

      const result = await runner.runSweep(NOW);

      expect(result.warningsSent).toBe(0);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('sends BOTH blocked_d7 and blocked_d1 when a missed tick catches up on both, each recorded separately', async () => {
      const blockedAt = addDays(NOW, -(BLOCKED_DAYS - 1));
      listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
      findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
      const sendMail = jest.fn().mockResolvedValue({ message: 'ok' });
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
          polarSubscriptionId: 'sub_1',
          billingWarningMilestonesSent: ['blocked_d7', 'blocked_d1', 'zipped_d7'],
        }),
      ]);
      findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
      const sendMail = jest.fn().mockResolvedValue({ message: 'ok' });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendMail }));

      const result = await runner.runSweep(NOW);

      expect(result.warningsSent).toBe(1);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringMatching(/permanently deleted/i) }),
      );
    });

    it('a never-paid company approaching immediate ZIPPED→deleted never gets a zipped warning (no real grace window)', async () => {
      listSubs.mockResolvedValue([
        subRow({
          status: 'ZIPPED',
          zipSentAt: NOW,
          deletionDueAt: NOW, // no grace — matches the never-paid cycle exactly
          blockedAt: addDays(NOW, -14),
        }),
      ]);
      const sendMail = jest.fn().mockResolvedValue({ message: 'ok' });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendMail }));

      const result = await runner.runSweep(NOW);

      expect(result.warningsSent).toBe(0);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('a warning mail failure for one milestone never blocks the rest of the sweep, and is retried next tick', async () => {
      const blockedAt = addDays(NOW, -(BLOCKED_DAYS - 1)); // both blocked_d7 and blocked_d1 due
      listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
      findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
      const sendMail = jest
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
