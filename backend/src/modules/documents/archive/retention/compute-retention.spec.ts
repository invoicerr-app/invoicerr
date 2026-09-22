import { computeRetention } from './compute-retention';
import { CountryRetentionFile } from './schema';

// `origin: 'archivedAt'` deliberately, on every synthetic fixture in this first block — these tests
// exercise the MAX-of-simultaneous-rules / no-rule-null plumbing, not any one country's real legal
// origin (that is the second block below, plus the real `data/fr.json` and `data/de.json`). Counting
// from `archivedAt` keeps this arithmetic exactly as it was before the origin axis existed.
const FR_LIKE: CountryRetentionFile = {
  countryCode: 'FR',
  rules: [
    { label: 'fiscale', years: 6, origin: 'archivedAt', legalRef: 'LPF art. L102 B' },
    { label: 'commerciale', years: 10, origin: 'archivedAt', legalRef: 'C. com. art. L123-22' },
  ],
};

describe('computeRetention', () => {
  const archivedAt = new Date('2026-08-31T00:00:00.000Z');

  it('FR-shaped: retentionUntil is archivedAt + the LONGER of the two simultaneous durations (10y, commercial)', () => {
    const result = computeRetention(FR_LIKE, archivedAt, undefined);
    expect(result.retentionUntil?.toISOString()).toBe('2036-08-31T00:00:00.000Z');
  });

  it('FR-shaped: retentionBasis cites the winning rule AND names both simultaneous obligations', () => {
    const result = computeRetention(FR_LIKE, archivedAt, undefined);
    expect(result.retentionBasis).toMatch(/10y/);
    expect(result.retentionBasis).toMatch(/C\. com\. art\. L123-22/);
    // The other, shorter obligation is named too — never silently dropped, since it still applies.
    expect(result.retentionBasis).toMatch(/6y/);
    expect(result.retentionBasis).toMatch(/LPF art\. L102 B/);
  });

  it('a country with a single rule just applies that one, cited', () => {
    const single: CountryRetentionFile = {
      countryCode: 'XX',
      rules: [{ label: 'unique', years: 5, origin: 'archivedAt', legalRef: 'Some Act §1' }],
    };
    const result = computeRetention(single, archivedAt, undefined);
    expect(result.retentionUntil?.toISOString()).toBe('2031-08-31T00:00:00.000Z');
    expect(result.retentionBasis).toBe('unique 5y (Some Act §1).');
  });

  it('a country with no declared rules gets a NULL retentionUntil, never an invented duration', () => {
    const empty: CountryRetentionFile = { countryCode: 'ZZ', rules: [] };
    const result = computeRetention(empty, archivedAt, undefined);
    expect(result.retentionUntil).toBeNull();
    expect(result.retentionBasis).toMatch(/no retention rule declared/i);
    expect(result.retentionBasis).toMatch(/ZZ/);
  });

  it('an undefined file (no data at all for this country) is the same honest null, generically worded — archiving is not skipped for it', () => {
    const result = computeRetention(undefined, archivedAt, undefined);
    expect(result.retentionUntil).toBeNull();
    expect(result.retentionBasis).toMatch(/no retention rule declared for this country/i);
  });

  // ---------------------------------------------------------------------------------------------
  // The origin axis (2026-09-13) — proves each origin is honoured, and that NONE of them silently
  // fall back to `archivedAt`, which was the defect this axis exists to fix.
  // ---------------------------------------------------------------------------------------------
  describe('the origin axis', () => {
    it("'issueDate': counts from the document's own exact issue date, unrounded (France's fiscal rule)", () => {
      const file: CountryRetentionFile = {
        countryCode: 'FR',
        rules: [{ label: 'fiscale', years: 6, origin: 'issueDate', legalRef: 'LPF art. L102 B' }],
      };
      const issueDate = new Date('2026-03-15T00:00:00.000Z');
      // archivedAt is a WHOLE YEAR later than issueDate — proves the result tracks issueDate, not it.
      const result = computeRetention(file, new Date('2027-03-20T00:00:00.000Z'), issueDate);
      expect(result.retentionUntil?.toISOString()).toBe('2032-03-15T00:00:00.000Z');
    });

    it("'issueDateYearEnd': a German invoice issued in March is counted from 31 December of THAT year, never from archivedAt", () => {
      const file: CountryRetentionFile = {
        countryCode: 'DE',
        rules: [
          { label: 'umsatzsteuerlich', years: 8, origin: 'issueDateYearEnd', legalRef: 'UStG § 14b Abs. 1' },
        ],
      };
      const issueDate = new Date('2026-03-15T00:00:00.000Z');
      // archivedAt is deliberately a DIFFERENT day, months later — the old defect would have produced
      // a retentionUntil anchored on THIS date instead of the issue year's end.
      const archivedMuchLater = new Date('2026-11-02T00:00:00.000Z');
      const result = computeRetention(file, archivedMuchLater, issueDate);
      // 2026-12-31 (end of the ISSUE year, not 2026-11-02) + 8 years.
      expect(result.retentionUntil?.toISOString()).toBe('2034-12-31T23:59:59.999Z');
      expect(result.retentionBasis).toMatch(/8y/);
    });

    it("'fiscalYearEndUnknownSafe': issueDate + 1 year (never shorter) stands in for an unknowable financial-year close", () => {
      const file: CountryRetentionFile = {
        countryCode: 'FR',
        rules: [
          {
            label: 'commerciale',
            years: 10,
            origin: 'fiscalYearEndUnknownSafe',
            legalRef: 'C. com. art. L123-22',
          },
        ],
      };
      const issueDate = new Date('2026-05-10T00:00:00.000Z');
      const result = computeRetention(file, archivedAt, issueDate);
      // issueDate + 1y (safe stand-in for the unknown exercice close) + 10y = issueDate + 11y.
      expect(result.retentionUntil?.toISOString()).toBe('2037-05-10T00:00:00.000Z');
    });

    it('a rule needing issueDate resolves to honest null (never archivedAt) when issueDate is missing', () => {
      const file: CountryRetentionFile = {
        countryCode: 'DE',
        rules: [
          { label: 'umsatzsteuerlich', years: 8, origin: 'issueDateYearEnd', legalRef: 'UStG § 14b Abs. 1' },
        ],
      };
      const result = computeRetention(file, archivedAt, undefined);
      expect(result.retentionUntil).toBeNull();
      expect(result.retentionBasis).toMatch(/issue date is missing or unparseable/i);
      // Never silently computed from archivedAt instead — the whole point of this axis.
      expect(result.retentionBasis).not.toMatch(/2026-08-31/);
    });

    it("an 'archivedAt'-origin rule needs no issueDate at all and still resolves", () => {
      const file: CountryRetentionFile = {
        countryCode: 'XX',
        rules: [{ label: 'unique', years: 3, origin: 'archivedAt', legalRef: 'Some Act §1' }],
      };
      const result = computeRetention(file, archivedAt, undefined);
      expect(result.retentionUntil?.toISOString()).toBe('2029-08-31T00:00:00.000Z');
    });

    it("'taxDeadlineYearEndUnknownSafe': a December-issued Polish invoice is safely padded a WHOLE extra year, never counted from the issue year itself", () => {
      const file: CountryRetentionFile = {
        countryCode: 'PL',
        rules: [
          {
            label: 'VAT',
            years: 5,
            origin: 'taxDeadlineYearEndUnknownSafe',
            legalRef: 'ustawa o VAT art. 112, renvoi vers Ordynacja podatkowa art. 70 § 1',
          },
        ],
      };
      // Issued 20 December 2026 — under monthly VAT filing the payment deadline (25th of the
      // following month) falls in JANUARY 2027, so the true 5-year limitation period would run from
      // the end of 2027, not the end of 2026. `issueDateYearEnd` here would be a year SHORT.
      const issueDate = new Date('2026-12-20T00:00:00.000Z');
      const result = computeRetention(file, archivedAt, issueDate);
      // 31 Dec (issue year + 1) = 2027-12-31, + 5y = 2032-12-31 — never 2031-12-31 (issueDateYearEnd).
      expect(result.retentionUntil?.toISOString()).toBe('2032-12-31T23:59:59.999Z');
    });

    it("'taxDeadlineYearEndUnknownSafe': an invoice issued early in the year gets the SAME safe padding, even though its true deadline likely fell the same year", () => {
      const file: CountryRetentionFile = {
        countryCode: 'PL',
        rules: [{ label: 'VAT', years: 5, origin: 'taxDeadlineYearEndUnknownSafe', legalRef: 'art. 112' }],
      };
      const issueDate = new Date('2026-02-01T00:00:00.000Z');
      const result = computeRetention(file, archivedAt, issueDate);
      // 31 Dec 2027 (issue year + 1, the safe bound applied uniformly regardless of month) + 5y.
      expect(result.retentionUntil?.toISOString()).toBe('2032-12-31T23:59:59.999Z');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // France's REAL shipped rules (`data/fr.json`), re-examined under the origin axis — proves the
  // defect described in the retention brief: the old (archivedAt-based) computation was up to a full
  // year too EARLY, and the fix moves the date LATER, never shorter.
  // ---------------------------------------------------------------------------------------------
  describe('France — the real data/fr.json, before vs after the origin axis', () => {
    const FR_REAL: CountryRetentionFile = {
      countryCode: 'FR',
      rules: [
        { label: 'fiscale', years: 6, origin: 'issueDate', legalRef: 'LPF art. L102 B' },
        {
          label: 'commerciale',
          years: 10,
          origin: 'fiscalYearEndUnknownSafe',
          legalRef: 'C. com. art. L123-22',
        },
      ],
    };

    it('an invoice issued 2026-01-10 but archived later (2026-08-31): the new result is LATER than the old archivedAt-based one, by exactly 1 year', () => {
      const issueDate = new Date('2026-01-10T00:00:00.000Z');
      const archivedLater = new Date('2026-08-31T00:00:00.000Z');

      const result = computeRetention(FR_REAL, archivedLater, issueDate);
      // commerciale wins: issueDate + 1y (safe exercice-close stand-in) + 10y = issueDate + 11y.
      expect(result.retentionUntil?.toISOString()).toBe('2037-01-10T00:00:00.000Z');

      // The OLD (defective) computation this fixes: addYears(archivedAt, 10) — counted from the
      // archiving instant instead of the issue date.
      const oldDefectiveResult = new Date(archivedLater.getTime());
      oldDefectiveResult.setUTCFullYear(oldDefectiveResult.getUTCFullYear() + 10);
      expect(oldDefectiveResult.toISOString()).toBe('2036-08-31T00:00:00.000Z');

      // The fix moves retention LATER, never shorter — the only direction that matters (see the
      // retention brief: telling a company it may destroy a document it must still keep is the
      // failure mode). Delta here: exactly 132 days later (2036-08-31 -> 2037-01-10).
      expect(result.retentionUntil!.getTime()).toBeGreaterThan(oldDefectiveResult.getTime());
      const deltaDays = (result.retentionUntil!.getTime() - oldDefectiveResult.getTime()) / 86_400_000;
      expect(deltaDays).toBe(132);
    });

    it('an invoice issued AND archived the same day still moves later, by exactly 1 year (the safe fiscal-year padding)', () => {
      const sameDay = new Date('2026-08-31T00:00:00.000Z');
      const result = computeRetention(FR_REAL, sameDay, sameDay);
      // Here issueDate === archivedAt, so the only difference from the old defect is the +1y safe
      // padding for the commercial rule's unknown fiscal-year close.
      expect(result.retentionUntil?.toISOString()).toBe('2037-08-31T00:00:00.000Z');

      const oldDefectiveResult = new Date(sameDay.getTime());
      oldDefectiveResult.setUTCFullYear(oldDefectiveResult.getUTCFullYear() + 10);
      expect(result.retentionUntil!.getTime()).toBeGreaterThan(oldDefectiveResult.getTime());
      const deltaDays = (result.retentionUntil!.getTime() - oldDefectiveResult.getTime()) / 86_400_000;
      expect(deltaDays).toBe(365); // exactly 1 calendar year later; 29 Feb 2036 is not inside this span
    });
  });
});
