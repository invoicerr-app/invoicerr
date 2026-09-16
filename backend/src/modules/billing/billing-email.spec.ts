import prisma from '@/prisma/prisma.service';

import { getCompanyBillingEmail, setCompanyBillingEmail } from './billing-email';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUniqueOrThrow: jest.fn(), update: jest.fn() } },
}));

const findUniqueOrThrow = prisma.company.findUniqueOrThrow as jest.Mock;
const update = prisma.company.update as jest.Mock;

describe('getCompanyBillingEmail', () => {
  afterEach(() => jest.resetAllMocks());

  it('returns the stored override alongside the contact email', async () => {
    findUniqueOrThrow.mockResolvedValue({ email: 'contact@acme.test', billingEmail: 'billing@acme.test' });

    const result = await getCompanyBillingEmail('company-1');

    expect(result).toEqual({ billingEmail: 'billing@acme.test', companyEmail: 'contact@acme.test' });
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      select: { email: true, billingEmail: true },
    });
  });
});

describe('setCompanyBillingEmail', () => {
  afterEach(() => jest.resetAllMocks());

  it('trims and stores a non-blank override', async () => {
    update.mockResolvedValue({ email: 'contact@acme.test', billingEmail: 'billing@acme.test' });

    const result = await setCompanyBillingEmail('company-1', '  billing@acme.test  ');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { billingEmail: 'billing@acme.test' },
      select: { email: true, billingEmail: true },
    });
    expect(result).toEqual({ billingEmail: 'billing@acme.test', companyEmail: 'contact@acme.test' });
  });

  it('clears the override back to null on an empty/whitespace value', async () => {
    update.mockResolvedValue({ email: 'contact@acme.test', billingEmail: null });

    await setCompanyBillingEmail('company-1', '   ');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { billingEmail: null },
      select: { email: true, billingEmail: true },
    });
  });

  it('clears the override back to null on null', async () => {
    update.mockResolvedValue({ email: 'contact@acme.test', billingEmail: null });

    await setCompanyBillingEmail('company-1', null);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { billingEmail: null },
      select: { email: true, billingEmail: true },
    });
  });
});
