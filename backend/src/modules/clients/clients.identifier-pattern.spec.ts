/**
 * `ClientsService` constructed DIRECTLY, real Prisma — same discipline as
 * `clients.vat-validation.spec.ts`'s own header (`ClientsModule` cannot be imported under ts-jest;
 * see that file's header for the full reasoning).
 *
 * Reproduces the measured defect from a cold start: `country-identifiers/data/it.json` declares
 * `IT_SDI` with `pattern: "^[A-Za-z0-9]{7}$"`, but nothing enforced it — a 3-character value was
 * accepted and stored, and `formats/national/fatturapa-provider.ts`'s own, independent
 * `/^[A-Za-z0-9]{7}$/` check would then fail it at send time, falling through to
 * `CodiceDestinatario: 'XXXXXXX'` (see that provider's own header and
 * `fatturapa-provider.spec.ts`'s "Italian recipient codes" describe block for the routing itself,
 * already covered there). This file closes the gap one layer up: the WRITE path itself now refuses
 * before a bad value ever reaches the database.
 *
 * `seedCountryIdentifierRequirements` is run once, for real, against whatever `DATABASE_URL` this
 * test run resolves — the exact reseed `CountryIdentifierRequirementsBootReseedService` performs on
 * every real boot (this suite never boots the whole Nest app, so nothing else would run it here).
 * Idempotent and additive-relative-to-code, not additive-relative-to-fixtures: safe to run
 * unconditionally.
 */

import { vi } from 'vitest';

vi.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: vi.fn(),
}));

import { BadRequestException } from '@nestjs/common';

import { ClientsService } from './clients.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { VatValidationPort } from '../documents/tax/vat-validation';
import { seedCountryIdentifierRequirements } from '../documents/country-identifiers/seed';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: vi.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

const fakeVatValidator: VatValidationPort = {
  validate: vi.fn().mockResolvedValue({ status: 'VALID', checkedAt: new Date(), source: 'eu-vies' }),
};

async function createTestCompany() {
  return prisma.company.create({
    data: {
      name: 'IT Identifier Pattern Co',
      foundedAt: new Date('2020-01-01'),
      address: '1 Test Street',
      postalCode: '00100',
      city: 'Roma',
      country: 'Italy',
      countryCode: 'IT',
      phone: '+390000000000',
      email: `it-identifier-pattern-${Date.now()}-${Math.random()}@example.com`,
    },
  });
}

describe('ClientsService — country-identifiers pattern enforcement', () => {
  let companyId: string;
  let service: ClientsService;

  beforeAll(async () => {
    // Brings CountryIdentifierRequirement to match data/*.json for real — see this file's header.
    await seedCountryIdentifierRequirements(prisma);
    const company = await createTestCompany();
    companyId = company.id;
    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('THE REPRODUCTION: a 3-character IT_SDI is refused, never stored — naming the scheme, the shape in words, and the value received', async () => {
    await expect(
      service.createClient(companyId, {
        name: 'Bianchi SpA',
        address: 'Corso Italia 20',
        postalCode: '00100',
        city: 'Roma',
        country: 'Italy',
        countryCode: 'IT',
        currency: 'EUR',
        isActive: true,
        identifiers: [{ scheme: 'IT_SDI', value: 'ABC' }], // 3 chars — the exact measured defect
      } as never),
    ).rejects.toThrow(BadRequestException);

    // Never stored: no orphan client, no orphan identifier either.
    const clients = await prisma.client.findMany({ where: { companyId, name: 'Bianchi SpA' } });
    expect(clients).toHaveLength(0);

    try {
      await service.createClient(companyId, {
        name: 'Bianchi SpA',
        address: 'Corso Italia 20',
        postalCode: '00100',
        city: 'Roma',
        country: 'Italy',
        countryCode: 'IT',
        currency: 'EUR',
        isActive: true,
        identifiers: [{ scheme: 'IT_SDI', value: 'ABC' }],
      } as never);
      throw new Error('expected a rejection');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('IT_SDI');
      expect(message).toMatch(/7-character/); // the shape, in words (this fact's own helpText)
      expect(message).not.toContain('[A-Za-z0-9]'); // never the raw regex
      expect(message).toContain('"ABC"');
    }
  });

  it('a valid 7-character IT_SDI is accepted and stored', async () => {
    const client = await service.createClient(companyId, {
      name: 'Verdi Srl',
      address: 'Via Dante 5',
      postalCode: '00100',
      city: 'Roma',
      country: 'Italy',
      countryCode: 'IT',
      currency: 'EUR',
      isActive: true,
      identifiers: [{ scheme: 'IT_SDI', value: 'ABCDEFG' }],
    } as never);

    const row = await prisma.partyIdentifier.findUnique({
      where: { clientId_scheme: { clientId: client.id, scheme: 'IT_SDI' } },
    });
    expect(row?.value).toBe('ABCDEFG');
  });

  it('DECISION 2 — an already-stored bad value survives an edit that does not touch it', async () => {
    // Created directly at the DB layer to simulate a legacy record predating this enforcement —
    // never through the service, which would (correctly) now refuse it.
    const client = await prisma.client.create({
      data: {
        companyId,
        name: 'Legacy Rossi Srl',
        address: 'Via Legacy 1',
        postalCode: '00100',
        city: 'Roma',
        country: 'Italy',
        countryCode: 'IT',
        currency: 'EUR',
        isActive: true,
        partyIdentifiers: { create: [{ scheme: 'IT_SDI', value: 'BAD' }] },
      },
    });

    const updated = await service.editClientsInfo(companyId, {
      id: client.id,
      name: 'Legacy Rossi Srl — renamed',
      address: 'Via Legacy 1',
      postalCode: '00100',
      city: 'Roma',
      country: 'Italy',
      countryCode: 'IT',
      currency: 'EUR',
      isActive: true,
      identifiers: [{ scheme: 'IT_SDI', value: 'BAD' }], // resubmitted UNCHANGED
    } as never);
    expect(updated.name).toBe('Legacy Rossi Srl — renamed');

    const row = await prisma.partyIdentifier.findUnique({
      where: { clientId_scheme: { clientId: client.id, scheme: 'IT_SDI' } },
    });
    expect(row?.value).toBe('BAD'); // untouched, not silently "fixed" or dropped either

    // But actually CHANGING it to a still-bad value is refused.
    await expect(
      service.editClientsInfo(companyId, {
        id: client.id,
        name: 'Legacy Rossi Srl — renamed',
        address: 'Via Legacy 1',
        postalCode: '00100',
        city: 'Roma',
        country: 'Italy',
        countryCode: 'IT',
        currency: 'EUR',
        isActive: true,
        identifiers: [{ scheme: 'IT_SDI', value: 'XYZ' }],
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('a scheme with no declared pattern (VAT) is never blocked by this mechanism — vat-syntax.ts owns it', async () => {
    const client = await service.createClient(companyId, {
      name: 'Any VAT Shape Srl',
      address: 'Via Roma 1',
      postalCode: '00100',
      city: 'Roma',
      country: 'Italy',
      countryCode: 'IT',
      currency: 'EUR',
      isActive: true,
      identifiers: [{ scheme: 'VAT', value: 'not-a-real-vat-number' }],
    } as never);
    expect(client).toBeDefined();
  });
});
