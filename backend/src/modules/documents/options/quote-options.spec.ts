import { describe, expect, it } from 'vitest';

import {
  commonLinesOf,
  computeCommonLineTotals,
  computeQuoteOptionTotals,
  deriveQuoteOptions,
  resolveChosenOption,
  resolveInvoiceableLines,
  stripOptionTag,
} from './quote-options';

/**
 * Issue #373 ("quotes with options") - the pure derivation/validation logic every acceptance path and
 * conversion route defers to. See this module's own header for the design.
 */

function line(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Line',
    quantity: 1,
    unitPrice: 100,
    vatRate: '20',
    ...overrides,
  };
}

describe('deriveQuoteOptions', () => {
  it('is empty for a quote with no lines at all', () => {
    expect(deriveQuoteOptions({})).toEqual([]);
    expect(deriveQuoteOptions({ lines: [] })).toEqual([]);
  });

  it("is empty when every line leaves `option` unset - today's ordinary quote, unchanged", () => {
    expect(deriveQuoteOptions({ lines: [line(), line()] })).toEqual([]);
  });

  it(
    'returns a single-element array when every line repeats the SAME option - deriveQuoteOptions ' +
      'reports the distinct values as they are; it is the CALLERS (resolveChosenOption, ' +
      'computeQuoteOptionTotals) that treat "fewer than two" as "no choice to make"',
    () => {
      expect(deriveQuoteOptions({ lines: [line({ option: 'Basic' }), line({ option: ' Basic ' })] })).toEqual(
        ['Basic'],
      );
    },
  );

  it('returns distinct options in FIRST-APPEARANCE order, never re-sorted', () => {
    expect(
      deriveQuoteOptions({
        lines: [
          line({ option: 'Premium' }),
          line({ option: 'Basic' }),
          line({ option: 'Premium' }),
          line({ option: 'Standard' }),
        ],
      }),
    ).toEqual(['Premium', 'Basic', 'Standard']);
  });

  it('trims whitespace and ignores a blank option the same as an unset one', () => {
    expect(
      deriveQuoteOptions({
        lines: [line({ option: '  Basic  ' }), line({ option: '' }), line({ option: 'Premium' })],
      }),
    ).toEqual(['Basic', 'Premium']);
  });
});

