/**
 * Issue #340 - "declare your last number issued", REAL Postgres. `CompanyService` constructed
 * directly, same posture as `company.service.spec.ts`'s own header (no module, no mocks besides the
 * webhook dispatcher, which this feature never touches).
 */
import { vi } from 'vitest';

vi.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: vi.fn(),
}));

import { BadRequestException, ConflictException } from '@nestjs/common';
import { CompanyService } from './company.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: vi.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

async function createTestCompany(countryCode: string, country: string) {
  return prisma.company.create({
    data: {
      name: `Declare last number ${countryCode} ${Date.now()}-${Math.random()}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 Test Street',
      postalCode: '00000',
      city: 'Testville',
      country,
      countryCode,
      phone: '+10000000000',
      email: `declare-last-number-340-${Date.now()}-${Math.random()}@example.com`,
    },
  });
}

describe('CompanyService - declare last number issued (issue #340, real Postgres)', () => {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

  let service: CompanyService;
  let companyId: string;

  beforeAll(() => {
    service = new CompanyService(fakeWebhookDispatcher);
  });

  afterEach(async () => {
    if (companyId) await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('infers a pattern from an example number', () => {
    const result = service.inferLastNumberPattern({
      typeId: 'invoice',
      lastNumber: 'FA-2024-0142',
      lastIssueDate: '2024-06-01',
    });
    expect(result.pattern).toBe('FA-{year}-{number:4}');
  });

  it('France: a pattern that satisfies the country constraints becomes the running series, counter resumes at last+1', async () => {
    const company = await createTestCompany('FR', 'France');
    companyId = company.id;

    const result = await service.declareLastNumberIssued(companyId, {
      typeId: 'invoice',
      lastNumber: 'FAC-2024-0099',
      lastIssueDate: '2024-06-01',
      pattern: 'FAC-{year}-{number:4}',
    });

    expect(result.source).toBe('running-series');
    expect(result.pattern).toBe('FAC-{year}-{number:4}');
    expect(result.nextNumber).toBe(100);
    expect(result.violations).toBeNull();

    const updated = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect((updated.numberFormats as Record<string, unknown>).invoice).toBe('FAC-{year}-{number:4}');

    const row = await prisma.documentNumberSequence.findFirstOrThrow({
      where: { companyId, typeId: 'invoice' },
    });
    expect(row.nextNumber).toBe(100);
  });

  it('Italy: a pattern that breaks a country constraint (over 20 chars) does NOT become the running series, but the counter still continues at last+1', async () => {
    const company = await createTestCompany('IT', 'Italy');
    companyId = company.id;

    const overlong = 'FATTURA-VECCHIA-SOFTWARE-{year}-{number:4}'; // renders well over FatturaPA's 20 chars
    const result = await service.declareLastNumberIssued(companyId, {
      typeId: 'invoice',
      lastNumber: 'FATTURA-VECCHIA-SOFTWARE-2024-0055',
      lastIssueDate: '2024-06-01',
      pattern: overlong,
    });

    expect(result.source).toBe('country-policy');
    expect(result.violations).not.toBeNull();
    expect(result.violations!.length).toBeGreaterThan(0);
    expect(result.nextNumber).toBe(56);

    const updated = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(updated.numberFormats).toBeNull();

    const row = await prisma.documentNumberSequence.findFirstOrThrow({
      where: { companyId, typeId: 'invoice' },
    });
    expect(row.nextNumber).toBe(56);
  });

  it('refuses a pattern that does not reproduce the declared number', async () => {
    const company = await createTestCompany('FR', 'France');
    companyId = company.id;

    await expect(
      service.declareLastNumberIssued(companyId, {
        typeId: 'invoice',
        lastNumber: 'FAC-2024-0099',
        lastIssueDate: '2024-06-01',
        pattern: 'INV-{year}-{number:4}', // wrong prefix - "INV-2024-0099" != "FAC-2024-0099"
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses once numbering has already started for this type', async () => {
    const company = await createTestCompany('FR', 'France');
    companyId = company.id;
    await prisma.documentNumberSequence.create({
      data: { companyId, typeId: 'invoice', year: 0, nextNumber: 2 },
    });

    await expect(
      service.declareLastNumberIssued(companyId, {
        typeId: 'invoice',
        lastNumber: 'FAC-2024-0099',
        lastIssueDate: '2024-06-01',
        pattern: 'FAC-{year}-{number:4}',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('Portugal: never resumes the previous series - opens the plain default "A" when the old tool used a DIFFERENT identifier', async () => {
    const company = await createTestCompany('PT', 'Portugal');
    companyId = company.id;

    const result = await service.declareLastNumberIssued(companyId, {
      typeId: 'invoice',
      lastNumber: 'FT B/234', // previous tool used identifier "B", never "A"
      lastIssueDate: '2024-06-01',
      pattern: 'ignored for Portugal',
    });

    expect(result.pattern).toBe('FT A/{number}');
    expect(result.atcudSeriesToRegister).toBe('A');
    expect(result.nextNumber).toBe(235);
    expect(result.source).toBe('country-policy'); // equals the shipped default, nothing to remember

    const updated = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(updated.numberFormats).toBeNull();
  });

  it('Portugal: the fallback identifier is dated ("A2026") when the old tool already used "A"', async () => {
    const company = await createTestCompany('PT', 'Portugal');
    companyId = company.id;

    const result = await service.declareLastNumberIssued(companyId, {
      typeId: 'invoice',
      lastNumber: 'FT A/234', // previous tool ALREADY used "A" - can never be reused (AT FAQ 4319)
      lastIssueDate: '2026-06-01',
      pattern: 'ignored for Portugal',
    });

    expect(result.pattern).toBe('FT A2026/{number}');
    expect(result.atcudSeriesToRegister).toBe('A2026');
    expect(result.nextNumber).toBe(235);
    expect(result.source).toBe('running-series');

    const updated = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect((updated.numberFormats as Record<string, unknown>).invoice).toBe('FT A2026/{number}');
  });

  it('Portugal credit note: the "NC" prefix is used, independent of the invoice series', async () => {
    const company = await createTestCompany('PT', 'Portugal');
    companyId = company.id;

    const result = await service.declareLastNumberIssued(companyId, {
      typeId: 'credit-note',
      lastNumber: 'NC A/12',
      lastIssueDate: '2026-06-01',
      pattern: 'ignored for Portugal',
    });

    expect(result.pattern).toBe('NC A2026/{number}');
    expect(result.nextNumber).toBe(13);
  });
});
