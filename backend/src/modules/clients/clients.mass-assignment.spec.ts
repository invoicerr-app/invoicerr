/**
 * `ClientsService` constructed DIRECTLY (never `ClientsModule` — see `clients.vat-validation.spec.ts`'s
 * own header, "ClientsModule inimportable sous ts-jest"), real Prisma.
 *
 * Covers the mass-assignment close on `editClientsInfo`: there is no runtime request validation
 * anywhere in this API (no ValidationPipe, no class-validator — `EditClientsDto` is a TypeScript
 * `interface`, erased at compile time), so before this fix `data: { ...dataFields, isActive: true }`
 * would write ANY key a caller named in the body — directly relevant here, `companyId` (not even a
 * field on the DTO, but just as happily accepted by an unchecked spread, reassigning a client to a
 * company the caller may not even belong to). `editClientsInfo` scopes its OWNERSHIP CHECK correctly
 * (`findFirst({ where: { id, companyId } })`, 404 otherwise — untouched by this fix, and not what
 * this file is about); what was missing is that the WRITE itself trusted the same unchecked body.
 */
jest.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: jest.fn(),
}));

import { ClientsService } from './clients.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { VatValidationPort } from '../documents/tax/vat-validation';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: jest.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

const fakeVatValidator: VatValidationPort = {
  validate: jest.fn().mockResolvedValue({ status: 'UNAVAILABLE', checkedAt: new Date(), source: 'test' }),
};

describe('ClientsService — mass-assignment allow-list on editClientsInfo', () => {
  let companyId: string;
  let otherCompanyId: string;
  let service: ClientsService;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Mass Assignment Client Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `clients-mass-assignment-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;

    const other = await prisma.company.create({
      data: {
        name: 'Other Co',
        foundedAt: new Date('2020-01-01'),
        address: '2 rue de Test',
        postalCode: '75001',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000001',
        email: `clients-mass-assignment-other-${Date.now()}@example.com`,
      },
    });
    otherCompanyId = other.id;

    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: otherCompanyId } }).catch(() => undefined);
  });

  it('writes an allow-listed field normally — the fix does not break ordinary edits', async () => {
    const created = await service.createClient(companyId, {
      name: 'Client Ordinaire',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
    } as never);

    const edited = await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Client Renommé',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
    } as never);
    expect(edited.name).toBe('Client Renommé');
  });

  it('ignores `companyId` in the body — not a DTO field, but happily accepted by an unchecked spread', async () => {
    const created = await service.createClient(companyId, {
      name: 'Client Multi-Tenant',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
    } as never);

    await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Client Multi-Tenant',
      address: 'Somewhere Else',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      companyId: otherCompanyId,
    } as never);

    const row = await prisma.client.findUnique({ where: { id: created.id } });
    expect(row?.companyId).toBe(companyId);
    expect(row?.address).toBe('Somewhere Else');
  });
});
