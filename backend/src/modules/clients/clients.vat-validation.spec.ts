/**
 * C4, restored — `ClientsService` constructed DIRECTLY (never `ClientsModule` as a module: see
 * TODO_ISSUES.md's own note, "ClientsModule inimportable sous ts-jest" — `WebhooksModule` pulls in
 * `@teever/ez-hook`, a pure-ESM package ts-jest cannot compile). Real Prisma (this file's own
 * `beforeAll`/`afterAll` create/delete a real company+client), a FAKE `VatValidationPort` (the real
 * VIES round-trip is `vat-validation.live.spec.ts`, gated `VIES_LIVE=1`).
 */
// `WebhookDispatcherService` → `WebhooksService` → `DiscordDriver` → `@teever/ez-hook` (a pure-ESM
// package ts-jest cannot compile) — see TODO_ISSUES.md's own "ClientsModule inimportable sous
// ts-jest" note. A FACTORY mock (never `jest.mock(path)` alone, which still has to load the REAL
// module to build its automock shape, hitting the same wall) avoids the chain entirely — `clients.
// service.ts` only ever calls `.dispatch(...)` on it, which this stub happily provides.
jest.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: jest.fn(),
}));

import { ClientsService } from './clients.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { VatValidationPort, VatValidationResult } from '../documents/tax/vat-validation';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: jest.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

function fakeVatValidator(result: VatValidationResult): VatValidationPort {
  return { validate: jest.fn().mockResolvedValue(result) };
}

describe('ClientsService — C4 VAT validation, wired for real', () => {
  let companyId: string;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'VAT Validation Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: `vat-validation-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('a syntactically INVALID VAT number is never even asked of VIES — persisted INVALID via syntax-check', async () => {
    const validator = fakeVatValidator({ status: 'VALID', checkedAt: new Date(), source: 'eu-vies' });
    const service = new ClientsService(fakeWebhookDispatcher, validator);

    const client = await service.createClient(companyId, {
      name: 'Broken VAT GmbH',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Berlin',
      country: 'Germany',
      countryCode: 'DE',
      currency: 'EUR',
      isActive: true,
      identifiers: [{ scheme: 'VAT', value: 'DE000000000' }], // fails the DE checksum
    } as never);

    expect(validator.validate).not.toHaveBeenCalled(); // never asked — the syntax gate refused first
    const row = await prisma.partyIdentifier.findUnique({
      where: { clientId_scheme: { clientId: client.id, scheme: 'VAT' } },
    });
    expect(row?.validationStatus).toBe('INVALID');
    expect(row?.validationSource).toBe('syntax-check');
  });

  it('a syntactically VALID VAT number is asked of VIES, and its verdict is persisted with a date and a source', async () => {
    const checkedAt = new Date('2026-08-30T12:00:00.000Z');
    const validator = fakeVatValidator({ status: 'VALID', checkedAt, source: 'eu-vies' });
    const service = new ClientsService(fakeWebhookDispatcher, validator);

    const client = await service.createClient(companyId, {
      name: 'Real VAT GmbH',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Berlin',
      country: 'Germany',
      countryCode: 'DE',
      currency: 'EUR',
      isActive: true,
      identifiers: [{ scheme: 'VAT', value: 'DE136695976' }], // checksum-valid, see vat-syntax.spec.ts
    } as never);

    expect(validator.validate).toHaveBeenCalledWith('DE', 'DE136695976');
    const row = await prisma.partyIdentifier.findUnique({
      where: { clientId_scheme: { clientId: client.id, scheme: 'VAT' } },
    });
    expect(row?.validationStatus).toBe('VALID');
    expect(row?.validationSource).toBe('eu-vies');
    expect(row?.validatedAt?.toISOString()).toBe(checkedAt.toISOString());
  });

  it('an UNAVAILABLE verdict (VIES down) is persisted honestly — never collapsed into INVALID', async () => {
    const validator = fakeVatValidator({ status: 'UNAVAILABLE', checkedAt: new Date(), source: 'eu-vies' });
    const service = new ClientsService(fakeWebhookDispatcher, validator);

    const client = await service.createClient(companyId, {
      name: 'Unlucky Timing GmbH',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Berlin',
      country: 'Germany',
      countryCode: 'DE',
      currency: 'EUR',
      isActive: true,
      identifiers: [{ scheme: 'VAT', value: 'DE136695976' }],
    } as never);

    const row = await prisma.partyIdentifier.findUnique({
      where: { clientId_scheme: { clientId: client.id, scheme: 'VAT' } },
    });
    expect(row?.validationStatus).toBe('UNAVAILABLE');
  });

  it('a changed VAT value invalidates the previous verdict and re-asks — a different number', async () => {
    const firstValidator = fakeVatValidator({ status: 'VALID', checkedAt: new Date(), source: 'eu-vies' });
    const service1 = new ClientsService(fakeWebhookDispatcher, firstValidator);
    const client = await service1.createClient(companyId, {
      name: 'Changing VAT GmbH',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Berlin',
      country: 'Germany',
      countryCode: 'DE',
      currency: 'EUR',
      isActive: true,
      identifiers: [{ scheme: 'VAT', value: 'DE136695976' }],
    } as never);

    const secondValidator = fakeVatValidator({ status: 'INVALID', checkedAt: new Date(), source: 'eu-vies' });
    const service2 = new ClientsService(fakeWebhookDispatcher, secondValidator);
    await service2.editClientsInfo(companyId, {
      id: client.id,
      name: 'Changing VAT GmbH',
      address: 'Somewhere',
      postalCode: '10000',
      city: 'Berlin',
      country: 'Germany',
      countryCode: 'DE',
      currency: 'EUR',
      isActive: true,
      identifiers: [{ scheme: 'VAT', value: 'DE111111125' }], // a DIFFERENT (also checksum-valid) number
    } as never);

    expect(secondValidator.validate).toHaveBeenCalled();
    const row = await prisma.partyIdentifier.findUnique({
      where: { clientId_scheme: { clientId: client.id, scheme: 'VAT' } },
    });
    expect(row?.value).toBe('DE111111125');
    expect(row?.validationStatus).toBe('INVALID');
  });
});
