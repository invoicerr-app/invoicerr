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

import { randomUUID } from 'node:crypto';

import { MethodNotAllowedException } from '@nestjs/common';
import { CompanyService } from './company.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { getSeatsView } from '@/modules/billing/seats-view';
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

/**
 * Issue #603: `getCompanyInfo` exposes the country's own `documentValidationCode` fact
 * (`country-policy/schema.ts`) instead of letting the frontend decide Portugal-only behaviour from
 * `country`/`countryCode` itself - see `actions/atcud-issuance.spec.ts` for the analogous backend
 * enforcement gate, and the frontend's `-[tab].tsx`/`atcud.settings.tsx` for the two readers of this
 * exact field.
 */
describe('CompanyService#getCompanyInfo - issue #603: documentValidationCode', () => {
  let service: CompanyService;

  beforeAll(() => {
    service = new CompanyService(fakeWebhookDispatcher);
  });

  it('a Portuguese company gets { scheme: "ATCUD" }', async () => {
    const company = await createTestCompany();
    try {
      await prisma.company.update({
        where: { id: company.id },
        data: { country: 'Portugal', countryCode: 'PT' },
      });
      const info = await service.getCompanyInfo(company.id);
      expect(info?.documentValidationCode).toMatchObject({ scheme: 'ATCUD' });
    } finally {
      await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    }
  });

  it('a French company gets null - no validation-code scheme declared', async () => {
    const company = await createTestCompany();
    try {
      const info = await service.getCompanyInfo(company.id);
      expect(info?.documentValidationCode).toBeNull();
    } finally {
      await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    }
  });
});

/**
 * Issue #535: one of the two things a fix has to guarantee ("a new company's owner always has a
 * seat"). `createCompany` reserves the OWNER's own seat through `billing/seat-sync.ts#withSeatReservation`
 * (see that call site's own comment, "A brand-new company's own OWNER is its first seat") - this is
 * an END-TO-END proof of that, real Prisma against a real `CompanySubscription` row (`seats Int
 * @default(1)`, `schema.prisma`), not the mocked `withSeatReservation` unit coverage
 * `seat-sync.spec.ts` already has. Gated on the SAME billing flag production reads
 * (`WARNING__ENABLE_BILLING_FOR_USERS__WARNING`), set and restored around each test since
 * `withSeatReservation` reads `process.env` directly, not an injected flag.
 */
describe('CompanyService#createCompany - issue #535: the owner always gets a seat', () => {
  let service: CompanyService;
  const ORIGINAL_BILLING_FLAG = process.env.WARNING__ENABLE_BILLING_FOR_USERS__WARNING;

  beforeAll(() => {
    service = new CompanyService(fakeWebhookDispatcher);
  });

  beforeEach(() => {
    process.env.WARNING__ENABLE_BILLING_FOR_USERS__WARNING = 'true';
  });

  afterEach(() => {
    if (ORIGINAL_BILLING_FLAG === undefined) {
      delete process.env.WARNING__ENABLE_BILLING_FOR_USERS__WARNING;
    } else {
      process.env.WARNING__ENABLE_BILLING_FOR_USERS__WARNING = ORIGINAL_BILLING_FLAG;
    }
  });

  it('seats the creating user at desk 1 on their own brand-new company, never in the waiting list', async () => {
    const owner = await prisma.user.create({
      data: {
        id: randomUUID(),
        firstname: 'Fresh',
        lastname: 'Owner',
        email: `company-service-spec-owner-${Date.now()}-${Math.random()}@example.com`,
      },
    });

    let companyId: string | undefined;
    try {
      const company = await service.createCompany(owner.id, {
        name: 'Issue 535 Fresh Co',
        country: 'France',
        countryCode: 'FR',
      } as never);
      companyId = company.id;

      const membership = await prisma.userCompany.findUnique({
        where: { userId_companyId: { userId: owner.id, companyId: company.id } },
      });
      expect(membership).not.toBeNull();
      expect(membership?.role).toBe('OWNER');
      expect(membership?.seatIndex).toBe(1);

      const subscription = await prisma.companySubscription.findUnique({ where: { companyId: company.id } });
      expect(subscription?.seats).toBe(1);

      const seatsView = await getSeatsView(company.id);
      expect(seatsView.waiting).toEqual([]);
      expect(seatsView.members).toHaveLength(1);
      expect(seatsView.members[0]).toMatchObject({ userId: owner.id, role: 'OWNER', seatIndex: 1 });
    } finally {
      if (companyId) await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    }
  });
});