describe('computeQuoteOptionTotals', () => {
  it('is null for fewer than two options - the caller falls back to the ordinary single total', () => {
    expect(computeQuoteOptionTotals({ lines: [line()], currency: 'EUR' })).toBeNull();
    expect(computeQuoteOptionTotals({ lines: [line({ option: 'Basic' })], currency: 'EUR' })).toBeNull();
  });

  it("computes each option's OWN totals from only ITS OWN lines, never a global sum", () => {
    const data = {
      currency: 'EUR',
      lines: [
        line({ option: 'Basic', unitPrice: 100, vatRate: '20' }),
        line({ option: 'Premium', unitPrice: 100, vatRate: '20' }),
        line({ option: 'Premium', unitPrice: 200, vatRate: '20' }),
      ],
    };
    const result = computeQuoteOptionTotals(data);
    expect(result).not.toBeNull();
    expect(result!.map((r) => r.option)).toEqual(['Basic', 'Premium']);

    const basic = result!.find((r) => r.option === 'Basic')!;
    expect(basic.totals.netMinor).toBe(10000);
    expect(basic.totals.grossMinor).toBe(12000);
    expect(basic.lines).toHaveLength(1);

    const premium = result!.find((r) => r.option === 'Premium')!;
    expect(premium.totals.netMinor).toBe(30000);
    expect(premium.totals.grossMinor).toBe(36000);
    expect(premium.lines).toHaveLength(2);
  });

  it("counts a line with NO option in EVERY option's own total - never dropped, never orphaned", () => {
    const data = {
      currency: 'EUR',
      lines: [
        line({ description: 'Basic line', option: 'Basic', unitPrice: 100, vatRate: '20' }),
        line({ description: 'Setup fee', unitPrice: 50, vatRate: '20' }), // no `option` at all
        line({ description: 'Premium line', option: 'Premium', unitPrice: 300, vatRate: '20' }),
      ],
    };
    const result = computeQuoteOptionTotals(data);
    expect(result).not.toBeNull();

    const basic = result!.find((r) => r.option === 'Basic')!;
    // 100 (Basic) + 50 (common) = 150 net.
    expect(basic.totals.netMinor).toBe(15000);
    expect(basic.lines.map((l) => l.description)).toEqual(['Basic line', 'Setup fee']);

    const premium = result!.find((r) => r.option === 'Premium')!;
    // 50 (common) + 300 (Premium) = 350 net.
    expect(premium.totals.netMinor).toBe(35000);
    expect(premium.lines.map((l) => l.description)).toEqual(['Setup fee', 'Premium line']);
  });

  it('keeps a common line in its ORIGINAL relative position for each option, never reordered to the end', () => {
    const data = {
      currency: 'EUR',
      lines: [
        line({ description: 'Setup fee', unitPrice: 50 }), // common, FIRST
        line({ description: 'Basic line', option: 'Basic', unitPrice: 100 }),
        line({ description: 'Premium line', option: 'Premium', unitPrice: 300 }),
      ],
    };
    const result = computeQuoteOptionTotals(data)!;
    expect(result.find((r) => r.option === 'Basic')!.lines.map((l) => l.description)).toEqual([
      'Setup fee',
      'Basic line',
    ]);
    expect(result.find((r) => r.option === 'Premium')!.lines.map((l) => l.description)).toEqual([
      'Setup fee',
      'Premium line',
    ]);
  });
});

describe('commonLinesOf / computeCommonLineTotals', () => {
  it('is empty/null when the quote has fewer than two options - the common concept does not apply yet', () => {
    const data = { currency: 'EUR', lines: [line()] };
    expect(commonLinesOf(data)).toHaveLength(1); // structurally "common" is just "untagged"
    expect(computeCommonLineTotals(data)).toBeNull(); // but the DISPLAY concept only exists at 2+ options
  });

  it('is null once there are 2+ options but nothing is left untagged', () => {
    const data = {
      currency: 'EUR',
      lines: [line({ option: 'Basic' }), line({ option: 'Premium' })],
    };
    expect(computeCommonLineTotals(data)).toBeNull();
  });

  it("computes the common lines' OWN informational total, separate from any option's", () => {
    const data = {
      currency: 'EUR',
      lines: [
        line({ description: 'Basic line', option: 'Basic', unitPrice: 100, vatRate: '20' }),
        line({ description: 'Setup fee', unitPrice: 50, vatRate: '20' }),
        line({ description: 'Premium line', option: 'Premium', unitPrice: 300, vatRate: '20' }),
      ],
    };
    const common = computeCommonLineTotals(data);
    expect(common).not.toBeNull();
    expect(common!.lines.map((l) => l.description)).toEqual(['Setup fee']);
    expect(common!.totals.netMinor).toBe(5000);
    expect(common!.totals.grossMinor).toBe(6000);
  });
});

