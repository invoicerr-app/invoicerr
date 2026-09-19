import { DomesticReverseChargeCategoryFact } from './schema';
import { isCategoryInForce } from './in-force';

const BASE: DomesticReverseChargeCategoryFact = {
  key: 'it-consumer-electronics-preretail',
  label: 'Game consoles, tablets, laptops and integrated circuits, before retail installation',
  legalRef: 'DPR 633/1972 art. 17 comma 6 lett. c)',
  provenance: {
    kind: 'legal',
    sourceText: 'alle cessioni di console da gioco, tablet PC e laptop...',
    sourceCheckedAt: '2026-09-13',
  },
};

describe('isCategoryInForce', () => {
  it('is true for a category with neither validFrom nor validUntil, on any date', () => {
    expect(isCategoryInForce(BASE, '2020-01-01')).toBe(true);
    expect(isCategoryInForce(BASE, '2099-01-01')).toBe(true);
  });

  describe('a category with a validUntil sunset (Italy, 2026-12-31)', () => {
    const sunset: DomesticReverseChargeCategoryFact = { ...BASE, validUntil: '2026-12-31' };

    it('is in force BEFORE the sunset date', () => {
      expect(isCategoryInForce(sunset, '2026-12-30')).toBe(true);
    });

    it('is in force ON the sunset date itself — validUntil is INCLUSIVE', () => {
      expect(isCategoryInForce(sunset, '2026-12-31')).toBe(true);
    });

    it('is still in force on the sunset date even with a non-midnight time-of-day', () => {
      expect(isCategoryInForce(sunset, '2026-12-31T23:59:59.000Z')).toBe(true);
    });

    it('is NOT in force the day AFTER the sunset date', () => {
      expect(isCategoryInForce(sunset, '2027-01-01')).toBe(false);
    });

    it('accepts a Date instance the same way as an ISO string', () => {
      expect(isCategoryInForce(sunset, new Date('2026-12-31'))).toBe(true);
      expect(isCategoryInForce(sunset, new Date('2027-01-01'))).toBe(false);
    });
  });

  describe('a category with a validFrom effective date (Portugal, 2026-07-01)', () => {
    const effective: DomesticReverseChargeCategoryFact = { ...BASE, validFrom: '2026-07-01' };

    it('is NOT in force BEFORE the effective date', () => {
      expect(isCategoryInForce(effective, '2026-06-30')).toBe(false);
    });

    it('is in force ON the effective date itself', () => {
      expect(isCategoryInForce(effective, '2026-07-01')).toBe(true);
    });

    it('is in force AFTER the effective date', () => {
      expect(isCategoryInForce(effective, '2026-07-02')).toBe(true);
    });
  });

  describe('a category with both bounds', () => {
    const windowed: DomesticReverseChargeCategoryFact = {
      ...BASE,
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
    };

    it('is out of force before validFrom, in force within the window, out of force after validUntil', () => {
      expect(isCategoryInForce(windowed, '2025-12-31')).toBe(false);
      expect(isCategoryInForce(windowed, '2026-06-15')).toBe(true);
      expect(isCategoryInForce(windowed, '2027-01-01')).toBe(false);
    });
  });

  it('returns false — never true — for an onDate that fails to parse', () => {
    expect(isCategoryInForce(BASE, 'not-a-date')).toBe(false);
    expect(isCategoryInForce({ ...BASE, validUntil: '2026-12-31' }, 'not-a-date')).toBe(false);
  });
});
