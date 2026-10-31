/**
 * The `contacts` relation's contract: zero or exactly one primary, reassignment, promotion after a
 * deletion, the back-compat flat-field path, and the derived flat fields readers depend on.
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

describe('ClientsService - contacts', () => {
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
    // Derived flat fields, resolved from whichever contact ends up primary.
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

  // The wizard resends its blank starter row; the API must drop it rather than store an empty
  // primary, exactly like the migration's backfill and the CSV import.
  it('drops an all-blank contact row rather than creating it as an empty primary', async () => {
    const client = await service.createClient(companyId, {
      name: 'Blank Contact Row SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [{ firstName: '', lastName: '', role: '', email: '', phone: '', isPrimary: true }],
    } as never);

    expect(client.contacts).toEqual([]);
    expect(client.contactEmail).toBeNull();
    const remaining = await prisma.clientContact.count({ where: { clientId: client.id } });
    expect(remaining).toBe(0);
  });

  it('drops only the blank entries, keeping the non-blank ones - a blank flagged primary falls through to the first survivor', async () => {
    const client = await service.createClient(companyId, {
      name: 'Mixed Blank Contacts SARL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [
        // Whitespace-only, not merely empty string - the same "nothing really typed here" state.
        { firstName: '  ', lastName: '', role: '', email: '   ', phone: '', isPrimary: true },
        { firstName: 'Real', lastName: 'Contact', email: 'real@example.com' },
      ],
    } as never);

    expect(client.contacts).toHaveLength(1);
    expect(client.contacts[0]).toMatchObject({ firstName: 'Real', lastName: 'Contact', isPrimary: true });
    expect(client.contactEmail).toBe('real@example.com');
  });

  // A COMPANY client created through the legacy flat names must ignore them, never store them as
  // the primary contact's name.
  it('ignores legacy contactFirstname/contactLastname on a COMPANY client create (no `contacts` sent)', async () => {
    const client = await service.createClient(companyId, {
      name: 'Legacy Names Ignored SARL',
      type: 'COMPANY',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contactFirstname: 'Should',
      contactLastname: 'BeIgnored',
      contactEmail: 'legacy-names@example.com',
    } as never);

    expect(client.contacts).toHaveLength(1);
    expect(client.contacts[0].firstName).toBeNull();
    expect(client.contacts[0].lastName).toBeNull();
    expect(client.contacts[0].email).toBe('legacy-names@example.com');
    expect(client.contactFirstname).toBeNull();
    expect(client.contactLastname).toBeNull();
  });

  // For an INDIVIDUAL client the primary contact is the identity-step person; another row flagged
  // primary under a different name must be refused, never silently rename the client.
  describe('INDIVIDUAL identity vs. primary contact', () => {
    it('rejects flagging a non-identity contact row primary on CREATE', async () => {
      await expect(
        service.createClient(companyId, {
          type: 'INDIVIDUAL',
          contactFirstname: 'Jean',
          contactLastname: 'Dupont',
          address: 'Somewhere',
          postalCode: '10000',
          city: 'Paris',
          country: 'France',
          currency: 'EUR',
          isActive: true,
          contacts: [
            { firstName: 'Jean', lastName: 'Dupont', isPrimary: false },
            { firstName: 'Marie', lastName: 'Curie', isPrimary: true },
          ],
        } as never),
      ).rejects.toThrow(
        'The primary contact of an individual client must be the person on the identity step',
      );

      // Nothing was written - the rejection happens before the transaction opens.
      const count = await prisma.client.count({ where: { companyId, name: '' } });
      expect(count).toBe(0);
    });

    it('rejects flagging a non-identity contact row primary on EDIT, and never rewrites that row', async () => {
      const created = await service.createClient(companyId, {
        type: 'INDIVIDUAL',
        contactFirstname: 'Jean',
        contactLastname: 'Dupont',
        address: 'Somewhere',
        postalCode: '10000',
        city: 'Paris',
        country: 'France',
        currency: 'EUR',
        isActive: true,
        contacts: [
          { firstName: 'Jean', lastName: 'Dupont', isPrimary: true },
          { firstName: 'Marie', lastName: 'Curie' },
        ],
      } as never);
      expect(created.contactFirstname).toBe('Jean');

      await expect(
        service.editClientsInfo(companyId, {
          id: created.id,
          type: 'INDIVIDUAL',
          contactFirstname: 'Jean',
          contactLastname: 'Dupont',
          address: 'Somewhere',
          postalCode: '10000',
          city: 'Paris',
          country: 'France',
          currency: 'EUR',
          isActive: true,
          contacts: [
            { firstName: 'Jean', lastName: 'Dupont', isPrimary: false },
            { firstName: 'Marie', lastName: 'Curie', isPrimary: true },
          ],
        } as never),
      ).rejects.toThrow(
        'The primary contact of an individual client must be the person on the identity step',
      );

      // Marie's own row was never rewritten - the rejection happens before the write transaction.
      const marie = await prisma.clientContact.findFirst({
        where: { clientId: created.id, firstName: 'Marie' },
      });
      expect(marie).toMatchObject({ firstName: 'Marie', lastName: 'Curie', isPrimary: false });
      const jean = await prisma.clientContact.findFirst({
        where: { clientId: created.id, firstName: 'Jean' },
      });
      expect(jean).toMatchObject({ firstName: 'Jean', lastName: 'Dupont', isPrimary: true });
    });

    it('accepts flagging the identity-matching row primary (a no-op re-flag)', async () => {
      const created = await service.createClient(companyId, {
        type: 'INDIVIDUAL',
        contactFirstname: 'Ada',
        contactLastname: 'Lovelace',
        address: 'Somewhere',
        postalCode: '10000',
        city: 'Paris',
        country: 'France',
        currency: 'EUR',
        isActive: true,
        contacts: [{ firstName: 'Ada', lastName: 'Lovelace', isPrimary: true }],
      } as never);

      const edited = await service.editClientsInfo(companyId, {
        id: created.id,
        type: 'INDIVIDUAL',
        contactFirstname: 'Ada',
        contactLastname: 'Lovelace',
        address: 'Somewhere',
        postalCode: '10000',
        city: 'Paris',
        country: 'France',
        currency: 'EUR',
        isActive: true,
        contacts: [{ firstName: 'Ada', lastName: 'Lovelace', isPrimary: true, role: 'Engineer' }],
      } as never);

      expect(edited?.contactFirstname).toBe('Ada');
      expect(edited?.contacts[0]).toMatchObject({ role: 'Engineer' });
    });
  });

  // Validation and the write must resolve the same primary out of a raw contacts array, or a
  // payload the write accepts is rejected by validation.
  it('validation and write agree on the primary contact - a blank row flagged primary falls through to the real one', async () => {
    const client = await service.createClient(companyId, {
      type: 'INDIVIDUAL',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
      contacts: [{ isPrimary: true }, { firstName: 'Jean', lastName: 'Dupont' }],
    } as never);

    expect(client.contacts).toHaveLength(1);
    expect(client.contacts[0]).toMatchObject({ firstName: 'Jean', lastName: 'Dupont', isPrimary: true });
    expect(client.contactFirstname).toBe('Jean');
  });

  describe('legacy four-field call clearing the contact', () => {
    const base = {
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Paris',
      country: 'France',
      currency: 'EUR',
      isActive: true,
    };
    const clearAll = { contactFirstname: '', contactLastname: '', contactEmail: '', contactPhone: '' };

    it('removes the primary contact instead of storing an empty one', async () => {
      const created = await service.createClient(companyId, {
        name: 'Legacy Clear SARL',
        ...base,
        contactFirstname: 'Lea',
        contactEmail: 'lea@example.com',
      } as never);
      expect(created.contacts).toHaveLength(1);

      const edited = await service.editClientsInfo(companyId, {
        id: created.id,
        name: 'Legacy Clear SARL',
        ...base,
        ...clearAll,
      } as never);

      expect(edited?.contacts).toEqual([]);
      expect(edited?.contactFirstname).toBeNull();
      expect(edited?.contactEmail).toBeNull();
      expect(await prisma.clientContact.count({ where: { clientId: created.id } })).toBe(0);
    });

    it('promotes the next contact when the cleared primary was not the only one', async () => {
      const created = await service.createClient(companyId, {
        name: 'Legacy Clear Promote SARL',
        ...base,
        contacts: [
          { firstName: 'Primary', email: 'p@example.com', isPrimary: true },
          { firstName: 'Second', email: 's@example.com' },
          { firstName: 'Third', email: 't@example.com' },
        ],
      } as never);

      const edited = await service.editClientsInfo(companyId, {
        id: created.id,
        name: 'Legacy Clear Promote SARL',
        ...base,
        ...clearAll,
      } as never);

      expect(edited?.contacts.map((c: { firstName: string }) => c.firstName)).toEqual(['Second', 'Third']);
      expect(edited?.contactFirstname).toBe('Second');
      const primaries = await prisma.clientContact.findMany({
        where: { clientId: created.id, isPrimary: true },
      });
      expect(primaries).toHaveLength(1);
      expect(primaries[0].firstName).toBe('Second');
    });

    it('keeps the contact when only some fields are cleared, or when it still carries a role', async () => {
      const created = await service.createClient(companyId, {
        name: 'Legacy Partial Clear SARL',
        ...base,
        contacts: [{ firstName: 'Rolf', role: 'Accountant', phone: '+33122222222' }],
      } as never);

      const phoneOnly = await service.editClientsInfo(companyId, {
        id: created.id,
        name: 'Legacy Partial Clear SARL',
        ...base,
        contactPhone: '',
      } as never);
      expect(phoneOnly?.contacts).toHaveLength(1);
      expect(phoneOnly?.contacts[0]).toMatchObject({ firstName: 'Rolf', phone: null });

      // `role` is invisible to a legacy caller, so clearing its four fields leaves a contact that
      // still says something: not empty, kept.
      const roleLeft = await service.editClientsInfo(companyId, {
        id: created.id,
        name: 'Legacy Partial Clear SARL',
        ...base,
        ...clearAll,
      } as never);
      expect(roleLeft?.contacts).toHaveLength(1);
      expect(roleLeft?.contacts[0]).toMatchObject({ role: 'Accountant', firstName: null, isPrimary: true });
    });
  });
});