describe('resolveChosenOption', () => {
  it('needs no choice at all for fewer than two options - undefined, never an error', () => {
    expect(resolveChosenOption([], 'anything')).toBeUndefined();
    expect(resolveChosenOption([], undefined)).toBeUndefined();
    expect(resolveChosenOption(['Basic'], undefined)).toBeUndefined();
    expect(resolveChosenOption(['Basic'], 'Basic')).toBeUndefined();
  });

  it('refuses a missing choice once there are 2+ options, with a clear message', () => {
    expect(() => resolveChosenOption(['Basic', 'Premium'], undefined)).toThrow(
      /offers 2 options \(Basic, Premium\) - choose one/,
    );
    expect(() => resolveChosenOption(['Basic', 'Premium'], '')).toThrow(/choose one/);
    expect(() => resolveChosenOption(['Basic', 'Premium'], '   ')).toThrow(/choose one/);
  });

  it('refuses an UNKNOWN option, naming the ones that ARE valid', () => {
    expect(() => resolveChosenOption(['Basic', 'Premium'], 'Deluxe')).toThrow(
      /"Deluxe" is not one of this quote's options \(Basic, Premium\)/,
    );
  });

  it('accepts an exact match, trimmed', () => {
    expect(resolveChosenOption(['Basic', 'Premium'], 'Premium')).toBe('Premium');
    expect(resolveChosenOption(['Basic', 'Premium'], '  Premium  ')).toBe('Premium');
  });

  it("is case-sensitive - a company's own typed casing is the only valid match", () => {
    expect(() => resolveChosenOption(['Basic', 'Premium'], 'premium')).toThrow(/is not one of/);
  });
});

describe('stripOptionTag', () => {
  it('removes the `option` key from every line, leaving everything else untouched', () => {
    const lines = [line({ option: 'Basic' }), line({ option: 'Premium' })];
    const stripped = stripOptionTag(lines);
    expect(stripped.every((l) => !('option' in l))).toBe(true);
    expect(stripped[0]).toMatchObject({ description: 'Line', quantity: 1, unitPrice: 100 });
  });

  it('is a harmless no-op on a line that never had an `option` key at all', () => {
    const lines = [line()];
    expect(stripOptionTag(lines)).toEqual(lines);
  });
});

describe('resolveInvoiceableLines', () => {
  it('returns every line, tag stripped, for a quote with fewer than two options', () => {
    const data = { lines: [line(), line()] };
    const result = resolveInvoiceableLines(data, null, 'Q-1');
    expect(result).toHaveLength(2);
    expect(result.every((l) => !('option' in l))).toBe(true);
  });

  it('refuses with a 409-shaped error when 2+ options exist and none was accepted', () => {
    const data = { lines: [line({ option: 'Basic' }), line({ option: 'Premium' })] };
    expect(() => resolveInvoiceableLines(data, null, 'Q-1')).toThrow(
      /Quote "Q-1" offers 2 options \(Basic, Premium\) and none has been accepted yet/,
    );
    expect(() => resolveInvoiceableLines(data, undefined, 'Q-1')).toThrow(/none has been accepted/);
  });

  it("returns EXACTLY the accepted option's own lines, tag stripped, once one is recorded", () => {
    const data = {
      lines: [
        line({ description: 'Basic line', option: 'Basic' }),
        line({ description: 'Premium line 1', option: 'Premium' }),
        line({ description: 'Premium line 2', option: 'Premium' }),
      ],
    };
    const result = resolveInvoiceableLines(data, 'Premium', 'Q-1');
    expect(result).toHaveLength(2);
    expect(result.map((l) => l.description)).toEqual(['Premium line 1', 'Premium line 2']);
    expect(result.every((l) => !('option' in l))).toBe(true);
  });

  it('carries a COMMON (untagged) line along with whichever option was chosen, in its original position', () => {
    const data = {
      lines: [
        line({ description: 'Setup fee' }), // common, no `option` at all
        line({ description: 'Basic line', option: 'Basic' }),
        line({ description: 'Premium line', option: 'Premium' }),
      ],
    };
    const basicResult = resolveInvoiceableLines(data, 'Basic', 'Q-1');
    expect(basicResult.map((l) => l.description)).toEqual(['Setup fee', 'Basic line']);
    expect(basicResult.every((l) => !('option' in l))).toBe(true);

    const premiumResult = resolveInvoiceableLines(data, 'Premium', 'Q-1');
    expect(premiumResult.map((l) => l.description)).toEqual(['Setup fee', 'Premium line']);
  });
});
