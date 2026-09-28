import { describe, expect, it } from 'vitest';

import { InvalidPolicyProvenanceError } from '../country-policy/schema';
import { assertValidVatCurrencyRule, CountryVatCurrencyFile, InvalidVatCurrencyRuleError } from './schema';

function baseFile(overrides: Partial<CountryVatCurrencyFile['rule']> = {}): CountryVatCurrencyFile {
  return {
    countryCode: 'XX',
    rule: {
      nationalCurrency: 'EUR',
      requiredOnInvoice: true,
      taxableAmountRequiredOnInvoice: false,
      rateSource: 'ecb',
      rateDateRule: 'on or before the tax point',
      provenance: { kind: 'legal', sourceText: 'Some statute.', sourceCheckedAt: '2026-09-28' },
      ...overrides,
    },
  };
}

describe('vat-currency/schema: assertValidVatCurrencyRule', () => {
  it('accepts a well-formed, required, ECB-sourced rule', () => {
    expect(() => assertValidVatCurrencyRule(baseFile(), 'test')).not.toThrow();
  });

  it('accepts a well-formed, not-required rule with rateSource "none" and no rateDateRule', () => {
    const file = baseFile({ requiredOnInvoice: false, rateSource: 'none', rateDateRule: undefined });
    expect(() => assertValidVatCurrencyRule(file, 'test')).not.toThrow();
  });

  it('rejects a nationalCurrency that is not a 3-letter code', () => {
    const file = baseFile({ nationalCurrency: 'EURO' });
    expect(() => assertValidVatCurrencyRule(file, 'test')).toThrow(InvalidVatCurrencyRuleError);
  });

  it('rejects an unknown rateSource', () => {
    const file = baseFile({ rateSource: 'swift' as never });
    expect(() => assertValidVatCurrencyRule(file, 'test')).toThrow(InvalidVatCurrencyRuleError);
  });

  it('rejects requiredOnInvoice: true with rateSource: "none", a requirement with no source is a silent no-op', () => {
    const file = baseFile({ requiredOnInvoice: true, rateSource: 'none' });
    expect(() => assertValidVatCurrencyRule(file, 'test')).toThrow(InvalidVatCurrencyRuleError);
  });

  it('rejects requiredOnInvoice: true with no rateDateRule', () => {
    const file = baseFile({ requiredOnInvoice: true, rateDateRule: undefined });
    expect(() => assertValidVatCurrencyRule(file, 'test')).toThrow(InvalidVatCurrencyRuleError);
  });

  // The provenance gate itself is `country-policy/schema.ts#assertValidPolicyProvenance`, REUSED
  // verbatim (see this file's own header on why), so its own two failures below throw ITS named
  // error, `InvalidPolicyProvenanceError`, never a wrapped/renamed `InvalidVatCurrencyRuleError`.
  it('rejects a rule with no provenance at all', () => {
    const file = baseFile({ provenance: undefined as never });
    expect(() => assertValidVatCurrencyRule(file, 'test')).toThrow(InvalidPolicyProvenanceError);
  });

  it('accepts "unverified" provenance with a resolutionNote', () => {
    const file = baseFile({
      requiredOnInvoice: false,
      rateSource: 'none',
      rateDateRule: undefined,
      provenance: { kind: 'unverified', resolutionNote: 'What would settle this.' },
    });
    expect(() => assertValidVatCurrencyRule(file, 'test')).not.toThrow();
  });

  it('rejects "unverified" provenance with no resolutionNote', () => {
    const file = baseFile({
      requiredOnInvoice: false,
      rateSource: 'none',
      rateDateRule: undefined,
      provenance: { kind: 'unverified', resolutionNote: '' },
    });
    expect(() => assertValidVatCurrencyRule(file, 'test')).toThrow(InvalidPolicyProvenanceError);
  });
});
