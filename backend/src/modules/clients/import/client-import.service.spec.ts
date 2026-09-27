/**
 * `ClientImportService` constructed directly against the real test Postgres - same discipline
 * `clients.identifier-pattern.spec.ts` already holds for the same reason (`ClientsModule` cannot be
 * imported under ts-jest). Covers the parity claims the issue calls out explicitly: a FR row missing
 * its required identifier is rejected with the same message the wizard would show, a pattern
 * mismatch is rejected likewise, duplicates (existing AND within-file) are detected without one query
 * per row, the row cap is enforced, and a forced mid-transaction failure leaves zero rows created.
 */
import { vi } from 'vitest';

vi.mock('../../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: vi.fn(),
}));

import { ClientImportService } from './client-import.service';
import { WebhookDispatcherService } from '../../webhooks/webhook-dispatcher.service';
import { VatValidationPort } from '../../documents/tax/vat-validation';
import { seedCountryIdentifierRequirements } from '../../documents/country-identifiers/seed';
import prisma from '@/prisma/prisma.service';
import { ClientImportRow, MAX_IMPORT_ROWS } from './client-import.types';

const fakeWebhookDispatcher = {
  dispatch: vi.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

const fakeVatValidator: VatValidationPort = {
  validate: vi.fn().mockResolvedValue({ status: 'VALID', checkedAt: new Date(), source: 'eu-vies' }),
};

async function createTestCompany(suffix: string) {
  return prisma.company.create({
    data: {
      name: `Import Test Co ${suffix}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 Test Street',
      postalCode: '75001',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+330000000000',
      email: `import-test-${suffix}-${Date.now()}-${Math.random()}@example.com`,
    },
  });
}

function frRow(overrides: Partial<ClientImportRow> = {}): ClientImportRow {
  return {
    rowNumber: 2,
    type: 'COMPANY',
    name: 'Acme SARL',
    address: '12 rue de la Paix',
    postalCode: '75002',
    city: 'Paris',
    country: 'France',
    countryCode: 'FR',
    currency: 'EUR',
    identifiers: [{ scheme: 'LEGAL_ID', value: '552100554' }],
    ...overrides,
  };
}

describe('ClientImportService', () => {
  let service: ClientImportService;
  let companyId: string;

  beforeAll(async () => {
    await seedCountryIdentifierRequirements(prisma);
    service = new ClientImportService(fakeWebhookDispatcher, fakeVatValidator);
  });

  beforeEach(async () => {
    const company = await createTestCompany(Math.random().toString(36).slice(2));
    companyId = company.id;
  });

  afterEach(async () => {
    await prisma.partyIdentifier.deleteMany({ where: { client: { companyId } } });
    await prisma.client.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  describe('required identifiers - form/import parity', () => {
    it('rejects a FR company row missing its required LEGAL_ID, same as the wizard would', async () => {
      const row = frRow({ identifiers: undefined });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => /SIREN|SIRET/.test(m))).toBe(true);
    });

    it('rejects a row whose LEGAL_ID fails the FR pattern', async () => {
      const row = frRow({ identifiers: [{ scheme: 'LEGAL_ID', value: 'abc' }] });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
    });

    it('accepts a well-formed FR row', async () => {
      const result = await service.preview(companyId, [frRow()]);
      expect(result.rows[0].status).toBe('valid');
      expect(result.summary.willCreate).toBe(1);
    });
  });

  describe('name/type checks (server authority, matching assertClientCreatable)', () => {
    it('rejects an INDIVIDUAL row with no first/last name', async () => {
      const row = frRow({ type: 'INDIVIDUAL', name: undefined, identifiers: undefined });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => /first name/i.test(m))).toBe(true);
    });
  });

  describe('duplicate detection', () => {
    it('flags a row matching an existing active client by email', async () => {
      await prisma.client.create({
        data: {
          companyId,
          type: 'COMPANY',
          name: 'Existing Co',
          // #415: the primary contact's own email, not a `Client` column any more.
          contacts: { create: { email: 'Billing@Existing.example', isPrimary: true, position: 0 } },
          address: 'a',
          postalCode: '75000',
          city: 'Paris',
          country: 'France',
          countryCode: 'FR',
          currency: 'EUR',
        },
      });
      const row = frRow({ contactEmail: 'billing@existing.example' });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('duplicate');
      expect(result.rows[0].duplicateOf?.name).toBe('Existing Co');
      expect(result.rows[0].duplicateOf?.kind).toBe('existing');
      expect(result.rows[0].duplicateOf?.matchedOn).toBe('email');
    });

    it('flags a row matching an existing client by name+country (case-insensitive)', async () => {
      await prisma.client.create({
        data: {
          companyId,
          type: 'COMPANY',
          name: 'Acme SARL',
          address: 'a',
          postalCode: '75000',
          city: 'Paris',
          country: 'France',
          countryCode: 'FR',
          currency: 'EUR',
        },
      });
      const row = frRow({ name: 'acme sarl', contactEmail: undefined });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('duplicate');
      expect(result.rows[0].duplicateOf?.kind).toBe('existing');
      expect(result.rows[0].duplicateOf?.matchedOn).toBe('name_country');
    });

    it('flags the SECOND occurrence within the same file as the duplicate', async () => {
      const first = frRow({ rowNumber: 2 });
      const second = frRow({ rowNumber: 3, identifiers: [{ scheme: 'LEGAL_ID', value: '552100554' }] });
      const result = await service.preview(companyId, [first, second]);
      expect(result.rows.find((r) => r.rowNumber === 2)?.status).toBe('valid');
      const duplicateRow = result.rows.find((r) => r.rowNumber === 3);
      expect(duplicateRow?.status).toBe('duplicate');
      expect(duplicateRow?.duplicateOf?.kind).toBe('file');
      expect(duplicateRow?.duplicateOf?.matchedOn).toBe('name_country');
      expect(duplicateRow?.duplicateOf?.rowNumber).toBe(2);
    });

    it('uses contactFirstname+contactLastname as the identity for an INDIVIDUAL (empty name)', async () => {
      const first: ClientImportRow = {
        rowNumber: 2,
        type: 'INDIVIDUAL',
        contactFirstname: 'Jean',
        contactLastname: 'Dupont',
        address: 'a',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        currency: 'EUR',
        // FR's LEGAL_ID applies to BOTH party types (see fr.json) - required here too, or this row
        // would be REJECTED before the duplicate rule is ever reached, defeating this test's point.
        identifiers: [{ scheme: 'LEGAL_ID', value: '552100554' }],
      };
      const second: ClientImportRow = { ...first, rowNumber: 3 };
      const result = await service.preview(companyId, [first, second]);
      expect(result.rows.find((r) => r.rowNumber === 3)?.status).toBe('duplicate');
    });
  });

  describe('country resolution (name/code drift)', () => {
    it('resolves a country NAME only ("France", no countryCode) and enforces FR requirements', async () => {
      // This is the exact case the wizard can never produce: `CountrySelect` always fires
      // `onCountryCodeChange` alongside the name, so a client with a `country` and a null
      // `countryCode` never exists in this codebase except through an import. Before this row's own
      // country was resolved to an ISO code before the required-identifiers lookup, this row (no
      // LEGAL_ID) was silently ACCEPTED - the lookup asked the catalog for `countryCode: undefined`,
      // found nothing, and enforced nothing. It must now be rejected for the SAME reason the FR row
      // in "required identifiers" above is.
      const row = frRow({ countryCode: undefined, identifiers: undefined });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => /SIREN|SIRET/.test(m))).toBe(true);
    });

    it('resolves a country CODE only (countryCode=FR, no country name)', async () => {
      const row = frRow({ country: undefined, identifiers: undefined });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => /SIREN|SIRET/.test(m))).toBe(true);
    });

    it('accepts when BOTH country and countryCode are given and agree', async () => {
      const result = await service.preview(companyId, [frRow()]);
      expect(result.rows[0].status).toBe('valid');
    });

    it('rejects when country and countryCode disagree', async () => {
      const row = frRow({ country: 'Germany', countryCode: 'FR' });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => /do not match/i.test(m))).toBe(true);
    });

    it('rejects an unresolvable country name, naming it', async () => {
      const row = frRow({ country: 'Frnace', countryCode: undefined, identifiers: undefined });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => m.includes('Unknown country: "Frnace"'))).toBe(true);
    });

    it('rejects a row with neither country nor countryCode', async () => {
      const row = frRow({ country: undefined, countryCode: undefined });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => /country is required/i.test(m))).toBe(true);
    });

    it('confirm stores the RESOLVED ISO code, never null, for a country-name-only row', async () => {
      const row = frRow({ countryCode: undefined, name: 'Name Only Country Co' });
      const result = await service.confirm(companyId, [row]);
      expect(result.created).toBe(1);
      const created = await prisma.client.findFirst({ where: { companyId, name: 'Name Only Country Co' } });
      expect(created?.countryCode).toBe('FR');
      expect(created?.country).toBe('France');
    });
  });

  describe('closed-set columns (never silently coerced)', () => {
    it('rejects an unknown currency instead of silently defaulting', async () => {
      const row = frRow({ currency: 'ZZZ' });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => m.includes('Unknown currency: "ZZZ"'))).toBe(true);
    });

    it('leaves currency unset (never a silent EUR default) when the cell is empty', async () => {
      const row = frRow({ currency: undefined, name: 'No Currency Co' });
      const result = await service.confirm(companyId, [row]);
      expect(result.created).toBe(1);
      const created = await prisma.client.findFirst({ where: { companyId, name: 'No Currency Co' } });
      expect(created?.currency).toBeNull();
    });

    it('rejects an unknown type value rather than silently defaulting to COMPANY', async () => {
      const row = frRow({ type: 'Individuel' as any });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => m.includes('Unknown type: "Individuel"'))).toBe(true);
    });

    it('rejects an unknown kind value', async () => {
      const row = frRow({ kind: 'Public' as any });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => m.includes('Unknown kind: "Public"'))).toBe(true);
    });

    it('rejects a foundedAt value that is not YYYY-MM-DD', async () => {
      const row = frRow({ foundedAt: '25/09/2020' });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => m.includes('Invalid date: "25/09/2020"'))).toBe(true);
    });

    it('rejects a calendar-invalid foundedAt value', async () => {
      const row = frRow({ foundedAt: '2020-13-40' });
      const result = await service.preview(companyId, [row]);
      expect(result.rows[0].status).toBe('rejected');
      expect(result.rows[0].errors?.some((m) => m.includes('Invalid date: "2020-13-40"'))).toBe(true);
    });
  });

  describe('caps', () => {
    it('refuses a file over MAX_IMPORT_ROWS', async () => {
      const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => frRow({ rowNumber: i + 2 }));
      await expect(service.preview(companyId, rows)).rejects.toThrow(/row limit/);
    });

    it('refuses an empty file', async () => {
      await expect(service.preview(companyId, [])).rejects.toThrow(/no data rows/);
    });
  });

  describe('confirm - all or nothing', () => {
    it('creates every valid row in one transaction', async () => {
      const rows = [frRow({ rowNumber: 2, name: 'Row Two' }), frRow({ rowNumber: 3, name: 'Row Three' })];
      const result = await service.confirm(companyId, rows);
      expect(result.created).toBe(2);
      const created = await prisma.client.findMany({ where: { companyId } });
      expect(created).toHaveLength(2);
    });

    it('leaves ZERO rows created when one row fails mid-transaction', async () => {
      // Both rows pass every PREVIEW-time check (`assertClientCreatable` never checks for a DUPLICATE
      // scheme within one row's own identifiers array, and VAT's required-ness for FR is `false`), so
      // the transaction loop actually attempts to create both - the second row's two `VAT` entries
      // then collide on `PartyIdentifier`'s own `@@unique([clientId, scheme])` at insert time, a
      // genuine DB-level failure, not a mocked one, so the transaction's own rollback is what is
      // actually under test rather than a stubbed throw.
      const rows: ClientImportRow[] = [
        frRow({ rowNumber: 2, name: 'Row Two' }),
        frRow({
          rowNumber: 3,
          name: 'Row Three',
          identifiers: [
            { scheme: 'LEGAL_ID', value: '552100554' },
            { scheme: 'VAT', value: 'FR12345678901' },
            { scheme: 'VAT', value: 'FR98765432109' },
          ],
        }),
      ];
      await expect(service.confirm(companyId, rows)).rejects.toThrow();
      const created = await prisma.client.findMany({ where: { companyId } });
      expect(created).toHaveLength(0);
    });
  });

  // #415: the CSV import's four contact columns still mean "the primary contact" - a row's
  // contactFirstname/contactLastname/contactEmail/contactPhone become ONE `ClientContact` row,
  // flagged primary, never a legacy `Client` column (which no longer exists).
  describe('primary contact created from the row (#415)', () => {
    it("creates a primary ClientContact from a COMPANY row's four contact columns", async () => {
      const row = frRow({
        name: 'Contact Import SARL',
        contactEmail: 'import-contact@example.com',
        contactPhone: '+33102030405',
      });
      const result = await service.confirm(companyId, [row]);
      expect(result.created).toBe(1);

      const client = await prisma.client.findFirstOrThrow({
        where: { companyId, name: 'Contact Import SARL' },
        include: { contacts: true },
      });
      expect(client.contacts).toHaveLength(1);
      expect(client.contacts[0]).toMatchObject({
        firstName: null,
        lastName: null,
        email: 'import-contact@example.com',
        phone: '+33102030405',
        isPrimary: true,
        position: 0,
      });
    });

    it('creates a primary ClientContact carrying first/last name for an INDIVIDUAL row', async () => {
      const row = frRow({
        type: 'INDIVIDUAL',
        name: undefined,
        contactFirstname: 'Jean',
        contactLastname: 'Dupont',
        contactEmail: 'jean.dupont@example.com',
      });
      const result = await service.confirm(companyId, [row]);
      expect(result.created).toBe(1);

      const client = await prisma.client.findFirstOrThrow({
        where: { companyId, type: 'INDIVIDUAL', name: '' },
        include: { contacts: true },
      });
      expect(client.contacts).toHaveLength(1);
      expect(client.contacts[0]).toMatchObject({
        firstName: 'Jean',
        lastName: 'Dupont',
        email: 'jean.dupont@example.com',
        isPrimary: true,
      });
    });

    it('creates NO contact row at all when the file has none of the four columns filled in', async () => {
      const row = frRow({ name: 'No Contact At All SARL' });
      const result = await service.confirm(companyId, [row]);
      expect(result.created).toBe(1);

      const client = await prisma.client.findFirstOrThrow({
        where: { companyId, name: 'No Contact At All SARL' },
        include: { contacts: true },
      });
      expect(client.contacts).toHaveLength(0);
    });

    it("the duplicate rule matches on the PRIMARY contact's email, exactly like the wizard", async () => {
      await service.confirm(companyId, [
        frRow({ name: 'Original Co', contactEmail: 'Shared@Example.com', rowNumber: 2 }),
      ]);

      const preview = await service.preview(companyId, [
        frRow({ name: 'Different Name Co', contactEmail: 'shared@example.com', rowNumber: 2 }),
      ]);
      expect(preview.rows[0].status).toBe('duplicate');
      expect(preview.rows[0].duplicateOf?.matchedOn).toBe('email');
    });
  });
});
