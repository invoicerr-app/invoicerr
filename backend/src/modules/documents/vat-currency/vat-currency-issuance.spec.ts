import { vi, type Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import * as countryPolicy from '../country-policy/country-policy';
import * as resolveVatCurrency from './resolve-vat-currency';
import { VatCurrencyRateUnavailableError } from './resolve-vat-currency';
import {
  attachVatNationalCurrencyToNumberedDocument,
  isVatCurrencyBlockError,
  runVatCurrencyPreflight,
} from './vat-currency-issuance';

vi.mock('../country-policy/country-policy');
// A FACTORY, not bare automocking: automocking a class export replaces its constructor too, which
// loses the real `Error` subclass's `.message` propagation from `super(message)`. This file's own
// "turns VatCurrencyRateUnavailableError into a BadRequestException" test needs the REAL error class
// (a real, readable `.message`) while still mocking the one function (`resolveVatCurrencyConversion`)
// this file's own wiring actually calls.
vi.mock('./resolve-vat-currency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./resolve-vat-currency')>();
  return { ...actual, resolveVatCurrencyConversion: vi.fn() };
});
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    documentInstance: { update: vi.fn() },
    log: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const mockedPrisma = prisma as unknown as { documentInstance: { update: Mock } };
const mockedResolveVatCurrencyConversion = resolveVatCurrency.resolveVatCurrencyConversion as Mock;
const mockedResolveCompanyCountryCode = countryPolicy.resolveCompanyCountryCode as Mock;

const FRENCH_USD_INVOICE = {
  client: 'client-1',
  issueDate: '2026-09-25',
  currency: 'USD',
  lines: [{ description: 'Consulting', quantity: 1, unit: 'unit', unitPrice: 1000, vatRate: '20' }],
};

const CONVERSION = {
  nationalCurrency: 'EUR',
  taxableMinor: null,
  vatMinor: 17000,
  rate: 0.85,
  rateAsOf: '2026-09-24',
  rateSource: 'ecb' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runVatCurrencyPreflight', () => {
  it('is a no-op (returns data unchanged) when resolveVatCurrencyConversion finds nothing to convert', async () => {
    mockedResolveCompanyCountryCode.mockResolvedValue('DE');
    mockedResolveVatCurrencyConversion.mockResolvedValue(null);

    const result = await runVatCurrencyPreflight('company-1', FRENCH_USD_INVOICE);

    expect(result).toEqual(FRENCH_USD_INVOICE);
    expect(result).not.toHaveProperty('__vatNationalCurrency');
  });

  it('stashes the resolved conversion as a __vatNationalCurrency sidecar', async () => {
    mockedResolveCompanyCountryCode.mockResolvedValue('FR');
    mockedResolveVatCurrencyConversion.mockResolvedValue(CONVERSION);

    const result = await runVatCurrencyPreflight('company-1', FRENCH_USD_INVOICE);

    expect(result.__vatNationalCurrency).toEqual(CONVERSION);
    // Every ordinary field survives untouched.
    expect(result.currency).toBe('USD');
    expect(result.issueDate).toBe('2026-09-25');
  });

  it('calls resolveVatCurrencyConversion with the RESOLVED totals (net/vat minor) and the issue date', async () => {
    mockedResolveCompanyCountryCode.mockResolvedValue('FR');
    mockedResolveVatCurrencyConversion.mockResolvedValue(null);

    await runVatCurrencyPreflight('company-1', FRENCH_USD_INVOICE);

    expect(mockedResolveVatCurrencyConversion).toHaveBeenCalledWith(
      'FR',
      'USD',
      '2026-09-25',
      { netMinor: 100000, vatMinor: 20000 }, // 1000 * 100 minor units, 20% VAT
    );
  });

  it('discards a STALE sidecar from a previous attempt when this send no longer needs one', async () => {
    mockedResolveCompanyCountryCode.mockResolvedValue('DE');
    mockedResolveVatCurrencyConversion.mockResolvedValue(null);
    const staleData = { ...FRENCH_USD_INVOICE, __vatNationalCurrency: CONVERSION };

    const result = await runVatCurrencyPreflight('company-1', staleData);

    expect(result).not.toHaveProperty('__vatNationalCurrency');
  });

  it('turns VatCurrencyRateUnavailableError into a BadRequestException, the load-bearing refusal', async () => {
    mockedResolveCompanyCountryCode.mockResolvedValue('PL');
    mockedResolveVatCurrencyConversion.mockRejectedValue(
      new VatCurrencyRateUnavailableError('No NBP Table A rate is available for "USD".'),
    );

    let caught: unknown;
    try {
      await runVatCurrencyPreflight('company-1', FRENCH_USD_INVOICE);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).message).toMatch(/NBP Table A/);
  });

  it('propagates any OTHER error unwrapped (a genuine transport failure, never mislabeled a 400)', async () => {
    mockedResolveCompanyCountryCode.mockResolvedValue('FR');
    mockedResolveVatCurrencyConversion.mockRejectedValue(new Error('ECB feed unreachable'));

    await expect(runVatCurrencyPreflight('company-1', FRENCH_USD_INVOICE)).rejects.toThrow(
      'ECB feed unreachable',
    );
    await expect(runVatCurrencyPreflight('company-1', FRENCH_USD_INVOICE)).rejects.not.toThrow(
      BadRequestException,
    );
  });
});

describe('isVatCurrencyBlockError', () => {
  it('recognizes VatCurrencyRateUnavailableError and nothing else', () => {
    expect(isVatCurrencyBlockError(new VatCurrencyRateUnavailableError('x'))).toBe(true);
    expect(isVatCurrencyBlockError(new Error('x'))).toBe(false);
    expect(isVatCurrencyBlockError(undefined)).toBe(false);
  });
});

describe('attachVatNationalCurrencyToNumberedDocument', () => {
  it('is a no-op when the data carries no __vatNationalCurrency sidecar', async () => {
    await attachVatNationalCurrencyToNumberedDocument('doc-1', FRENCH_USD_INVOICE);
    expect(mockedPrisma.documentInstance.update).not.toHaveBeenCalled();
  });

  it('persists all five columns from the sidecar, rate date parsed as a UTC midnight Date', async () => {
    mockedPrisma.documentInstance.update.mockResolvedValue({});

    await attachVatNationalCurrencyToNumberedDocument('doc-1', {
      ...FRENCH_USD_INVOICE,
      __vatNationalCurrency: CONVERSION,
    });

    expect(mockedPrisma.documentInstance.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: {
        vatNationalCurrency: 'EUR',
        vatNationalCurrencyTaxableMinor: null,
        vatNationalCurrencyVatMinor: 17000,
        vatNationalCurrencyRate: 0.85,
        vatNationalCurrencyRateAsOf: new Date('2026-09-24T00:00:00Z'),
        vatNationalCurrencyRateSource: 'ecb',
      },
    });
  });

  it('never throws even when the write itself fails, logs and degrades honestly', async () => {
    mockedPrisma.documentInstance.update.mockRejectedValue(new Error('DB unreachable'));

    await expect(
      attachVatNationalCurrencyToNumberedDocument('doc-1', {
        ...FRENCH_USD_INVOICE,
        __vatNationalCurrency: CONVERSION,
      }),
    ).resolves.toBeUndefined();
  });
});
