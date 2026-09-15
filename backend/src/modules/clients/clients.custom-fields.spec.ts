/**
 * Custom fields ("champs personnalisés") — the CLIENT-target half: `ClientsService`
 * constructed directly (same "ClientsModule inimportable sous ts-jest" convention
 * `clients.mass-assignment.spec.ts`/`clients.vat-validation.spec.ts` already hold), real Prisma.
 */
jest.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: jest.fn(),
}));

import { ClientsService } from './clients.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { VatValidationPort } from '../documents/tax/vat-validation';
import { createCompanyCustomField } from '../documents/company-custom-fields/persistence';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: jest.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

const fakeVatValidator: VatValidationPort = {
  validate: jest.fn().mockResolvedValue({ status: 'UNAVAILABLE', checkedAt: new Date(), source: 'test' }),
};

describe('ClientsService — company custom fields (CLIENT target)', () => {
  let companyId: string;
  let service: ClientsService;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Client Custom Fields Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `client-custom-fields-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;

    await createCompanyCustomField(companyId, {
      target: 'CLIENT',
      label: 'Account Manager',
      kind: 'text',
      required: true,
    });

    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { companyId } });
    await prisma.companyCustomField.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('refuses to create a client missing a REQUIRED custom field', async () => {
    await expect(
      service.createClient(companyId, {
        name: 'No Account Manager',
        address: 'Somewhere',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
      } as never),
    ).rejects.toThrow(/Invalid custom field data/);
  });

  it('creates and stores customFields, unprefixed, in the isolated JSON column', async () => {
    const created = await service.createClient(companyId, {
      name: 'Has Account Manager',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      customFields: { account_manager: 'Alex' },
    } as never);

    expect((created.customFields as Record<string, unknown>)?.account_manager).toBe('Alex');
  });

  it("renaming the definition's label never disturbs an already-stored value", async () => {
    const created = await service.createClient(companyId, {
      name: 'Renamed Definition Client',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      customFields: { account_manager: 'Jamie' },
    } as never);

    const definitions = await prisma.companyCustomField.findMany({
      where: { companyId, target: 'CLIENT' },
    });
    const definition = definitions.find((d) => d.key === 'account_manager')!;
    await prisma.companyCustomField.update({ where: { id: definition.id }, data: { label: 'AM (renamed)' } });

    const row = await prisma.client.findUnique({ where: { id: created.id } });
    expect((row?.customFields as Record<string, unknown>)?.account_manager).toBe('Jamie');
  });

  it('edits customFields as a full replace, and rejects an invalid value the same way create does', async () => {
    const created = await service.createClient(companyId, {
      name: 'Editable Client',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      customFields: { account_manager: 'Original' },
    } as never);

    const edited = await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Editable Client',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      customFields: { account_manager: 'Updated' },
    } as never);
    expect((edited.customFields as Record<string, unknown>)?.account_manager).toBe('Updated');

    await expect(
      service.editClientsInfo(companyId, {
        id: created.id,
        name: 'Editable Client',
        address: 'Somewhere',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        customFields: {},
      } as never),
    ).rejects.toThrow(/Invalid custom field data/);
  });
});
