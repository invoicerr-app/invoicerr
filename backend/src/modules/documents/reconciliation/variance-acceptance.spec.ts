/**
 * Real Prisma, same discipline as `reconciliation-settings.spec.ts` / `received-invoices/
 * supplier-reconciliation.spec.ts`: `findOwnedDocument`/`upsertDocument` (persistence.ts) are real
 * tenant-scoped Prisma calls, not mocked here — proving the tenant scoping (a 404 for a foreign
 * company) needs a real second company/row, not a mock that would trivially agree with itself.
 */
import prisma from '@/prisma/prisma.service';

import { acceptVariance, getVarianceAcceptance } from './variance-acceptance';

let seq = 0;
function uniqueEmail(label: string): string {
  seq += 1;
  return `variance-acceptance-${label}-${Date.now()}-${seq}@example.com`;
}

async function createCompany() {
  return prisma.company.create({
    data: {
      name: 'Variance Acceptance Co',
      foundedAt: new Date('2020-01-01'),
      address: '1 Test Street',
      postalCode: '00000',
      city: 'Testville',
      country: 'France',
      countryCode: 'FR',
      phone: '+33000000000',
      email: uniqueEmail('company'),
    },
  });
}

async function createReceivedInvoice(companyId: string, data: Record<string, unknown> = {}) {
  return prisma.documentInstance.create({
    data: { companyId, typeId: 'received-invoice', status: 'received', data },
  });
}

describe('getVarianceAcceptance', () => {
  it('returns null when nothing was ever accepted', () => {
    expect(getVarianceAcceptance({})).toBeNull();
  });

  it('returns null for a malformed stored value rather than throwing', () => {
    expect(getVarianceAcceptance({ varianceAcceptance: 'not-an-object' })).toBeNull();
    expect(getVarianceAcceptance({ varianceAcceptance: { acceptedByUserId: 'u1' } })).toBeNull();
  });

  it('reads back a well-formed stored acceptance, reason included', () => {
    const acceptance = getVarianceAcceptance({
      varianceAcceptance: {
        acceptedByUserId: 'u1',
        acceptedByLabel: 'Jane Doe',
        acceptedAt: '2026-09-15T10:00:00.000Z',
        reason: 'Supplier confirmed the price change by email.',
      },
    });
    expect(acceptance).toEqual({
      acceptedByUserId: 'u1',
      acceptedByLabel: 'Jane Doe',
      acceptedAt: '2026-09-15T10:00:00.000Z',
      reason: 'Supplier confirmed the price change by email.',
    });
  });

  it('omits reason entirely when it was never given', () => {
    const acceptance = getVarianceAcceptance({
      varianceAcceptance: {
        acceptedByUserId: 'u1',
        acceptedByLabel: 'Jane Doe',
        acceptedAt: '2026-09-15T10:00:00.000Z',
      },
    });
    expect(acceptance?.reason).toBeUndefined();
  });
});

describe('acceptVariance', () => {
  let companyId: string;

  beforeEach(async () => {
    const company = await createCompany();
    companyId = company.id;
  });

  afterEach(async () => {
    await prisma.documentInstance.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it('writes the acceptance onto the received invoice, keeping its status and other data untouched', async () => {
    const invoice = await createReceivedInvoice(companyId, { supplier: 'Acme', grossAmount: 123 });

    const result = await acceptVariance(companyId, invoice.id, 'user-1', 'Jane Doe', 'Looks fine');

    expect(result.status).toBe('received'); // untouched — an acceptance is not a lifecycle transition
    const data = result.data as Record<string, unknown>;
    expect(data.supplier).toBe('Acme');
    expect(data.grossAmount).toBe(123);
    const acceptance = getVarianceAcceptance(data);
    expect(acceptance?.acceptedByUserId).toBe('user-1');
    expect(acceptance?.acceptedByLabel).toBe('Jane Doe');
    expect(acceptance?.reason).toBe('Looks fine');
    expect(typeof acceptance?.acceptedAt).toBe('string');
  });

  it('a second acceptance overwrites the first with a fresh acceptedAt/acceptedBy', async () => {
    const invoice = await createReceivedInvoice(companyId, {});
    await acceptVariance(companyId, invoice.id, 'user-1', 'Jane Doe');
    const second = await acceptVariance(companyId, invoice.id, 'user-2', 'John Smith');

    const acceptance = getVarianceAcceptance(second.data as Record<string, unknown>);
    expect(acceptance?.acceptedByUserId).toBe('user-2');
    expect(acceptance?.acceptedByLabel).toBe('John Smith');
  });

  it('404s for a document belonging to another company (tenant scoping)', async () => {
    const otherCompany = await createCompany();
    try {
      const foreignInvoice = await createReceivedInvoice(otherCompany.id, {});
      await expect(acceptVariance(companyId, foreignInvoice.id, 'user-1', 'Jane Doe')).rejects.toThrow();
    } finally {
      await prisma.documentInstance.deleteMany({ where: { companyId: otherCompany.id } });
      await prisma.company.delete({ where: { id: otherCompany.id } });
    }
  });
});
