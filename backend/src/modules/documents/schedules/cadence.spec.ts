import { computeNextOccurrence, deriveAnchorDay, toUtcMidnight } from './cadence';

function utc(year: number, month1Indexed: number, day: number): Date {
  return new Date(Date.UTC(year, month1Indexed - 1, day));
}

describe('computeNextOccurrence', () => {
  describe('monthly, anchored at the 31st — MUTATION TARGET #1 lives in the clamp below', () => {
    // THE MUTATION TARGET: removing `Math.min(targetDay, daysInUtcMonth(...))` (cadence.ts) and
    // simply setting the day to `targetDay` unconditionally reproduces exactly the historic JS
    // footgun this whole file exists to avoid — `new Date(2026, 1, 31)` silently OVERFLOWS into
    // March (JS "normalizes" an out-of-range day into the next month), so 31 Jan + 1 month would
    // become "3 Mar" instead of the correct "28 Feb", and the chain below would read
    // 31 Jan -> 3 Mar -> 3 Apr -> ... — every one of these hand-computed assertions would fail the
    // moment the clamp is gone.
    it('31 Jan 2026 -> 28 Feb 2026 (2026 is not a leap year)', () => {
      expect(computeNextOccurrence(utc(2026, 1, 31), 'monthly', 31)).toEqual(utc(2026, 2, 28));
    });

    it('31 Jan 2024 -> 29 Feb 2024 (2024 IS a leap year)', () => {
      expect(computeNextOccurrence(utc(2024, 1, 31), 'monthly', 31)).toEqual(utc(2024, 2, 29));
    });

    it('28 Feb 2026 -> 31 Mar 2026 — the anchor (31) is remembered, never the clamped 28', () => {
      // This is the case a "just add a month to whatever day we're currently on" implementation
      // gets wrong: chaining off Feb's own (clamped) day would produce 28 Mar, not 31 Mar.
      expect(computeNextOccurrence(utc(2026, 2, 28), 'monthly', 31)).toEqual(utc(2026, 3, 31));
    });

    it('30 Apr 2026 -> 31 May 2026 (April has 30 days, May has 31 — no drift)', () => {
      expect(computeNextOccurrence(utc(2026, 3, 31), 'monthly', 31)).toEqual(utc(2026, 4, 30));
      expect(computeNextOccurrence(utc(2026, 4, 30), 'monthly', 31)).toEqual(utc(2026, 5, 31));
    });

    it('31 Dec 2026 -> 31 Jan 2027 (year rollover)', () => {
      expect(computeNextOccurrence(utc(2026, 12, 31), 'monthly', 31)).toEqual(utc(2027, 1, 31));
    });
  });

  describe('quarterly, anchored at the 31st', () => {
    it('31 Jan 2026 -> 30 Apr 2026 (April, 3 months later, only has 30 days)', () => {
      expect(computeNextOccurrence(utc(2026, 1, 31), 'quarterly', 31)).toEqual(utc(2026, 4, 30));
    });

    it('30 Apr 2026 -> 31 Jul 2026 — the anchor (31) is restored once the quarter allows it', () => {
      expect(computeNextOccurrence(utc(2026, 4, 30), 'quarterly', 31)).toEqual(utc(2026, 7, 31));
    });
  });

  describe('yearly, anchored on 29 Feb — the leap-year case', () => {
    it('29 Feb 2024 -> 28 Feb 2025 (2025 is not a leap year: clamped)', () => {
      expect(computeNextOccurrence(utc(2024, 2, 29), 'yearly', 29)).toEqual(utc(2025, 2, 28));
    });

    it('28 Feb 2025 -> 28 Feb 2026 (still not a leap year: the anchor stays clamped)', () => {
      expect(computeNextOccurrence(utc(2025, 2, 28), 'yearly', 29)).toEqual(utc(2026, 2, 28));
    });

    it('28 Feb 2027 -> 29 Feb 2028 — the anchor (29) is restored the next leap year, never stuck at 28', () => {
      expect(computeNextOccurrence(utc(2027, 2, 28), 'yearly', 29)).toEqual(utc(2028, 2, 29));
    });
  });

  describe('weekly — no month to overflow, so no clamping question at all', () => {
    it('1 Jan 2026 (Thursday) -> 8 Jan 2026', () => {
      expect(computeNextOccurrence(utc(2026, 1, 1), 'weekly')).toEqual(utc(2026, 1, 8));
    });

    it('crosses a month boundary the same as any other 7-day jump: 28 Jan 2026 -> 4 Feb 2026', () => {
      expect(computeNextOccurrence(utc(2026, 1, 28), 'weekly')).toEqual(utc(2026, 2, 4));
    });
  });

  it("falls back to `current`'s own day when no anchorDay is passed at all (defensive only)", () => {
    // Every REAL schedule always carries an anchorDay (deriveAnchorDay, set at creation) — this is
    // the defensive fallback for a caller that genuinely has none, not the normal path.
    expect(computeNextOccurrence(utc(2026, 1, 15), 'monthly')).toEqual(utc(2026, 2, 15));
  });
});

describe('deriveAnchorDay', () => {
  it('reads the UTC day-of-month, regardless of time-of-day', () => {
    expect(deriveAnchorDay(new Date('2026-01-31T23:59:59.000Z'))).toBe(31);
  });
});

describe('toUtcMidnight', () => {
  it('strips the time-of-day, keeping the same UTC calendar day', () => {
    expect(toUtcMidnight(new Date('2026-08-31T17:42:00.000Z'))).toEqual(utc(2026, 8, 31));
  });
});
