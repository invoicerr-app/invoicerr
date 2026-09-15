import prisma from '@/prisma/prisma.service';

import { BillingLifecycleSweepRunner } from './billing-lifecycle-sweep-runner';
import { listAdvanceableCompanySubscriptions } from './company-subscription.store';
import { deleteCompanyPermanently } from './deletion';
import { addDays } from './lifecycle';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companySubscription: { update: jest.fn() },
    userCompany: { findFirst: jest.fn() },
  },
}));
jest.mock('./company-subscription.store');
jest.mock('./deletion');

const update = prisma.companySubscription.update as jest.Mock;
const findFirstOwner = prisma.userCompany.findFirst as jest.Mock;
const listSubs = listAdvanceableCompanySubscriptions as jest.Mock;
const deleteCompany = deleteCompanyPermanently as jest.Mock;

function fakeExportService(zip: Buffer = Buffer.from('zip-bytes')) {
  return {
    buildCompanyZip: jest.fn().mockResolvedValue(zip),
  } as unknown as import('./export-zip.service').BillingExportService;
}

function fakeMailService(sendForCompany: jest.Mock = jest.fn().mockResolvedValue({ message: 'ok' })) {
  return { sendForCompany } as unknown as import('@/mail/mail.service').MailService;
}

const NOW = new Date('2026-09-15T00:00:00.000Z');

describe('BillingLifecycleSweepRunner.runSweep', () => {
  afterEach(() => jest.resetAllMocks());

  it('does nothing for a subscription still mid-trial', async () => {
    listSubs.mockResolvedValue([
      {
        companyId: 'c1',
        status: 'TRIAL',
        trialEndsAt: addDays(NOW, 1),
        blockedAt: null,
        zipSentAt: null,
        deletionDueAt: null,
        polarSubscriptionId: null,
      },
    ]);
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result).toEqual({ processed: 1, blocked: 0, zipped: 0, zipFailed: 0, deleted: 0 });
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks a trial whose 7 days elapsed', async () => {
    listSubs.mockResolvedValue([
      {
        companyId: 'c1',
        status: 'TRIAL',
        trialEndsAt: NOW,
        blockedAt: null,
        zipSentAt: null,
        deletionDueAt: null,
        polarSubscriptionId: null,
      },
    ]);
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
    listSubs.mockResolvedValue([
      {
        companyId: 'c1',
        status: 'BLOCKED',
        blockedAt,
        trialEndsAt: NOW,
        zipSentAt: null,
        deletionDueAt: null,
        polarSubscriptionId: null,
      },
    ]);
    findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
    const sendForCompany = jest.fn().mockResolvedValue({ message: 'ok' });
    const exportService = fakeExportService();
    const runner = new BillingLifecycleSweepRunner(exportService, fakeMailService(sendForCompany));

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
    listSubs.mockResolvedValue([
      {
        companyId: 'c1',
        status: 'BLOCKED',
        blockedAt,
        trialEndsAt: NOW,
        zipSentAt: null,
        deletionDueAt: null,
        polarSubscriptionId: null,
      },
    ]);
    findFirstOwner.mockResolvedValue({ user: { email: 'owner@example.com' } });
    const sendForCompany = jest.fn().mockRejectedValue(new Error('no mail server configured'));
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService(sendForCompany));

    const result = await runner.runSweep(NOW);

    expect(result.zipFailed).toBe(1);
    expect(result.zipped).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('leaves the subscription untouched when the company has no OWNER membership at all', async () => {
    const blockedAt = addDays(NOW, -14);
    listSubs.mockResolvedValue([
      {
        companyId: 'c1',
        status: 'BLOCKED',
        blockedAt,
        trialEndsAt: NOW,
        zipSentAt: null,
        deletionDueAt: null,
        polarSubscriptionId: null,
      },
    ]);
    findFirstOwner.mockResolvedValue(null);
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.zipFailed).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('deletes the company once a zipped subscription reaches its deletionDueAt', async () => {
    listSubs.mockResolvedValue([
      {
        companyId: 'c1',
        status: 'ZIPPED',
        zipSentAt: addDays(NOW, -1),
        deletionDueAt: NOW,
        blockedAt: addDays(NOW, -15),
        trialEndsAt: addDays(NOW, -30),
        polarSubscriptionId: null,
      },
    ]);
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.deleted).toBe(1);
    expect(deleteCompany).toHaveBeenCalledWith('c1');
  });

  it('one failing subscription does not stop the rest of the pass', async () => {
    listSubs.mockResolvedValue([
      {
        companyId: 'bad',
        status: 'TRIAL',
        trialEndsAt: NOW,
        blockedAt: null,
        zipSentAt: null,
        deletionDueAt: null,
        polarSubscriptionId: null,
      },
      {
        companyId: 'good',
        status: 'TRIAL',
        trialEndsAt: NOW,
        blockedAt: null,
        zipSentAt: null,
        deletionDueAt: null,
        polarSubscriptionId: null,
      },
    ]);
    update.mockRejectedValueOnce(new Error('db hiccup')).mockResolvedValueOnce({});
    const runner = new BillingLifecycleSweepRunner(fakeExportService(), fakeMailService());

    const result = await runner.runSweep(NOW);

    expect(result.processed).toBe(2);
    expect(result.blocked).toBe(1); // only "good" succeeded
    expect(update).toHaveBeenCalledTimes(2);
  });
});
