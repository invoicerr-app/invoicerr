/**
 * `CompanyService` constructed DIRECTLY (never `CompanyModule` — same reason
 * `clients.vat-validation.spec.ts` gives for `ClientsService`), real Prisma against whatever
 * `DATABASE_URL` this test run resolves ("invoicerr_dev" in this repo's own dev setup — see
 * `.env`; jest never loads `.env.test`).
 *
 * Covers the mass-assignment close: there is no runtime request validation anywhere in this API (no
 * ValidationPipe, no class-validator — `EditCompanyDto` is a TypeScript `interface`, erased at
 * compile time), so before this fix `editCompanyInfo`'s `data: { ...rest }` would write ANY key a
 * caller named in the JSON body, including `Company.id`/`createdAt` and — directly relevant to
 * numbering - `numberFormats` itself, which since issue #496 holds the company's frozen running
 * series and must never be written by anyone. These tests prove `editCompanyInfo` writes only its
 * explicit allow-list, and that the one endpoint that used to write `numberFormats`
 * (`updateNumberFormat`) now refuses every change.
 */

import { vi } from 'vitest';

vi.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: vi.fn(),
}));

import { MethodNotAllowedException } from '@nestjs/common';
import { CompanyService } from './company.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: vi.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

async function createTestCompany(numberFormats?: Record<string, string>) {
  return prisma.company.create({
    data: {
      name: 'Mass Assignment Co',
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: `company-service-spec-${Date.now()}-${Math.random()}@example.com`,
      numberFormats: numberFormats ?? undefined,
    },
  });
}

describe('CompanyService — mass-assignment allow-list', () => {
  let service: CompanyService;

  beforeAll(() => {
    service = new CompanyService(fakeWebhookDispatcher);
  });

  it('writes an allow-listed field normally — the fix does not break ordinary edits', async () => {
    const company = await createTestCompany();
    try {
      const updated = await service.editCompanyInfo(company.id, {
        name: 'Renamed Co',
        currency: 'EUR',
        country: 'France',
      } as never);
      expect(updated.name).toBe('Renamed Co');
    } finally {
      await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    }
  });

  it('ignores `id` in the body instead of moving this record to a different primary key', async () => {
    const company = await createTestCompany();
    try {
      await service.editCompanyInfo(company.id, {
        name: 'Still Me',
        currency: 'EUR',
        country: 'France',
        id: 'some-other-company-id',
      } as never);

      // If `id` had been written, this row would no longer exist under its OWN id.
      const row = await prisma.company.findUnique({ where: { id: company.id } });
      expect(row).not.toBeNull();
      expect(row?.id).toBe(company.id);
      expect(await prisma.company.findUnique({ where: { id: 'some-other-company-id' } })).toBeNull();
    } finally {
      await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    }
  });

  it('ignores `createdAt` in the body — a column outside the allow-list, not merely unvalidated', async () => {
    const company = await createTestCompany();
    const spoofedDate = new Date('1999-01-01');
    try {
      await service.editCompanyInfo(company.id, {
        name: 'Still Me',
        currency: 'EUR',
        country: 'France',
        createdAt: spoofedDate,
      } as never);

      const row = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
      expect(row.createdAt.getTime()).not.toBe(spoofedDate.getTime());
    } finally {
      await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    }
  });

  it(
    '`numberFormats` in the body is IGNORED, not written: POST /api/company/info must never be a ' +
      "door to the company's running series",
    async () => {
      const company = await createTestCompany({ invoice: 'FT {year}/{number:4}' });
      try {
        await service.editCompanyInfo(company.id, {
          name: 'Still Me',
          currency: 'EUR',
          country: 'France',
          // A running series is frozen (issue #496): nothing a caller sends may replace it.
          numberFormats: { invoice: 'NOPE', quote: 'ALSO-NOPE' },
        } as never);

        const row = await prisma.company.findUnique({ where: { id: company.id } });
        expect(row?.numberFormats).toEqual({ invoice: 'FT {year}/{number:4}' });
      } finally {
        await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
      }
    },
  );

  it('issue #496: updateNumberFormat refuses every change (405) and writes nothing', async () => {
    const company = await createTestCompany({ invoice: 'FT {year}/{number:4}' });
    try {
      expect(() => service.updateNumberFormat()).toThrow(MethodNotAllowedException);
      expect(() => service.updateNumberFormat()).toThrow(/can no longer be changed/);

      const row = await prisma.company.findUnique({ where: { id: company.id } });
      expect(row?.numberFormats).toEqual({ invoice: 'FT {year}/{number:4}' });
    } finally {
      await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    }
  });

  it('issue #496: getNumberFormats shows the country format, its constraints, and the next number from the real counter', async () => {
    const company = await createTestCompany({ 'credit-note': 'CREDIT-NOTE-{year}-{number:4}' });
    try {
      await prisma.company.update({
        where: { id: company.id },
        data: { country: 'Italy', countryCode: 'IT' },
      });
      await prisma.documentNumberSequence.create({
        data: { companyId: company.id, typeId: 'credit-note', nextNumber: 6 },
      });

      const result = await service.getNumberFormats(company.id);

      expect(result.countryCode).toBe('IT');
      const creditNote = result.formats.find((f) => f.typeId === 'credit-note');
      // The old default breaks FatturaPA's 20 characters, so the country format takes over - and the
      // counter goes on at 6, never back to 1.
      expect(creditNote).toMatchObject({
        pattern: 'CN-{year}-{number:4}',
        source: 'country-policy',
        nextNumber: 6,
        nextDisplayNumber: `CN-${new Date().getFullYear()}-0006`,
      });
      expect(creditNote?.supersededRunningSeries?.pattern).toBe('CREDIT-NOTE-{year}-{number:4}');
      expect(creditNote?.constraints.map((c) => c.id)).toContain('it-fatturapa-numero-string20');
      expect(result.formats.find((f) => f.typeId === 'invoice')).toMatchObject({
        pattern: 'INVOICE-{year}-{number:4}',
        nextNumber: 1,
      });
    } finally {
      await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    }
  });
});
