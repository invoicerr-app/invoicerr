import { CurrencyRateLike } from '../../company/currency-rates/convert';
import { resolvePaymentConversion } from './convert-payment';

/**
 * `resolvePaymentConversion` — TODO_PRODUIT.md T3's own per-operation, dated conversion. Pure and
 * DB-free (this file's own header), so every rule is proven with plain fixtures, no Prisma, no jest
 * mock of any store — the same discipline convert.spec.ts already holds for `convertMinor`/
 * `resolveLatestRate` themselves.
 */

function rate(overrides: Partial<CurrencyRateLike>): CurrencyRateLike {
  return {
    from: 'USD',
    to: 'EUR',
    rate: 0.9,
    asOf: new Date('2026-08-01T00:00:00.000Z'),
    source: 'manual',
    ...overrides,
  };
}

describe('resolvePaymentConversion', () => {
  it('same currency: a no-op passthrough — no rate lookup needed, nothing to convert', () => {
    const result = resolvePaymentConversion('EUR', 'EUR', 12000, [], new Date('2026-08-30'));
    expect(result).toEqual({
      ok: true,
      documentAmountMinor: 12000,
      rate: null,
      rateAsOf: null,
      rateSource: null,
    });
  });

  it('converts at the DATED rate — exact pinned amount, never a loose toBeCloseTo', () => {
    // 60.00 USD (minor 6000) at 0.9 EUR per USD: major 60 * 0.9 = 54 EUR -> minor round(5400) = 5400.
    const rates = [rate({ rate: 0.9, asOf: new Date('2026-08-01') })];
    const result = resolvePaymentConversion('EUR', 'USD', 6000, rates, new Date('2026-08-30'));
    expect(result).toEqual({
      ok: true,
      documentAmountMinor: 5400,
      rate: 0.9,
      rateAsOf: new Date('2026-08-01'),
      rateSource: 'manual',
    });
  });

  it('resolves the rate DATED TO THE PAYMENT (paidAt), not the most recent rate overall', () => {
    const rates = [
      rate({ rate: 0.9, asOf: new Date('2026-06-01') }), // true when the payment was made
      rate({ rate: 0.5, asOf: new Date('2026-09-01') }), // entered LATER, not yet true at paidAt
    ];
    // A payment received (paidAt) on 2026-07-15 — after the 0.9 rate, before the 0.5 one.
    const result = resolvePaymentConversion('EUR', 'USD', 10000, rates, new Date('2026-07-15'));
    expect(result).toEqual({
      ok: true,
      documentAmountMinor: 9000, // 100 USD * 0.9, never 0.5
      rate: 0.9,
      rateAsOf: new Date('2026-06-01'),
      rateSource: 'manual',
    });
  });

  it('no dated rate resolvable for the pair: refused, never a guessed rate', () => {
    const result = resolvePaymentConversion('EUR', 'USD', 6000, [], new Date('2026-08-30'));
    expect(result).toEqual({ ok: false });
  });

  it('a rate for the WRONG pair (EUR→USD entered, USD→EUR needed) does not answer — refused', () => {
    const rates = [rate({ from: 'EUR', to: 'USD', rate: 1.1 })];
    const result = resolvePaymentConversion('EUR', 'USD', 6000, rates, new Date('2026-08-30'));
    expect(result).toEqual({ ok: false });
  });

  it('a rate dated AFTER the payment (paidAt) is not eligible — refused, never a future rate applied retroactively', () => {
    const rates = [rate({ rate: 0.9, asOf: new Date('2026-09-01') })];
    const result = resolvePaymentConversion('EUR', 'USD', 6000, rates, new Date('2026-08-01'));
    expect(result).toEqual({ ok: false });
  });

  // ── The "piège daté" — UTC month-boundary, never local getters/constructors ──────────────────────
  describe('month-boundary dates, pinned exactly — UTC only, never a local-timezone getter', () => {
    it('a payment at 23:30 UTC on the LAST day of the month resolves a rate dated the FIRST of that same month', () => {
      const rates = [rate({ rate: 0.9, asOf: new Date('2026-08-01T00:00:00.000Z') })];
      const paidAt = new Date('2026-08-31T23:30:00.000Z');
      const result = resolvePaymentConversion('EUR', 'USD', 10000, rates, paidAt);
      expect(result).toEqual({
        ok: true,
        documentAmountMinor: 9000,
        rate: 0.9,
        rateAsOf: new Date('2026-08-01T00:00:00.000Z'),
        rateSource: 'manual',
      });
    });

    it('a rate dated exactly at UTC MIDNIGHT the next month is NOT yet eligible one second before it', () => {
      const rates = [
        rate({ rate: 0.9, asOf: new Date('2026-08-01T00:00:00.000Z') }),
        rate({ rate: 0.95, asOf: new Date('2026-09-01T00:00:00.000Z') }), // the next month, UTC midnight
      ];
      // One second before September, UTC — still August: the 0.95 rate must NOT apply yet.
      const paidAt = new Date('2026-08-31T23:59:59.000Z');
      const result = resolvePaymentConversion('EUR', 'USD', 10000, rates, paidAt);
      expect(result).toMatchObject({ ok: true, rate: 0.9, documentAmountMinor: 9000 });
    });

    it('the SAME instant, one second later (UTC midnight, September), the newer rate IS eligible', () => {
      const rates = [
        rate({ rate: 0.9, asOf: new Date('2026-08-01T00:00:00.000Z') }),
        rate({ rate: 0.95, asOf: new Date('2026-09-01T00:00:00.000Z') }),
      ];
      const paidAt = new Date('2026-09-01T00:00:00.000Z');
      const result = resolvePaymentConversion('EUR', 'USD', 10000, rates, paidAt);
      // 100 USD * 0.95 = 95 EUR -> minor 9500.
      expect(result).toMatchObject({ ok: true, rate: 0.95, documentAmountMinor: 9500 });
    });
  });

  // ── The rounding decision, spelled out and pinned (this file's own header: reuses convertMinor) ──
  describe('rounding — reuses convertMinor verbatim, round-half-up to the target minor unit', () => {
    it('a fractional minor-unit result rounds rather than truncates', () => {
      // 77 minor JPY (0 decimals) at 0.0065 EUR/JPY: major 77 * 0.0065 = 0.5005 -> minor round(50.05) = 50.
      const rates = [rate({ from: 'JPY', to: 'EUR', rate: 0.0065 })];
      const result = resolvePaymentConversion('EUR', 'JPY', 77, rates, new Date('2026-08-30'));
      expect(result).toEqual({
        ok: true,
        documentAmountMinor: 50,
        rate: 0.0065,
        rateAsOf: rates[0].asOf,
        rateSource: 'manual',
      });
    });

    it('rounds HALF-UP to the nearest target minor unit — the rounding rule is a pinned decision, not an accident (added by the T3 validation pass: the floor-mutation went unbitten, every prior pinned value landed exactly)', () => {
      // 100.01 USD at 0.925 → 92.50925 EUR → 9250.925 minor: round = 9251, floor = 9250.
      const rates = [rate({ from: 'USD', to: 'EUR', rate: 0.925 })];
      const result = resolvePaymentConversion('EUR', 'USD', 10001, rates, new Date('2026-08-30'));
      expect(result).toMatchObject({ ok: true, documentAmountMinor: 9251 });
    });

    it('climbs to MAJOR units before applying the rate — never a naive amountMinor * rate', () => {
      // The naive bug: 100 (minor JPY) * 0.0065 = 0.65, rounded to 1 — two orders of magnitude off.
      const rates = [rate({ from: 'JPY', to: 'EUR', rate: 0.0065 })];
      const result = resolvePaymentConversion('EUR', 'JPY', 100, rates, new Date('2026-08-30'));
      expect(result).toMatchObject({ ok: true, documentAmountMinor: 65 });
      expect((result as { documentAmountMinor: number }).documentAmountMinor).not.toBe(
        Math.round(100 * 0.0065),
      );
    });
  });
});
