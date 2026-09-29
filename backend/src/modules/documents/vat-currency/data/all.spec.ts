import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ALL_VAT_CURRENCY_FILES } from './all';

describe('vat-currency/data: the shipped catalog', () => {
  it('loads exactly DE/FR/IT/PL/PT today, the five countries issue #517 researched', () => {
    expect(ALL_VAT_CURRENCY_FILES.map((f) => f.countryCode).sort()).toEqual(['DE', 'FR', 'IT', 'PL', 'PT']);
  });

  it('FR requires the converted VAT, sourced from ECB, tax amount only (not the base)', () => {
    const fr = ALL_VAT_CURRENCY_FILES.find((f) => f.countryCode === 'FR')!.rule;
    expect(fr.requiredOnInvoice).toBe(true);
    expect(fr.taxableAmountRequiredOnInvoice).toBe(false);
    expect(fr.rateSource).toBe('ecb');
    expect(fr.nationalCurrency).toBe('EUR');
    expect(fr.provenance.kind).toBe('legal');
  });

  it('PL requires the converted VAT, sourced from NBP specifically, never ECB', () => {
    const pl = ALL_VAT_CURRENCY_FILES.find((f) => f.countryCode === 'PL')!.rule;
    expect(pl.requiredOnInvoice).toBe(true);
    expect(pl.rateSource).toBe('nbp');
    expect(pl.nationalCurrency).toBe('PLN');
  });

  it('IT requires BOTH the converted VAT and the converted taxable amount, sourced from ECB', () => {
    const it_ = ALL_VAT_CURRENCY_FILES.find((f) => f.countryCode === 'IT')!.rule;
    expect(it_.requiredOnInvoice).toBe(true);
    expect(it_.taxableAmountRequiredOnInvoice).toBe(true);
    expect(it_.rateSource).toBe('ecb');
  });

  it('DE has a settled "legal" conclusion of no invoice-level requirement', () => {
    const de = ALL_VAT_CURRENCY_FILES.find((f) => f.countryCode === 'DE')!.rule;
    expect(de.requiredOnInvoice).toBe(false);
    expect(de.provenance.kind).toBe('legal');
  });

  it('PT is an "unverified" conclusion, not a settled "legal" one', () => {
    const pt = ALL_VAT_CURRENCY_FILES.find((f) => f.countryCode === 'PT')!.rule;
    expect(pt.requiredOnInvoice).toBe(false);
    expect(pt.provenance.kind).toBe('unverified');
  });
});

// Drop-in invariant: proves `all.ts`'s own `discoverCountryCodes()` really does pick up every
// `<cc>.json` sitting in this directory, the same independent re-check
// `content-requirements/data/all.spec.ts`'s own drop-in test already holds for its sibling catalog.
describe('vat-currency/data: every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_VAT_CURRENCY_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const onDisk = readdirSync(__dirname)
      .filter((name: string) => /^[a-z]{2}\.json$/.test(name))
      .map((name: string) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_VAT_CURRENCY_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});
