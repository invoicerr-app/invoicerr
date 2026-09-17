/**
 * `GET /clients/duplicates` and `GET /clients/:id` — real Prisma (own company, cleaned up in
 * `afterAll`), the same pattern `clients.vat-validation.spec.ts` already uses for the identical
 * "ClientsModule not importable under ts-jest" reason (see that file's own header) — `ClientsService`
 * constructed directly with a stub webhook dispatcher and a VAT validator that is never exercised by
 * these cases. The two endpoints share this file because they share the same fixtures AND the same
 * feature: `getClientById` backs the duplicate-warning banner's own "view existing client" link
 * (`?view=<id>`, resolved by `useClient` — see that hook's own header), so a tenant-isolation gap
 * there would let the banner leak another company's client into this one's wizard.
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

const fakeVatValidator = { validate: jest.fn() } as unknown as VatValidationPort;

describe('ClientsService#findDuplicates', () => {
  let companyId: string;
  let otherCompanyId: string;
  let service: ClientsService;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Duplicates Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: `duplicates-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;

    const otherCompany = await prisma.company.create({
      data: {
        name: 'Other Tenant Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Other Street',
        postalCode: '00000',
        city: 'Otherville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000001',
        email: `duplicates-other-${Date.now()}@example.com`,
      },
    });
    otherCompanyId = otherCompany.id;

    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: otherCompanyId } }).catch(() => undefined);
  });

  it('treats an oversized value as unusable — never a 400, exactly like an absent one', async () => {
    // A value this long cannot be a real client's email/name/country — `boundedOrUndefined` (see
    // `findDuplicates`'s own header on why silently dropping it, not throwing, keeps this endpoint a
    // pure hint) drops it before it ever reaches the query, so a same-length real match still would
    // never surface for it.
    const tooLong = 'a'.repeat(301);
    expect(await service.findDuplicates(companyId, { email: tooLong })).toEqual([]);
    expect(await service.findDuplicates(companyId, { name: tooLong, country: 'France' })).toEqual([]);
  });

  it('returns [] when neither email nor a name+country pair is usable', async () => {
    expect(await service.findDuplicates(companyId, {})).toEqual([]);
    expect(await service.findDuplicates(companyId, { name: 'Solo Name' })).toEqual([]);
    expect(await service.findDuplicates(companyId, { country: 'France' })).toEqual([]);
  });

  it('matches an existing client by contact email, case-insensitively', async () => {
    const existing = await service.createClient(companyId, {
      name: 'Acme Existing SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contactEmail: 'Contact@Acme.Example',
    } as never);

    const matches = await service.findDuplicates(companyId, { email: 'contact@acme.example' });
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(existing.id);
    expect(matches[0].matchedOn).toEqual(['email']);
  });

  it('matches an existing client by name + country together, case-insensitively — name alone is not enough', async () => {
    const existing = await service.createClient(companyId, {
      name: 'Southern Trading Ltd',
      address: 'Somewhere',
      postalCode: '20000',
      city: 'Marseille',
      country: 'France',
      currency: 'EUR',
      isActive: true,
    } as never);

    const matched = await service.findDuplicates(companyId, {
      name: 'southern trading ltd',
      country: 'FRANCE',
    });
    expect(matched.map((m) => m.id)).toEqual([existing.id]);
    expect(matched[0].matchedOn).toEqual(['name_country']);

    // Same name, DIFFERENT country — country-scoping actually narrows the match, it is not decorative.
    const notMatched = await service.findDuplicates(companyId, {
      name: 'Southern Trading Ltd',
      country: 'Germany',
    });
    expect(notMatched).toEqual([]);
  });

  it('excludeId drops the client being edited from its own duplicate check', async () => {
    const existing = await service.createClient(companyId, {
      name: 'Self Edit SARL',
      address: 'Somewhere',
      postalCode: '30000',
      city: 'Lyon',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contactEmail: 'self-edit@example.com',
    } as never);

    const withoutExclude = await service.findDuplicates(companyId, { email: 'self-edit@example.com' });
    expect(withoutExclude.map((m) => m.id)).toEqual([existing.id]);

    const withExclude = await service.findDuplicates(companyId, {
      email: 'self-edit@example.com',
      excludeId: existing.id,
    });
    expect(withExclude).toEqual([]);
  });

  it('never crosses tenants — a same-email client in another company is invisible', async () => {
    await service.createClient(otherCompanyId, {
      name: 'Foreign Tenant Client',
      address: 'Elsewhere',
      postalCode: '40000',
      city: 'Nice',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contactEmail: 'cross-tenant@example.com',
    } as never);

    expect(await service.findDuplicates(companyId, { email: 'cross-tenant@example.com' })).toEqual([]);
  });

  it('never flags a soft-deleted (isActive: false) client as a duplicate', async () => {
    const existing = await service.createClient(companyId, {
      name: 'Deleted Later SARL',
      address: 'Somewhere',
      postalCode: '50000',
      city: 'Nantes',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contactEmail: 'deleted-later@example.com',
    } as never);
    await service.deleteClient(companyId, existing.id);

    expect(await service.findDuplicates(companyId, { email: 'deleted-later@example.com' })).toEqual([]);
  });
});

describe('ClientsService#getClientById — backs GET /clients/:id', () => {
  let companyId: string;
  let otherCompanyId: string;
  let service: ClientsService;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'GetById Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000002',
        email: `getbyid-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;

    const otherCompany = await prisma.company.create({
      data: {
        name: 'GetById Other Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Other Street',
        postalCode: '00000',
        city: 'Otherville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000003',
        email: `getbyid-other-${Date.now()}@example.com`,
      },
    });
    otherCompanyId = otherCompany.id;

    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: otherCompanyId } }).catch(() => undefined);
  });

  it('resolves null for a client id belonging to ANOTHER company — the controller turns this into a 404', async () => {
    // The exact IDOR the duplicate-warning link's own `?view=<id>` opens up if this guard is ever
    // dropped: a client id learned from ONE company (e.g. guessed, or copied from a stale link) must
    // never resolve a record that belongs to a different one, whatever the caller's own active company
    // otherwise has visibility into.
    const foreign = await service.createClient(otherCompanyId, {
      name: 'Foreign GetById Client',
      address: 'Elsewhere',
      postalCode: '40000',
      city: 'Nice',
      country: 'France',
      currency: 'EUR',
      isActive: true,
    } as never);

    expect(await service.getClientById(companyId, foreign.id)).toBeNull();
  });

  it("resolves the client, with its party identifiers, when it belongs to the caller's own company", async () => {
    const own = await service.createClient(companyId, {
      name: 'Own GetById Client',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      currency: 'EUR',
      isActive: true,
      identifiers: [{ scheme: 'LEGAL_ID', value: '123456789' }],
    } as never);

    const found = await service.getClientById(companyId, own.id);
    expect(found?.id).toBe(own.id);
    expect(found?.partyIdentifiers.map((i) => i.scheme)).toContain('LEGAL_ID');
  });
});
