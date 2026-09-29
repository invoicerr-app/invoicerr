import { describe, expect, it } from 'vitest';

import { resolveVatCurrencyRule, VatCurrencyCatalog } from './registry';
import { CountryVatCurrencyFile } from './schema';

describe('vat-currency/registry: resolveVatCurrencyRule (default catalog)', () => {
  it('resolves a known country, case-insensitively', () => {
    expect(resolveVatCurrencyRule('fr')?.nationalCurrency).toBe('EUR');
    expect(resolveVatCurrencyRule('FR')?.nationalCurrency).toBe('EUR');
  });

  it('returns null for a country with no shipped file, permissive, never a throw', () => {
    expect(resolveVatCurrencyRule('US')).toBeNull();
    expect(resolveVatCurrencyRule('')).toBeNull();
  });
});

describe('vat-currency/registry: VatCurrencyCatalog (constructible, narrower fixtures)', () => {
  it('resolves only what it was constructed with', () => {
    const file: CountryVatCurrencyFile = {
      countryCode: 'ZZ',
      rule: {
        nationalCurrency: 'EUR',
        requiredOnInvoice: true,
        taxableAmountRequiredOnInvoice: false,
        rateSource: 'ecb',
        rateDateRule: 'on the tax point',
        provenance: { kind: 'legal', sourceText: 'x', sourceCheckedAt: '2026-09-28' },
      },
    };
    const catalog = new VatCurrencyCatalog([file]);
    expect(catalog.ruleFor('ZZ')?.rateSource).toBe('ecb');
    expect(catalog.ruleFor('FR')).toBeNull();
  });
});
