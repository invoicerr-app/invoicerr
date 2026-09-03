/**
 * TODO_PRODUIT.md T5(b) — `Client.isSupplier`, the reused-role decision. `ClientsService` constructed
 * DIRECTLY (never `ClientsModule` — see `clients.vat-validation.spec.ts`'s own header, "ClientsModule
 * inimportable sous ts-jest"), real Prisma.
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

describe('ClientsService — Client.isSupplier (TODO_PRODUIT.md T5(b))', () => {
  let companyId: string;
  let service: ClientsService;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Supplier Role Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: `supplier-role-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;
    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('a fresh client is not a supplier by default, even when the field is never sent', async () => {
    const client = await service.createClient(companyId, {
      name: 'Client Ordinaire',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
    } as never);
    expect(client.isSupplier).toBe(false);
  });

  it('`isSupplier: true` round-trips through create and edit, like any other field', async () => {
    const created = await service.createClient(companyId, {
      name: 'Fournisseur Explicite',
      address: 'Somewhere',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      isSupplier: true,
    } as never);
    expect(created.isSupplier).toBe(true);

    const edited = await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Fournisseur Explicite',
      address: 'Somewhere Else',
      postalCode: '75001',
      city: 'Paris',
      country: 'France',
      isSupplier: false,
    } as never);
    expect(edited.isSupplier).toBe(false);
  });

  describe('searchClients — "excludeSuppliers" (the BILLABLE picker, invoice/quote client field)', () => {
    let supplierClientId: string;
    let ordinaryClientId: string;

    beforeAll(async () => {
      const supplier = await service.createClient(companyId, {
        name: 'Fournisseur Pur Recherche',
        address: 'Somewhere',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        isSupplier: true,
      } as never);
      supplierClientId = supplier.id;

      const ordinary = await service.createClient(companyId, {
        name: 'Client Facturable Recherche',
        address: 'Somewhere',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
      } as never);
      ordinaryClientId = ordinary.id;
    });

    it("without the option, both a supplier and an ordinary client are returned — today's behaviour, unchanged", async () => {
      const results = await service.searchClients(companyId, 'Recherche');
      const ids = results.map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining([supplierClientId, ordinaryClientId]));
    });

    it('with `excludeSuppliers: true`, a pure supplier never appears — the "client" reference entity\'s own contract', async () => {
      const results = await service.searchClients(companyId, 'Recherche', { excludeSuppliers: true });
      const ids = results.map((c) => c.id);
      expect(ids).not.toContain(supplierClientId);
      expect(ids).toContain(ordinaryClientId);
    });

    it('the exclusion also applies to the empty-query ("browse") branch', async () => {
      const results = await service.searchClients(companyId, '', { excludeSuppliers: true });
      const ids = results.map((c) => c.id);
      expect(ids).not.toContain(supplierClientId);
    });
  });
});
