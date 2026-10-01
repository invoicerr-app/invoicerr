/**
 * Issue #416 ("payment methods per client") — the REAL Postgres integration half, proving the
 * migration-created `ClientPaymentMethodRestriction` table and its FK/cascade actually behave, not
 * just the mocked-store logic `persistence.spec.ts` already covers. Same "real Prisma, no mock"
 * discipline `clients.custom-fields.spec.ts` already holds for the identical "a company-scoped
 * feature actually round-trips through a live database" concern.
 */
import prisma from '@/prisma/prisma.service';

import {
  isMethodAllowedForClient,
  listClientPaymentMethodRestrictions,
  resolveEnabledPaymentMethodPresentations,
  setClientPaymentMethodRestrictions,
  updateCompanyPaymentMethodConfig,
} from './persistence';

describe('payment-methods — ClientPaymentMethodRestriction, real Postgres', () => {
  let companyId: string;
  let otherCompanyId: string;
  let clientId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;

    const company = await prisma.company.create({
      data: {
        name: 'Client Payment Restriction Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `client-payment-restriction-co-${suffix}@example.com`,
      },
    });
    companyId = company.id;

    const otherCompany = await prisma.company.create({
      data: {
        name: 'Another Company',
        foundedAt: new Date('2020-01-01'),
        address: '2 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000001',
        email: `client-payment-restriction-other-co-${suffix}@example.com`,
      },
    });
    otherCompanyId = otherCompany.id;

    const client = await prisma.client.create({
      data: {
        companyId,
        name: 'Restricted Client SARL',
        address: '3 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
      },
    });
    clientId = client.id;

    // Company-level: bank_transfer (with an IBAN on file) and paypal both ENABLED — the two methods
    // every test below narrows between.
    await prisma.company.update({ where: { id: companyId }, data: { iban: 'FR1420041010050500013M02606' } });
    await updateCompanyPaymentMethodConfig(companyId, 'bank_transfer', { enabled: true });
    await updateCompanyPaymentMethodConfig(companyId, 'paypal', {
      enabled: true,
      config: { email: 'billing@acme.test' },
    });
  });

  afterAll(async () => {
    await prisma.clientPaymentMethodRestriction.deleteMany({ where: { clientId } }).catch(() => undefined);
    await prisma.client.deleteMany({ where: { companyId } }).catch(() => undefined);
    await prisma.companyPaymentMethodConfig.deleteMany({ where: { companyId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: otherCompanyId } }).catch(() => undefined);
  });

  afterEach(async () => {
    // Every test below starts from "no restriction on file" — cleared via the real function under
    // test, not a bare `deleteMany`, so a bug in `setClientPaymentMethodRestrictions` itself would
    // surface here too.
    await setClientPaymentMethodRestrictions(companyId, clientId, []);
  });

  it('a freshly created client reads back as unrestricted, and offers every company-enabled method', async () => {
    expect(await listClientPaymentMethodRestrictions(companyId, clientId)).toEqual([]);

    const presentations = await resolveEnabledPaymentMethodPresentations(companyId, {}, clientId);
    expect(presentations.map((p) => p.id).sort()).toEqual(['bank_transfer', 'paypal']);
  });

  it('restricting to a subset — the row actually persists and actually narrows the render', async () => {
    const saved = await setClientPaymentMethodRestrictions(companyId, clientId, ['bank_transfer']);
    expect(saved).toEqual(['bank_transfer']);

    // Read back through a SEPARATE query — not trusting the write call's own return value as proof.
    const rows = await prisma.clientPaymentMethodRestriction.findMany({ where: { clientId } });
    expect(rows.map((r) => r.methodId)).toEqual(['bank_transfer']);

    const presentations = await resolveEnabledPaymentMethodPresentations(companyId, {}, clientId);
    expect(presentations.map((p) => p.id)).toEqual(['bank_transfer']);
    expect(await isMethodAllowedForClient(companyId, clientId, 'bank_transfer')).toBe(true);
    expect(await isMethodAllowedForClient(companyId, clientId, 'paypal')).toBe(false);
  });

  it('a company disabling a method the client was restricted to makes it disappear for that client too', async () => {
    await setClientPaymentMethodRestrictions(companyId, clientId, ['paypal']);
    expect(
      (await resolveEnabledPaymentMethodPresentations(companyId, {}, clientId)).map((p) => p.id),
    ).toEqual(['paypal']);

    await updateCompanyPaymentMethodConfig(companyId, 'paypal', { enabled: false });
    try {
      expect(await resolveEnabledPaymentMethodPresentations(companyId, {}, clientId)).toEqual([]);
    } finally {
      // Restore company state for the tests that run after this one in the same file.
      await updateCompanyPaymentMethodConfig(companyId, 'paypal', {
        enabled: true,
        config: { email: 'billing@acme.test' },
      });
    }
  });

  it('a client belonging to ANOTHER company is refused — 404, never a cross-tenant read/write', async () => {
    await expect(listClientPaymentMethodRestrictions(otherCompanyId, clientId)).rejects.toThrow(/not found/i);
    await expect(
      setClientPaymentMethodRestrictions(otherCompanyId, clientId, ['bank_transfer']),
    ).rejects.toThrow(/not found/i);
  });

  it('deleting the client cascades — its restriction rows do not survive as orphans', async () => {
    const throwaway = await prisma.client.create({
      data: {
        companyId,
        name: 'Throwaway Client',
        address: '4 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
      },
    });
    await setClientPaymentMethodRestrictions(companyId, throwaway.id, ['bank_transfer']);
    expect(await prisma.clientPaymentMethodRestriction.count({ where: { clientId: throwaway.id } })).toBe(1);

    await prisma.client.delete({ where: { id: throwaway.id } });

    expect(await prisma.clientPaymentMethodRestriction.count({ where: { clientId: throwaway.id } })).toBe(0);
  });
});
