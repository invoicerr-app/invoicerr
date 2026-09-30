import { describe, expect, it, vi, type Mock } from 'vitest';

import * as countryPolicy from './country-policy';
import {
  resolveDomesticInvoiceCurrencyViolation,
  runDomesticInvoiceCurrencyPreflight,
} from './domestic-currency-issuance';
import { CountryPolicyCatalog } from './registry';
import { CountryDocumentPolicyFile } from './schema';

// Same "automock the DB-touching module, cast the two functions this file calls" pattern
// `vat-currency/vat-currency-issuance.spec.ts` already establishes for the identical dependency.
vi.mock('./country-policy');
const mockedResolveCompanyCountryCode = countryPolicy.resolveCompanyCountryCode as Mock;
const mockedResolveClientCountryCode = countryPolicy.resolveClientCountryCode as Mock;

const DZ_FILE: CountryDocumentPolicyFile = {
  countryCode: 'DZ',
  documentTypes: ['invoice'],
  rules: [],
  domesticInvoiceCurrency: {
    currency: 'DZD',
    provenance: {
      kind: 'legal',
      sourceText:
        'Toute facturation ou vente de biens et services sur le territoire douanier national ' +
        "s'effectue en dinars algeriens sauf cas prevus par la reglementation en vigueur.",
      sourceCheckedAt: '2026-09-30',
    },
  },
};

// FR carries no `domesticInvoiceCurrency` at all: same "no permissive fallback, never a real rule
// invented by omission" fixture every sibling catalog's own spec uses.
const FR_FILE: CountryDocumentPolicyFile = {
  countryCode: 'FR',
  documentTypes: ['invoice'],
  rules: [],
};

const catalog = new CountryPolicyCatalog([DZ_FILE, FR_FILE]);

describe('resolveDomesticInvoiceCurrencyViolation', () => {
  it('blocks a domestic DZ -> DZ invoice issued in EUR', () => {
    const violation = resolveDomesticInvoiceCurrencyViolation('DZ', 'DZ', 'EUR', catalog);
    expect(violation).toEqual({
      sellerCountryCode: 'DZ',
      requiredCurrency: 'DZD',
      invoiceCurrency: 'EUR',
      fact: DZ_FILE.domesticInvoiceCurrency,
    });
  });

  it('allows a domestic DZ -> DZ invoice issued in DZD', () => {
    expect(resolveDomesticInvoiceCurrencyViolation('DZ', 'DZ', 'DZD', catalog)).toBeUndefined();
  });

  it('is case-insensitive on both the country codes and the currency', () => {
    expect(resolveDomesticInvoiceCurrencyViolation('dz', 'dz', 'dzd', catalog)).toBeUndefined();
    const violation = resolveDomesticInvoiceCurrencyViolation('dz', 'dz', 'eur', catalog);
    expect(violation?.requiredCurrency).toBe('DZD');
    expect(violation?.invoiceCurrency).toBe('EUR');
  });

  it('allows a cross-border DZ -> FR invoice issued in EUR (not domestic)', () => {
    expect(resolveDomesticInvoiceCurrencyViolation('DZ', 'FR', 'EUR', catalog)).toBeUndefined();
  });

  it('leaves a country with no domesticInvoiceCurrency fact (FR) entirely unaffected', () => {
    expect(resolveDomesticInvoiceCurrencyViolation('FR', 'FR', 'USD', catalog)).toBeUndefined();
  });

  it('treats an unresolved buyer country as domestic - fail closed, mirrors mandate.ts', () => {
    const violation = resolveDomesticInvoiceCurrencyViolation('DZ', undefined, 'EUR', catalog);
    expect(violation?.requiredCurrency).toBe('DZD');
  });

  it('returns undefined for a seller country with no policy file at all', () => {
    expect(resolveDomesticInvoiceCurrencyViolation('ZZ', 'ZZ', 'EUR', catalog)).toBeUndefined();
  });

  it('returns undefined when the seller country is not resolved at all', () => {
    expect(resolveDomesticInvoiceCurrencyViolation(undefined, 'DZ', 'EUR', catalog)).toBeUndefined();
  });

  it('never blocks a blank/unsubmitted currency - a separate, required-field concern', () => {
    expect(resolveDomesticInvoiceCurrencyViolation('DZ', 'DZ', undefined, catalog)).toBeUndefined();
    expect(resolveDomesticInvoiceCurrencyViolation('DZ', 'DZ', '', catalog)).toBeUndefined();
  });
});

describe('runDomesticInvoiceCurrencyPreflight', () => {
  it('throws a BadRequestException naming the required currency for a blocked DZ -> DZ send in EUR', async () => {
    mockedResolveCompanyCountryCode.mockResolvedValue('DZ');
    mockedResolveClientCountryCode.mockResolvedValue('DZ');

    await expect(
      runDomesticInvoiceCurrencyPreflight('company-1', 'client-1', { currency: 'EUR' }, catalog),
    ).rejects.toThrow(/DZD/);
  });

  it('is a no-op for a DZ -> DZ send already in DZD', async () => {
    mockedResolveCompanyCountryCode.mockResolvedValue('DZ');
    mockedResolveClientCountryCode.mockResolvedValue('DZ');

    await expect(
      runDomesticInvoiceCurrencyPreflight('company-1', 'client-1', { currency: 'DZD' }, catalog),
    ).resolves.toBeUndefined();
  });

  it('is a no-op for a DZ -> FR send in EUR (not domestic)', async () => {
    mockedResolveCompanyCountryCode.mockResolvedValue('DZ');
    mockedResolveClientCountryCode.mockResolvedValue('FR');

    await expect(
      runDomesticInvoiceCurrencyPreflight('company-1', 'client-1', { currency: 'EUR' }, catalog),
    ).resolves.toBeUndefined();
  });

  it('is a no-op for a country with no domesticInvoiceCurrency fact (FR -> FR), and never even resolves the buyer', async () => {
    mockedResolveCompanyCountryCode.mockResolvedValue('FR');
    mockedResolveClientCountryCode.mockResolvedValue('FR');

    await expect(
      runDomesticInvoiceCurrencyPreflight('company-1', 'client-1', { currency: 'USD' }, catalog),
    ).resolves.toBeUndefined();
    expect(mockedResolveClientCountryCode).not.toHaveBeenCalled();
  });

  it('is a no-op when the seller country cannot be resolved at all', async () => {
    mockedResolveCompanyCountryCode.mockResolvedValue(undefined);

    await expect(
      runDomesticInvoiceCurrencyPreflight('company-1', 'client-1', { currency: 'EUR' }, catalog),
    ).resolves.toBeUndefined();
    expect(mockedResolveClientCountryCode).not.toHaveBeenCalled();
  });
});
