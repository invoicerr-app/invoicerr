import { BadRequestException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

/**
 * Prisma mocked with a small IN-MEMORY store (not bare jest.fn()s returning canned values) — the
 * same discipline `company-transport.spec.ts`/`channels.service.spec.ts` already hold for THIS exact
 * concern (an upsert followed by a re-read must see what the upsert just wrote), which a call-order-
 * dependent sequence of `mockResolvedValueOnce`s cannot express honestly once a function under test
 * calls the mocked client more than once (see `updateCompanyPaymentMethodConfig`'s own header: it
 * reads BEFORE writing, and the tests below read AGAIN afterward to assert what actually landed).
 */
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn(), update: jest.fn() },
    companyPaymentMethodConfig: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock; update: jest.Mock };
  companyPaymentMethodConfig: { findUnique: jest.Mock; upsert: jest.Mock };
};

interface FakeCompany {
  iban: string | null;
  bic: string | null;
}
interface FakeConfigRow {
  enabled: boolean;
  config: Record<string, unknown>;
}

function wireFakeStore(company: FakeCompany, rows: Map<string, FakeConfigRow>) {
  mockedPrisma.company.findUnique.mockImplementation(async () => ({ iban: company.iban, bic: company.bic }));
  mockedPrisma.company.update.mockImplementation(async ({ data }: { data: Partial<FakeCompany> }) => {
    if (data.iban !== undefined) company.iban = data.iban;
    if (data.bic !== undefined) company.bic = data.bic;
    return { ...company };
  });
  mockedPrisma.companyPaymentMethodConfig.findUnique.mockImplementation(
    async ({ where }: { where: { companyId_methodId: { methodId: string } } }) => {
      const row = rows.get(where.companyId_methodId.methodId);
      return row ? { enabled: row.enabled, config: row.config } : null;
    },
  );
  mockedPrisma.companyPaymentMethodConfig.upsert.mockImplementation(
    async ({
      where,
      create,
      update,
    }: {
      where: { companyId_methodId: { methodId: string } };
      create: { enabled: boolean; config?: Record<string, unknown> };
      update: { enabled: boolean; config?: Record<string, unknown> };
    }) => {
      const methodId = where.companyId_methodId.methodId;
      const existing = rows.get(methodId);
      const next: FakeConfigRow = existing
        ? { enabled: update.enabled, config: update.config ?? existing.config }
        : { enabled: create.enabled, config: create.config ?? {} };
      rows.set(methodId, next);
      return { ...next };
    },
  );
}

// Imported AFTER jest.mock so the module under test picks up the mocked client.
import {
  listCompanyPaymentMethods,
  resolveEnabledPaymentMethodPresentations,
  updateCompanyPaymentMethodConfig,
} from './persistence';

