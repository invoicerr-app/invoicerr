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
 * numbering — `numberFormats` itself, bypassing `assertValidNumberPattern` entirely (see
 * `updateNumberFormat`'s own header for the check that only THAT endpoint runs). These tests prove
 * `editCompanyInfo` now writes only its explicit allow-list, and that `numberFormats` can only ever
 * be changed through the validated `updateNumberFormat` door.
 */
jest.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: jest.fn(),
}));

import { BadRequestException } from '@nestjs/common';
import { CompanyService } from './company.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: jest.fn().mockResolvedValue(undefined),
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
    '`numberFormats` in the body is IGNORED, not written — the exact bypass this task closes: ' +
      'PUT /api/company/number-format validates the pattern, POST /api/company/info must never ' +
      'be a second, unvalidated door to the same column',
    async () => {
      const company = await createTestCompany({ invoice: 'FT {year}/{number:4}' });
      try {
        await service.editCompanyInfo(company.id, {
          name: 'Still Me',
          currency: 'EUR',
          country: 'France',
          // No "{number}" token — assertValidNumberPattern would refuse this if it were ever checked.
          // It must never even get as far as being written, unchecked or not.
          numberFormats: { invoice: 'NOPE', quote: 'ALSO-NOPE' },
        } as never);

        const row = await prisma.company.findUnique({ where: { id: company.id } });
        expect(row?.numberFormats).toEqual({ invoice: 'FT {year}/{number:4}' });
      } finally {
        await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
      }
    },
  );

  it('the ONLY door still open for `numberFormats` — updateNumberFormat — validates the pattern', async () => {
    const company = await createTestCompany();
    try {
      await expect(service.updateNumberFormat(company.id, 'invoice', 'NO-NUMBER-TOKEN-HERE')).rejects.toThrow(
        BadRequestException,
      );

      const row = await prisma.company.findUnique({ where: { id: company.id } });
      expect(row?.numberFormats).toBeNull();

      await service.updateNumberFormat(company.id, 'invoice', 'FT {year}/{number:4}');
      const updatedRow = await prisma.company.findUnique({ where: { id: company.id } });
      expect(updatedRow?.numberFormats).toEqual({ invoice: 'FT {year}/{number:4}' });
    } finally {
      await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    }
  });
});
