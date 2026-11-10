/** `Client.vatRegistered`, against the real test Postgres. */

import { vi } from 'vitest';

vi.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: vi.fn(),
}));

import prisma from '@/prisma/prisma.service';
import { createClientsServiceForTest, createTestCompany } from '../documents/__tests__/issuable-client';

describe('ClientsService: Client.vatRegistered', () => {
  const service = createClientsServiceForTest();
  let companyId: string;

  beforeAll(async () => {
    companyId = (await createTestCompany('VAT Registered Co')).id;
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('a fresh business client is VAT-registered by default, even when the field is never sent', async () => {
    const client = await service.createClient(companyId, {
      name: 'Client Assujetti',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
    } as never);

    expect(client.vatRegistered).toBe(true);
  });

  it('`vatRegistered: false` round-trips through create, read and edit, like any other field', async () => {
    const created = await service.createClient(companyId, {
      name: 'Micro Entreprise',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      vatRegistered: false,
    } as never);
    expect(created.vatRegistered).toBe(false);

    const read = await service.getClientById(companyId, created.id);
    expect(read?.vatRegistered).toBe(false);

    const edited = await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Micro Entreprise',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      vatRegistered: true,
    } as never);
    expect(edited.vatRegistered).toBe(true);
  });
});
