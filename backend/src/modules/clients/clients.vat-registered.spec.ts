/** `Client.vatRegistered`, against the real test Postgres. */

import { vi } from 'vitest';

vi.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: vi.fn(),
}));

import { ClientsService } from './clients.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { VatValidationPort } from '../documents/tax/vat-validation';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: vi.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

const fakeVatValidator: VatValidationPort = {
  validate: vi.fn().mockResolvedValue({ status: 'UNAVAILABLE', checkedAt: new Date(), source: 'test' }),
};

describe('ClientsService: Client.vatRegistered', () => {
  let companyId: string;
  let service: ClientsService;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'VAT Registered Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: `vat-registered-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;
    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
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
