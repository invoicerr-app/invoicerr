import { defaultComposedCountryCatalog } from '@/modules/documents/countries/registry';
import { assertValidPaymentTerms } from '@/modules/documents/payment-terms/schema';

import { normalizeDueDays, normalizeDueMode, resolvePaymentTerms } from './resolve-payment-terms';

const countries = defaultComposedCountryCatalog.countries();
const CAPPED = countries.find((cc) => defaultComposedCountryCatalog.get(cc)?.paymentTerms) as string;
const UNCAPPED = countries.filter((cc) => !defaultComposedCountryCatalog.get(cc)?.paymentTerms);

describe('resolvePaymentTerms', () => {
  it('resolves nothing for a company that never configured it', () => {
    const resolved = resolvePaymentTerms({ countryCode: UNCAPPED[0] });
    expect(resolved.quote).toBeNull();
    expect(resolved.invoice).toBeNull();
  });

  it('keeps quote and invoice independent and defaults the mode to net', () => {
    const resolved = resolvePaymentTerms({
      invoiceDueDays: 30,
      quoteDueDays: 15,
      quoteDueMode: 'endOfMonth',
    });
    expect(resolved.invoice).toEqual({ days: 30, mode: 'net' });
    expect(resolved.quote).toEqual({ days: 15, mode: 'endOfMonth' });
  });

  it('treats a mode with no day count, or an out-of-range count, as no default', () => {
    expect(resolvePaymentTerms({ invoiceDueMode: 'endOfMonth' }).invoice).toBeNull();
    expect(resolvePaymentTerms({ invoiceDueDays: 4000 }).invoice).toBeNull();
    expect(resolvePaymentTerms({ invoiceDueDays: 1.5 }).invoice).toBeNull();
  });
});

describe('resolvePaymentTerms cap, read from the country data', () => {
  it('has at least one capped and one uncapped country in the shipped data', () => {
    expect(CAPPED).toBeDefined();
    expect(UNCAPPED.length).toBeGreaterThan(0);
  });

  it('warns above the net cap and not at it', () => {
    const cap = resolvePaymentTerms({ countryCode: CAPPED }).cap;
    expect(cap).not.toBeNull();
    const net = cap?.maxNetDays ?? 0;
    expect(resolvePaymentTerms({ countryCode: CAPPED, invoiceDueDays: net }).exceedsCap.invoice).toBe(false);
    expect(resolvePaymentTerms({ countryCode: CAPPED, invoiceDueDays: net + 1 }).exceedsCap.invoice).toBe(
      true,
    );
  });

  it('applies the end-of-month cap to an end-of-month term', () => {
    const cap = resolvePaymentTerms({ countryCode: CAPPED }).cap;
    const eom = cap?.maxEndOfMonthDays ?? 0;
    const at = resolvePaymentTerms({ countryCode: CAPPED, quoteDueDays: eom, quoteDueMode: 'endOfMonth' });
    const over = resolvePaymentTerms({
      countryCode: CAPPED,
      quoteDueDays: eom + 1,
      quoteDueMode: 'endOfMonth',
    });
    expect(at.exceedsCap.quote).toBe(false);
    expect(over.exceedsCap.quote).toBe(true);
  });

  it('carries the legal source with the cap', () => {
    expect(resolvePaymentTerms({ countryCode: CAPPED.toLowerCase() }).cap?.source).toMatch(/L\. 441-10/);
  });

  it('warns nothing for a country whose data has no paymentTerms section, or no country at all', () => {
    for (const countryCode of [...UNCAPPED, 'XX', '', null, undefined]) {
      const resolved = resolvePaymentTerms({ countryCode, invoiceDueDays: 365, quoteDueDays: 365 });
      expect(resolved.cap).toBeNull();
      expect(resolved.exceedsCap).toEqual({ quote: false, invoice: false });
    }
  });
});

describe('assertValidPaymentTerms', () => {
  const provenance = { kind: 'legal' as const, sourceText: 'text', sourceCheckedAt: '2026-01-01' };

  it('accepts a sourced cap', () => {
    expect(() =>
      assertValidPaymentTerms({ countryCode: 'ZZ', maxNetDays: 60, maxEndOfMonthDays: 45, provenance }, 'x'),
    ).not.toThrow();
  });

  it('refuses a non-positive cap and a missing source', () => {
    expect(() =>
      assertValidPaymentTerms({ countryCode: 'ZZ', maxNetDays: 0, maxEndOfMonthDays: 45, provenance }, 'x'),
    ).toThrow(/maxNetDays/);
    expect(() =>
      assertValidPaymentTerms(
        { countryCode: 'ZZ', maxNetDays: 60, maxEndOfMonthDays: 45, provenance: undefined as never },
        'x',
      ),
    ).toThrow(/provenance/);
  });
});

describe('normalizers', () => {
  it('leaves absent keys alone and clears null or empty', () => {
    expect(normalizeDueDays('invoiceDueDays', undefined)).toBeUndefined();
    expect(normalizeDueDays('invoiceDueDays', null)).toBeNull();
    expect(normalizeDueMode('invoiceDueMode', '')).toBeNull();
  });

  it('refuses a negative, fractional or oversized count and an unknown mode', () => {
    expect(() => normalizeDueDays('invoiceDueDays', -1)).toThrow();
    expect(() => normalizeDueDays('invoiceDueDays', 2.5)).toThrow();
    expect(() => normalizeDueDays('invoiceDueDays', 366)).toThrow();
    expect(() => normalizeDueMode('invoiceDueMode', 'weekly')).toThrow();
  });

  it('accepts valid values', () => {
    expect(normalizeDueDays('invoiceDueDays', 30)).toBe(30);
    expect(normalizeDueMode('invoiceDueMode', 'endOfMonth')).toBe('endOfMonth');
  });
});
