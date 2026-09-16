import prisma from '@/prisma/prisma.service';

import { BillingLifecycleSweepRunner } from './billing-lifecycle-sweep-runner';
import { listAdvanceableCompanySubscriptions } from './company-subscription.store';
import { reconcileMissingCompanyCustomers } from './customer-provisioning';
import { syncPolarCustomerOnCompanyChange } from './customer-sync';
import { deleteCompanyPermanently } from './deletion';
import { addDays, BLOCKED_DAYS, PAID_ZIP_GRACE_DAYS } from './lifecycle';
import { reconcileCompanySeats } from './seat-reconcile';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companySubscription: { update: jest.fn(), findUnique: jest.fn() },
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
const NO_CUSTOMERS_PROVISIONED = { total: 0, alreadyExisted: 0, created: 0, emailTaken: 0, failed: 0 };

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
    billingWarningMilestonesSent: [] as string[],
    ...overrides,
  };
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
    warningsSent: 0,
    ...overrides,
  };
}

const NOW = new Date('2026-09-15T00:00:00.000Z');

describe('BillingLifecycleSweepRunner.runSweep', () => {
  beforeEach(() => provisionCustomers.mockResolvedValue(NO_CUSTOMERS_PROVISIONED));
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
    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      data: { status: 'BLOCKED', blockedAt: NOW },
    });
  });

  it('sends the zip and enters ZIPPED when a blocked subscription reaches its 14-day mark, mailing the oldest OWNER', async () => {
    const blockedAt = addDays(NOW, -14);
    listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
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
    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      data: { status: 'ZIPPED', zipSentAt: NOW, deletionDueAt: NOW },
    });
  });

  it('leaves the subscription BLOCKED (retried next tick) when the mail send fails', async () => {
    const blockedAt = addDays(NOW, -14);
    listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
    findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
    const sendForCompany = jest.fn().mockRejectedValue(new Error('no mail server configured'));
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService({ sendForCompany }));

    const result = await runner.runSweep(NOW);

    expect(result.zipFailed).toBe(1);
    expect(result.zipped).toBe(0);
    // The ZIP transition itself never wrote — a blocked-14-days row also crosses both warning
    // milestones in the same tick (an unrelated, independent concern), so `update` legitimately runs
    // for THOSE, just never with a ZIPPED status.
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ZIPPED' }) }),
    );
  });

  it('leaves the subscription untouched when the company has no OWNER membership at all', async () => {
    const blockedAt = addDays(NOW, -14);
    listSubs.mockResolvedValue([subRow({ status: 'BLOCKED', blockedAt })]);
    findFirstOwner.mockResolvedValue(null);
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.zipFailed).toBe(1);
    expect(update).not.toHaveBeenCalled();
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
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.deleted).toBe(1);
    expect(deleteCompany).toHaveBeenCalledWith('c1');
  });

  it('one failing subscription does not stop the rest of the pass', async () => {
    listSubs.mockResolvedValue([
      subRow({ companyId: 'bad', status: 'TRIAL', trialEndsAt: NOW }),
      subRow({ companyId: 'good', status: 'TRIAL', trialEndsAt: NOW }),
    ]);
    update.mockRejectedValueOnce(new Error('db hiccup')).mockResolvedValueOnce({});
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.processed).toBe(2);
    expect(result.blocked).toBe(1); // only "good" succeeded
    expect(update).toHaveBeenCalledTimes(2);
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
        failed: 0,
      });
      const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

      const result = await runner.runSweep(NOW);

      expect(provisionCustomers).toHaveBeenCalledWith();
      expect(result.customersProvisioned).toBe(2);
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
      expect(update).toHaveBeenCalledWith({
        where: { companyId: 'c1' },
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
