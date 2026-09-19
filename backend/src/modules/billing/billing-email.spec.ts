import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { getCompanyBillingEmail, setCompanyBillingEmail } from './billing-email';
import { syncPolarCustomerOnCompanyChange } from './customer-sync';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUniqueOrThrow: vi.fn(), update: vi.fn() } },
}));
vi.mock('./customer-sync');

const findUniqueOrThrow = prisma.company.findUniqueOrThrow as Mock;
const update = prisma.company.update as Mock;
const syncCustomer = syncPolarCustomerOnCompanyChange as Mock;

describe('getCompanyBillingEmail', () => {
  afterEach(() => vi.resetAllMocks());

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
  afterEach(() => vi.resetAllMocks());

  it('trims and stores a non-blank override', async () => {
    update.mockResolvedValue({ name: 'Acme', email: 'contact@acme.test', billingEmail: 'billing@acme.test' });

    const result = await setCompanyBillingEmail('company-1', '  billing@acme.test  ');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { billingEmail: 'billing@acme.test' },
      select: { name: true, email: true, billingEmail: true },
    });
    expect(result).toEqual({ billingEmail: 'billing@acme.test', companyEmail: 'contact@acme.test' });
  });

  it('clears the override back to null on an empty/whitespace value', async () => {
    update.mockResolvedValue({ name: 'Acme', email: 'contact@acme.test', billingEmail: null });

    await setCompanyBillingEmail('company-1', '   ');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { billingEmail: null },
      select: { name: true, email: true, billingEmail: true },
    });
  });

  it('clears the override back to null on null', async () => {
    update.mockResolvedValue({ name: 'Acme', email: 'contact@acme.test', billingEmail: null });

    await setCompanyBillingEmail('company-1', null);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { billingEmail: null },
      select: { name: true, email: true, billingEmail: true },
    });
  });

  it("pushes the newly-resolved billing email to this company's Polar customer, best-effort", async () => {
    update.mockResolvedValue({ name: 'Acme', email: 'contact@acme.test', billingEmail: 'billing@acme.test' });

    await setCompanyBillingEmail('company-1', 'billing@acme.test');

    expect(syncCustomer).toHaveBeenCalledWith('company-1', {
      name: 'Acme',
      email: 'contact@acme.test',
      billingEmail: 'billing@acme.test',
    });
  });
});
