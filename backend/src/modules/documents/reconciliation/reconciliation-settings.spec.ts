/**
 * Real Prisma, same discipline as `received-invoices/supplier-reconciliation.spec.ts`: this module
 * reaches `DocumentInstance` through the bare `prisma` singleton directly (see this module's own
 * header on why), so proving it means real rows, not a mock of a query builder.
 */
import prisma from '@/prisma/prisma.service';

import {
  DEFAULT_TOLERANCE_PERCENT,
  getReconciliationSettings,
  RECONCILIATION_SETTINGS_TYPE_ID,
  setReconciliationTolerancePercent,
} from './reconciliation-settings';

let seq = 0;
function uniqueEmail(label: string): string {
  seq += 1;
  return `reconciliation-settings-${label}-${Date.now()}-${seq}@example.com`;
}

async function createCompany() {
  return prisma.company.create({
    data: {
      name: 'Reconciliation Settings Co',
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

describe('reconciliation-settings', () => {
  let companyId: string;

  beforeEach(async () => {
    const company = await createCompany();
    companyId = company.id;
  });

  afterEach(async () => {
    await prisma.documentInstance.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it('defaults to DEFAULT_TOLERANCE_PERCENT for a company that never set one', async () => {
    const settings = await getReconciliationSettings(companyId);
    expect(settings.tolerancePercent).toBe(DEFAULT_TOLERANCE_PERCENT);
  });

  it('persists and reads back a company-chosen tolerance', async () => {
    await setReconciliationTolerancePercent(companyId, 5);
    const settings = await getReconciliationSettings(companyId);
    expect(settings.tolerancePercent).toBe(5);
  });

  it('a second write UPDATES the same singleton row, never creates a second one', async () => {
    await setReconciliationTolerancePercent(companyId, 3);
    await setReconciliationTolerancePercent(companyId, 7);

    const rows = await prisma.documentInstance.findMany({
      where: { companyId, typeId: RECONCILIATION_SETTINGS_TYPE_ID },
    });
    expect(rows).toHaveLength(1);
    expect((rows[0].data as { tolerancePercent: number }).tolerancePercent).toBe(7);
  });

  it('accepts a zero tolerance (a meaningful, non-default value — see three-way-match.ts)', async () => {
    await setReconciliationTolerancePercent(companyId, 0);
    const settings = await getReconciliationSettings(companyId);
    expect(settings.tolerancePercent).toBe(0);
  });

  it('rejects a negative tolerance', async () => {
    await expect(setReconciliationTolerancePercent(companyId, -1)).rejects.toThrow();
  });

  it('rejects a non-finite tolerance', async () => {
    await expect(setReconciliationTolerancePercent(companyId, Number.NaN)).rejects.toThrow();
  });

  it('is scoped per company — one company setting a value never affects another', async () => {
    const otherCompany = await createCompany();
    try {
      await setReconciliationTolerancePercent(companyId, 9);
      const otherSettings = await getReconciliationSettings(otherCompany.id);
      expect(otherSettings.tolerancePercent).toBe(DEFAULT_TOLERANCE_PERCENT);
    } finally {
      await prisma.documentInstance.deleteMany({ where: { companyId: otherCompany.id } });
      await prisma.company.delete({ where: { id: otherCompany.id } });
    }
  });
});
