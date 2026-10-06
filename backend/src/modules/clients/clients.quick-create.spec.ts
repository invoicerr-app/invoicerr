/**
 * `ClientsService` constructed DIRECTLY against real Prisma, same convention as
 * `clients.identifier-pattern.spec.ts`: a client created with only a name and a country is stored
 * without an address, and completing it later keeps everything already on file.
 */
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
  validate: vi.fn().mockResolvedValue({ status: 'VALID', checkedAt: new Date(), source: 'eu-vies' }),
};

describe('ClientsService - a client created with a name and a country only', () => {
  let companyId: string;
  let service: ClientsService;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Quick Create Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '75001',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `quick-create-${Date.now()}-${Math.random()}@example.com`,
      },
    });
    companyId = company.id;
    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('is stored with no address, postal code or city, never an empty string', async () => {
    const created = await service.createClient(companyId, {
      name: 'Name Only SARL',
      address: '',
      postalCode: '',
      city: '',
      country: 'France',
      countryCode: 'FR',
      isActive: true,
    } as never);

    const row = await prisma.client.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.address).toBeNull();
    expect(row.postalCode).toBeNull();
    expect(row.city).toBeNull();
  });

  it('can be completed later without losing what was already on file', async () => {
    const created = await service.createClient(companyId, {
      name: 'Completed Later SARL',
      country: 'France',
      countryCode: 'FR',
      isActive: true,
    } as never);

    await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Completed Later SARL',
      address: '2 Rue Complète',
      postalCode: '75002',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      isActive: true,
    } as never);

    const row = await prisma.client.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({
      name: 'Completed Later SARL',
      address: '2 Rue Complète',
      postalCode: '75002',
      city: 'Paris',
      country: 'France',
    });
  });
});
