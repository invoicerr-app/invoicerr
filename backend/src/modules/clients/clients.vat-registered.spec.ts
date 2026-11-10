/** `Client.vatRegistered`, against the real test Postgres. */
import { vi } from 'vitest';

vi.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: vi.fn(),
}));

import prisma from '@/prisma/prisma.service';
import { createClientsServiceForTest, createTestCompany } from '../documents/__tests__/issuable-client';

const service = createClientsServiceForTest();

/** Runs `body` against a throwaway company, deleted afterwards whatever happens. */
async function withCompany(name: string, body: (companyId: string) => Promise<void>) {
  const company = await createTestCompany(name);
  try {
    await body(company.id);
  } finally {
    await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
  }
}

const FRENCH_CLIENT = {
  address: 'Somewhere',
  postalCode: '75000',
  city: 'Paris',
  country: 'France',
};

describe('ClientsService: the VAT-registered flag', () => {
  it('defaults a business client to VAT-registered when the field is never sent', async () => {
    await withCompany('VAT Default Co', async (companyId) => {
      const client = await service.createClient(companyId, {
        name: 'Client Assujetti',
        ...FRENCH_CLIENT,
      } as never);

      expect(client.vatRegistered).toBe(true);
    });
  });

  it('round-trips false through create, read and edit', async () => {
    await withCompany('VAT Round Trip Co', async (companyId) => {
      const created = await service.createClient(companyId, {
        name: 'Micro Entreprise',
        ...FRENCH_CLIENT,
        vatRegistered: false,
      } as never);
      expect(created.vatRegistered).toBe(false);

      const read = await service.getClientById(companyId, created.id);
      expect(read?.vatRegistered).toBe(false);

      const edited = await service.editClientsInfo(companyId, {
        id: created.id,
        name: 'Micro Entreprise',
        ...FRENCH_CLIENT,
        vatRegistered: true,
      } as never);
      expect(edited.vatRegistered).toBe(true);
    });
  });
});
