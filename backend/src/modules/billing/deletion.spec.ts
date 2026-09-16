import prisma from '@/prisma/prisma.service';

import { DeletionPolarClient, deleteCompanyPermanently, PolarCancellationFailedError } from './deletion';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    webhook: { deleteMany: jest.fn() },
    company: { delete: jest.fn() },
    companySubscription: { findUnique: jest.fn() },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  },
}));

const findSub = prisma.companySubscription.findUnique as jest.Mock;

function fakeClient(revoke = jest.fn().mockResolvedValue({})): DeletionPolarClient {
  return { subscriptions: { revoke } };
}

describe('deleteCompanyPermanently', () => {
  afterEach(() => jest.resetAllMocks());

  it("deletes the company's Webhook rows and the Company row in one transaction, webhooks first", async () => {
    findSub.mockResolvedValue({ polarSubscriptionId: null }); // never paid — nothing to cancel
    const calls: string[] = [];
    (prisma.webhook.deleteMany as jest.Mock).mockImplementation(() => {
      calls.push('webhook');
      return Promise.resolve({ count: 2 });
    });
    (prisma.company.delete as jest.Mock).mockImplementation(() => {
      calls.push('company');
      return Promise.resolve({});
    });

    await deleteCompanyPermanently('company-1', fakeClient());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.webhook.deleteMany).toHaveBeenCalledWith({ where: { companyId: 'company-1' } });
    expect(prisma.company.delete).toHaveBeenCalledWith({ where: { id: 'company-1' } });
    // Passed to $transaction as an array — Prisma itself resolves them in the given order, so the
    // ORDER THEY ARE BUILT IN (webhook delete before company delete) is what matters here, proven by
    // asserting the array position rather than execution order (the mock resolves both immediately).
    const [firstOp] = (prisma.$transaction as jest.Mock).mock.calls[0][0];
    expect(firstOp).toBeInstanceOf(Promise);
    expect(calls).toEqual(['webhook', 'company']);
  });

  it("cancels a PAID company's Polar subscription (immediate revoke) BEFORE deleting it", async () => {
    findSub.mockResolvedValue({ polarSubscriptionId: 'polar_sub_123' });
    const revoke = jest.fn().mockResolvedValue({});
    const order: string[] = [];
    revoke.mockImplementation(async () => {
      order.push('revoke');
    });
    (prisma.company.delete as jest.Mock).mockImplementation(async () => {
      order.push('company-delete');
    });

    await deleteCompanyPermanently('company-1', fakeClient(revoke));

    expect(revoke).toHaveBeenCalledWith({ id: 'polar_sub_123' });
    expect(order).toEqual(['revoke', 'company-delete']);
  });

  it('never even calls Polar for a never-paid company (no polarSubscriptionId)', async () => {
    findSub.mockResolvedValue({ polarSubscriptionId: null });
    const revoke = jest.fn();

    await deleteCompanyPermanently('company-1', fakeClient(revoke));

    expect(revoke).not.toHaveBeenCalled();
  });

  it('never even calls Polar when the company has no CompanySubscription row at all', async () => {
    findSub.mockResolvedValue(null);
    const revoke = jest.fn();

    await deleteCompanyPermanently('company-1', fakeClient(revoke));

    expect(revoke).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('REFUSES the deletion (named error) when the Polar cancellation fails — never a company deleted while still billed', async () => {
    findSub.mockResolvedValue({ polarSubscriptionId: 'polar_sub_123' });
    const revoke = jest.fn().mockRejectedValue(new Error('polar is down'));

    await expect(deleteCompanyPermanently('company-1', fakeClient(revoke))).rejects.toThrow(
      PolarCancellationFailedError,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.company.delete).not.toHaveBeenCalled();
  });

  it('the refusal error carries a named, machine-checkable code', async () => {
    findSub.mockResolvedValue({ polarSubscriptionId: 'polar_sub_123' });
    const revoke = jest.fn().mockRejectedValue(new Error('polar is down'));

    await expect(deleteCompanyPermanently('company-1', fakeClient(revoke))).rejects.toMatchObject({
      code: 'POLAR_CANCELLATION_FAILED',
    });
  });
});
