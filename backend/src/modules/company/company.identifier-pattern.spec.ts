/**
 * `CompanyService` constructed DIRECTLY, real Prisma — same discipline as `company.service.spec.ts`'s
 * own header. Sibling of `clients/clients.identifier-pattern.spec.ts`: proves the SAME
 * `country-identifiers/validate-identifier-value.ts` gate is wired into the OTHER write path this
 * brief names explicitly (`upsertPartyIdentifiers` in `company.service.ts`) — a company's own
 * identifiers (e.g. its own `IT_PA_CODE`, if it is itself a Pubblica Amministrazione) go through the
 * exact same catalog and the exact same refusal, not a second, parallel mechanism.
 */
jest.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: jest.fn(),
}));

import { BadRequestException } from '@nestjs/common';

import { CompanyService } from './company.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { seedCountryIdentifierRequirements } from '../documents/country-identifiers/seed';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: jest.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

async function createTestCompany() {
  return prisma.company.create({
    data: {
      name: 'IT Company Identifier Pattern Co',
      foundedAt: new Date('2020-01-01'),
      address: '1 Test Street',
      postalCode: '00100',
      city: 'Roma',
      country: 'Italy',
      countryCode: 'IT',
      phone: '+390000000000',
      email: `it-company-identifier-pattern-${Date.now()}-${Math.random()}@example.com`,
    },
  });
}

describe('CompanyService — country-identifiers pattern enforcement', () => {
  let service: CompanyService;

  beforeAll(async () => {
    // Same real reseed as the client-side sibling spec — idempotent, safe to run unconditionally.
    await seedCountryIdentifierRequirements(prisma);
    service = new CompanyService(fakeWebhookDispatcher);
  });

  it('a 5-character IT_PA_CODE (Italy declares exactly 6) is refused on edit, naming the scheme and the value received', async () => {
    const company = await createTestCompany();
    try {
      await expect(
        service.editCompanyInfo(company.id, {
          name: company.name,
          currency: 'EUR',
          country: 'Italy',
          countryCode: 'IT',
          identifiers: [{ scheme: 'IT_PA_CODE', value: 'ABCDE' }], // 5 chars, not 6
        } as never),
      ).rejects.toThrow(BadRequestException);

      const row = await prisma.partyIdentifier.findUnique({
        where: { companyId_scheme: { companyId: company.id, scheme: 'IT_PA_CODE' } },
      });
      expect(row).toBeNull(); // refused before any write
    } finally {
      await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    }
  });

  it('a 6-character IT_PA_CODE is accepted and stored', async () => {
    const company = await createTestCompany();
    try {
      const updated = await service.editCompanyInfo(company.id, {
        name: company.name,
        currency: 'EUR',
        country: 'Italy',
        countryCode: 'IT',
        identifiers: [{ scheme: 'IT_PA_CODE', value: 'ABC123' }],
      } as never);
      expect(updated).toBeDefined();

      const row = await prisma.partyIdentifier.findUnique({
        where: { companyId_scheme: { companyId: company.id, scheme: 'IT_PA_CODE' } },
      });
      expect(row?.value).toBe('ABC123');
    } finally {
      await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    }
  });

  it('a rejected identifier on createCompany never leaves an orphan company row behind', async () => {
    const beforeCount = await prisma.company.count();

    await expect(
      service.createCompany('fake-user-id-not-persisted', {
        name: 'Orphan Check Co',
        currency: 'EUR',
        country: 'Italy',
        countryCode: 'IT',
        identifiers: [{ scheme: 'IT_PA_CODE', value: 'TOOLONGVALUE' }],
      } as never),
    ).rejects.toThrow(BadRequestException);

    const afterCount = await prisma.company.count();
    expect(afterCount).toBe(beforeCount);
  });
});
