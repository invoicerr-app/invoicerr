import prisma from '@/prisma/prisma.service';

import { deleteCompanyPermanently } from './deletion';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    webhook: { deleteMany: jest.fn() },
    company: { delete: jest.fn() },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  },
}));

describe('deleteCompanyPermanently', () => {
  afterEach(() => jest.resetAllMocks());

  it("deletes the company's Webhook rows and the Company row in one transaction, webhooks first", async () => {
    const calls: string[] = [];
    (prisma.webhook.deleteMany as jest.Mock).mockImplementation(() => {
      calls.push('webhook');
      return Promise.resolve({ count: 2 });
    });
    (prisma.company.delete as jest.Mock).mockImplementation(() => {
      calls.push('company');
      return Promise.resolve({});
    });

    await deleteCompanyPermanently('company-1');

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
});
