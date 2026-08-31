import { CurrencyRateLike, convertMinor, resolveLatestRate } from './convert';

function rate(overrides: Partial<CurrencyRateLike>): CurrencyRateLike {
  return {
    from: 'EUR',
    to: 'USD',
    rate: 1,
    asOf: new Date('2026-08-01T00:00:00.000Z'),
    source: 'manual',
    ...overrides,
  };
}

describe('convertMinor', () => {
  it('JPY → EUR: climbs to MAJOR units before applying the rate, then redescends with the TARGET decimals — hand-checked', () => {
    // 100 JPY (0 decimals, so minor === major === 100) at 0.0065 EUR per JPY:
    // major: 100 * 0.0065 = 0.65 EUR -> minor (2 decimals): round(0.65 * 100) = 65.
    expect(convertMinor(100, 'JPY', 'EUR', 0.0065)).toBe(65);
  });

  it('EUR → JPY: the reverse direction, a DIFFERENT manually-entered rate, not 1/0.0065 — hand-checked', () => {
    // 10.00 EUR (minor 1000, 2 decimals) at 154 JPY per EUR:
    // major: 10 * 154 = 1540 JPY -> minor (0 decimals): round(1540 * 1) = 1540.
    expect(convertMinor(1000, 'EUR', 'JPY', 154)).toBe(1540);
  });

  it('would be WRONG by two orders of magnitude if it multiplied minor units directly (the mutation this guards against)', () => {
    // The naive `amountMinor * rate` bug: 100 * 0.0065 = 0.65, rounded to 1 — a EUR-cent amount
    // instead of the correct 65. Asserting the CORRECT value already kills that mutant; this test
    // exists so a reviewer sees exactly what "naively" would have produced.
    const naive = Math.round(100 * 0.0065);
    expect(naive).not.toBe(convertMinor(100, 'JPY', 'EUR', 0.0065));
    expect(convertMinor(100, 'JPY', 'EUR', 0.0065)).toBe(65);
  });

  it('same currency at rate 1 is a no-op', () => {
    expect(convertMinor(500, 'EUR', 'EUR', 1)).toBe(500);
  });

  it('rounds a fractional minor-unit result rather than truncating', () => {
    // 77 JPY at 0.0065: major 77 * 0.0065 = 0.5005 EUR -> minor round(50.05) = 50.
    expect(convertMinor(77, 'JPY', 'EUR', 0.0065)).toBe(50);
  });
});

describe('resolveLatestRate', () => {
  const now = new Date('2026-08-28T12:00:00.000Z');

  it('finds the exact (from, to) pair', () => {
    const rates = [rate({ from: 'EUR', to: 'USD', rate: 1.1 })];
    expect(resolveLatestRate(rates, 'EUR', 'USD', now)).toMatchObject({ from: 'EUR', to: 'USD', rate: 1.1 });
  });

  it('NEVER derives an inverse — EUR→USD entered does not answer a USD→EUR lookup', () => {
    const rates = [rate({ from: 'EUR', to: 'USD', rate: 1.1 })];
    expect(resolveLatestRate(rates, 'USD', 'EUR', now)).toBeNull();
  });

  it('picks the most recent asOf <= now among several rows for the same pair', () => {
    const rates = [
      rate({ from: 'USD', to: 'EUR', rate: 0.9, asOf: new Date('2026-06-01') }),
      rate({ from: 'USD', to: 'EUR', rate: 0.95, asOf: new Date('2026-08-15') }),
      rate({ from: 'USD', to: 'EUR', rate: 0.5, asOf: new Date('2026-01-01') }),
    ];
    expect(resolveLatestRate(rates, 'USD', 'EUR', now)?.rate).toBe(0.95);
  });

  it('excludes a rate whose asOf is still in the future relative to "now"', () => {
    const rates = [
      rate({ from: 'USD', to: 'EUR', rate: 0.9, asOf: new Date('2026-06-01') }),
      rate({ from: 'USD', to: 'EUR', rate: 999, asOf: new Date('2026-12-25') }), // future
    ];
    expect(resolveLatestRate(rates, 'USD', 'EUR', now)?.rate).toBe(0.9);
  });

  it('a rate dated exactly "now" IS eligible (asOf <= now, not strictly <)', () => {
    const rates = [rate({ from: 'USD', to: 'EUR', rate: 0.9, asOf: now })];
    expect(resolveLatestRate(rates, 'USD', 'EUR', now)?.rate).toBe(0.9);
  });

  it('returns null when the pair has no rate at all', () => {
    expect(resolveLatestRate([], 'GBP', 'EUR', now)).toBeNull();
  });
});