describe('payment-methods/persistence', () => {
  let company: FakeCompany;
  let rows: Map<string, FakeConfigRow>;

  beforeEach(() => {
    jest.clearAllMocks();
    company = { iban: null, bic: null };
    rows = new Map();
    wireFakeStore(company, rows);
  });

  describe('listCompanyPaymentMethods', () => {
    it('returns all five built-in methods, disabled and empty for a company that never configured any', async () => {
      const views = await listCompanyPaymentMethods('company-1');
      expect(views.map((v) => v.id)).toEqual([
        'bank_transfer',
        'paypal',
        'cash',
        'cheque',
        'stripe',
        'mollie',
      ]);
      expect(views.every((v) => v.enabled === false)).toBe(true);
      expect(views.find((v) => v.id === 'cash')?.config).toEqual({});
    });

    it("bank_transfer's own config is read from Company.iban/bic, never from a row's own `config` column", async () => {
      company.iban = 'FR1420041010050500013M02606';
      company.bic = 'PSSTFRPPPAR';
      rows.set('bank_transfer', { enabled: true, config: { iban: 'SOMETHING-ELSE-STALE' } });

      const views = await listCompanyPaymentMethods('company-1');
      const bankTransfer = views.find((v) => v.id === 'bank_transfer');
      expect(bankTransfer?.enabled).toBe(true);
      expect(bankTransfer?.config).toEqual({
        iban: 'FR1420041010050500013M02606',
        bic: 'PSSTFRPPPAR',
      });
    });

    it('a configured, enabled method (e.g. PayPal) reflects its own row', async () => {
      rows.set('paypal', { enabled: true, config: { email: 'billing@acme.test' } });
      const views = await listCompanyPaymentMethods('company-1');
      const paypal = views.find((v) => v.id === 'paypal');
      expect(paypal).toEqual({
        id: 'paypal',
        label: 'PayPal',
        fields: expect.any(Array),
        enabled: true,
        config: { email: 'billing@acme.test' },
      });
    });
  });

  describe('updateCompanyPaymentMethodConfig', () => {
    it('throws NotFoundException for an id nobody registered', async () => {
      await expect(updateCompanyPaymentMethodConfig('company-1', 'card', { enabled: true })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses to ENABLE a method whose required field is missing — 400, named errors', async () => {
      await expect(
        updateCompanyPaymentMethodConfig('company-1', 'paypal', { enabled: true, config: {} }),
      ).rejects.toThrow(BadRequestException);
    });

    it('a DISABLED method is never validated — a partial, invalid draft can still be saved', async () => {
      const result = await updateCompanyPaymentMethodConfig('company-1', 'paypal', {
        enabled: false,
        config: {},
      });
      expect(result.enabled).toBe(false);
      expect(result.config).toEqual({});
    });

    it('enabling with a complete config succeeds and reads back exactly what was saved', async () => {
      const result = await updateCompanyPaymentMethodConfig('company-1', 'paypal', {
        enabled: true,
        config: { email: 'billing@acme.test' },
      });
      expect(result).toEqual({
        id: 'paypal',
        label: 'PayPal',
        fields: expect.any(Array),
        enabled: true,
        config: { email: 'billing@acme.test' },
      });
    });

    it('cash (zero fields) can be enabled with an empty config — the empty case is not refused', async () => {
      const result = await updateCompanyPaymentMethodConfig('company-1', 'cash', { enabled: true });
      expect(result).toEqual({ id: 'cash', label: 'Cash', fields: [], enabled: true, config: {} });
    });

    it('a plain enable/disable toggle (no `config`) never overwrites a stored config', async () => {
      await updateCompanyPaymentMethodConfig('company-1', 'paypal', {
        enabled: true,
        config: { email: 'billing@acme.test' },
      });
      const result = await updateCompanyPaymentMethodConfig('company-1', 'paypal', { enabled: false });
      expect(result.enabled).toBe(false);
      expect(result.config).toEqual({ email: 'billing@acme.test' });
    });

    describe('bank_transfer — the one method bridged to Company.iban/bic', () => {
      it('writing `config` updates Company.iban/bic, never CompanyPaymentMethodConfig.config', async () => {
        const result = await updateCompanyPaymentMethodConfig('company-1', 'bank_transfer', {
          enabled: true,
          config: { iban: 'FR1420041010050500013M02606', bic: 'PSSTFRPPPAR' },
        });

        expect(company.iban).toBe('FR1420041010050500013M02606');
        expect(company.bic).toBe('PSSTFRPPPAR');
        expect(result.enabled).toBe(true);
        expect(result.config).toEqual({ iban: 'FR1420041010050500013M02606', bic: 'PSSTFRPPPAR' });
        // The row's own `config` column is never the source of truth for this id — see
        // schema.prisma's own CompanyPaymentMethodConfig header.
        expect(mockedPrisma.companyPaymentMethodConfig.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: { companyId: 'company-1', methodId: 'bank_transfer', enabled: true },
          }),
        );
      });

      it('a bare `{enabled}` toggle (no `config` in the call) never touches Company.iban/bic', async () => {
        company.iban = 'FR1420041010050500013M02606';
        rows.set('bank_transfer', { enabled: false, config: {} });

        await updateCompanyPaymentMethodConfig('company-1', 'bank_transfer', { enabled: true });

        expect(mockedPrisma.company.update).not.toHaveBeenCalled();
        expect(company.iban).toBe('FR1420041010050500013M02606');
      });

      it('an empty-string field clears the corresponding column to null, never an empty string on file', async () => {
        company.iban = 'FR1420041010050500013M02606';
        company.bic = 'PSSTFRPPPAR';

        await updateCompanyPaymentMethodConfig('company-1', 'bank_transfer', {
          enabled: false,
          config: { iban: 'FR1420041010050500013M02606', bic: '' },
        });

        expect(company.bic).toBeNull();
      });

      it('enabling without an IBAN on file is refused — IBAN is required', async () => {
        await expect(
          updateCompanyPaymentMethodConfig('company-1', 'bank_transfer', { enabled: true, config: {} }),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });

  describe('resolveEnabledPaymentMethodPresentations', () => {
    it('returns nothing when no method is enabled', async () => {
      const presentations = await resolveEnabledPaymentMethodPresentations('company-1');
      expect(presentations).toEqual([]);
    });

    it('presents only the ENABLED methods, each with this company’s own configured values', async () => {
      rows.set('cash', { enabled: true, config: {} });
      rows.set('paypal', { enabled: true, config: { email: 'billing@acme.test' } });
      rows.set('cheque', { enabled: false, config: { payee: 'Acme SARL' } }); // disabled — must NOT appear

      const presentations = await resolveEnabledPaymentMethodPresentations('company-1', {
        amountMinor: 12000,
        currency: 'EUR',
        reference: 'INV-1',
      });

      expect(presentations.map((p) => p.id).sort()).toEqual(['cash', 'paypal']);
      const paypal = presentations.find((p) => p.id === 'paypal');
      expect(paypal?.lines).toEqual(['PayPal e-mail: billing@acme.test']);
      expect(paypal?.link).toContain('billing%40acme.test');
    });

    it('an ENABLED bank_transfer pulls its lines from Company.iban/bic, same as listCompanyPaymentMethods', async () => {
      company.iban = 'FR1420041010050500013M02606';
      rows.set('bank_transfer', { enabled: true, config: {} });

      const presentations = await resolveEnabledPaymentMethodPresentations('company-1');
      const bankTransfer = presentations.find((p) => p.id === 'bank_transfer');
      expect(bankTransfer?.lines).toEqual(['IBAN: FR1420041010050500013M02606']);
    });
  });
});
