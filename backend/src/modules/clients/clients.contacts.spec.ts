/**
 * #415 ("several named contacts per client") - `ClientsService.createClient`/`editClientsInfo`'s own
 * contract for the `contacts` relation: real Prisma, `ClientsService` constructed directly (the same
 * "ClientsModule not importable under ts-jest" pattern every other spec in this directory already
 * uses - see `clients.vat-validation.spec.ts`'s own header). Covers the invariant
 * (`writeClientContacts`'s own header): zero, or exactly one primary; reassigning primary; deleting
 * the current primary (through a full `contacts` replace) promotes the next one, or leaves zero; the
 * back-compat flat-field path (`contacts` absent); and the derived read-only flat fields every other
 * reader in this codebase depends on.
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

const fakeVatValidator = { validate: vi.fn() } as unknown as VatValidationPort;

describe('ClientsService - contacts (#415)', () => {
  let companyId: string;
  let service: ClientsService;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Contacts Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000010',
        email: `contacts-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;
    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('creates a client with zero contacts - a valid, intentional state', async () => {
    const client = await service.createClient(companyId, {
      name: 'No Contact SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [],
    } as never);

    expect(client.contacts).toEqual([]);
    expect(client.contactEmail).toBeNull();
    expect(client.contactFirstname).toBeNull();
  });

  it('creates a client with several contacts, exactly one flagged primary (the first, when none is)', async () => {
    const client = await service.createClient(companyId, {
      name: 'Several Contacts SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [
        { firstName: 'Alice', email: 'alice@example.com' },
        { firstName: 'Bob', email: 'bob@example.com' },
      ],
    } as never);

    expect(client.contacts).toHaveLength(2);
    const primaries = client.contacts.filter((c: { isPrimary: boolean }) => c.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].firstName).toBe('Alice');
    // Derived flat fields (#415) - resolved from whichever contact ends up primary.
    expect(client.contactFirstname).toBe('Alice');
    expect(client.contactEmail).toBe('alice@example.com');
  });

  it('honors an explicit isPrimary flag rather than always defaulting to the first entry', async () => {
    const client = await service.createClient(companyId, {
      name: 'Explicit Primary SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [
        { firstName: 'Alice', email: 'alice2@example.com' },
        { firstName: 'Bob', email: 'bob2@example.com', isPrimary: true },
        { firstName: 'Chloe', email: 'chloe2@example.com' },
      ],
    } as never);

    expect(client.contactFirstname).toBe('Bob');
    const primaries = client.contacts.filter((c: { isPrimary: boolean }) => c.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].firstName).toBe('Bob');
  });

  it('reassigning primary on edit: flagging another unflags the previous - never two at once', async () => {
    const created = await service.createClient(companyId, {
      name: 'Reassign Primary SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [
        { firstName: 'Alice', email: 'alice3@example.com', isPrimary: true },
        { firstName: 'Bob', email: 'bob3@example.com' },
      ],
    } as never);
    expect(created.contactFirstname).toBe('Alice');

    const edited = await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Reassign Primary SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [
        { firstName: 'Alice', email: 'alice3@example.com' },
        { firstName: 'Bob', email: 'bob3@example.com', isPrimary: true },
      ],
    } as never);

    expect(edited?.contactFirstname).toBe('Bob');
    const primaryRows = await prisma.clientContact.findMany({
      where: { clientId: created.id, isPrimary: true },
    });
    expect(primaryRows).toHaveLength(1);
    expect(primaryRows[0].firstName).toBe('Bob');
  });

  it('removing every contact through an edit (contacts: []) leaves the client with zero, not an orphan primary', async () => {
    const created = await service.createClient(companyId, {
      name: 'Remove All Contacts SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [{ firstName: 'Alice', email: 'alice4@example.com' }],
    } as never);
    expect(created.contacts).toHaveLength(1);

    const edited = await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Remove All Contacts SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [],
    } as never);

    expect(edited?.contacts).toEqual([]);
    expect(edited?.contactEmail).toBeNull();
    const remaining = await prisma.clientContact.count({ where: { clientId: created.id } });
    expect(remaining).toBe(0);
  });

  it('deleting the current primary (by omitting it from a full replace) promotes the first of what remains', async () => {
    const created = await service.createClient(companyId, {
      name: 'Promote Next SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [
        { firstName: 'Alice', email: 'alice5@example.com', isPrimary: true },
        { firstName: 'Bob', email: 'bob5@example.com' },
      ],
    } as never);
    expect(created.contactFirstname).toBe('Alice');

    // The wizard's own contacts step always resends the FULL list - removing Alice means the
    // payload simply no longer contains her.
    const edited = await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Promote Next SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [{ firstName: 'Bob', email: 'bob5@example.com' }],
    } as never);

    expect(edited?.contacts).toHaveLength(1);
    expect(edited?.contactFirstname).toBe('Bob');
    expect(edited?.contacts[0].isPrimary).toBe(true);
  });

  it('back-compat: a legacy flat-field payload (no `contacts` key) creates/updates the primary contact only', async () => {
    const created = await service.createClient(companyId, {
      name: 'Legacy Flat SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contactEmail: 'legacy@example.com',
      contactPhone: '+33111111111',
    } as never);

    expect(created.contacts).toHaveLength(1);
    expect(created.contacts[0]).toMatchObject({
      email: 'legacy@example.com',
      phone: '+33111111111',
      isPrimary: true,
    });
    expect(created.contactEmail).toBe('legacy@example.com');

    const edited = await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Legacy Flat SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contactEmail: 'legacy-updated@example.com',
      contactPhone: '+33111111111',
    } as never);

    // Still ONE contact (updated in place), not a second row appended.
    expect(edited?.contacts).toHaveLength(1);
    expect(edited?.contactEmail).toBe('legacy-updated@example.com');
  });

  it('a plain edit that touches neither `contacts` nor any legacy flat field leaves contacts untouched', async () => {
    const created = await service.createClient(companyId, {
      name: 'Untouched Contacts SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [{ firstName: 'Alice', email: 'alice6@example.com' }],
    } as never);

    const edited = await service.editClientsInfo(companyId, {
      id: created.id,
      name: 'Untouched Contacts SARL Renamed',
      address: 'Somewhere Else',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
    } as never);

    expect(edited?.name).toBe('Untouched Contacts SARL Renamed');
    expect(edited?.contacts).toHaveLength(1);
    expect(edited?.contactFirstname).toBe('Alice');
  });
});
