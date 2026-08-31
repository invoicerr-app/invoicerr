import { computeRetention } from './compute-retention';
import { CountryRetentionFile } from './schema';

const FR: CountryRetentionFile = {
  countryCode: 'FR',
  rules: [
    { label: 'fiscale', years: 6, legalRef: 'LPF art. L102 B' },
    { label: 'commerciale', years: 10, legalRef: 'C. com. art. L123-22' },
  ],
};

describe('computeRetention', () => {
  const archivedAt = new Date('2026-08-31T00:00:00.000Z');

  it('FR: retentionUntil is archivedAt + the LONGER of the two simultaneous durations (10y, commercial)', () => {
    const result = computeRetention(FR, archivedAt);
    expect(result.retentionUntil?.toISOString()).toBe('2036-08-31T00:00:00.000Z');
  });

  it('FR: retentionBasis cites the winning rule AND names both simultaneous obligations', () => {
    const result = computeRetention(FR, archivedAt);
    expect(result.retentionBasis).toMatch(/10y/);
    expect(result.retentionBasis).toMatch(/C\. com\. art\. L123-22/);
    // The other, shorter obligation is named too — never silently dropped, since it still applies.
    expect(result.retentionBasis).toMatch(/6y/);
    expect(result.retentionBasis).toMatch(/LPF art\. L102 B/);
  });

  it('a country with a single rule just applies that one, cited', () => {
    const single: CountryRetentionFile = {
      countryCode: 'XX',
      rules: [{ label: 'unique', years: 5, legalRef: 'Some Act §1' }],
    };
    const result = computeRetention(single, archivedAt);
    expect(result.retentionUntil?.toISOString()).toBe('2031-08-31T00:00:00.000Z');
    expect(result.retentionBasis).toBe('unique 5y (Some Act §1).');
  });

  it('a country with no declared rules gets a NULL retentionUntil, never an invented duration', () => {
    const empty: CountryRetentionFile = { countryCode: 'ZZ', rules: [] };
    const result = computeRetention(empty, archivedAt);
    expect(result.retentionUntil).toBeNull();
    expect(result.retentionBasis).toMatch(/no retention rule declared/i);
    expect(result.retentionBasis).toMatch(/ZZ/);
  });

  it('an undefined file (no data at all for this country) is the same honest null, generically worded', () => {
    const result = computeRetention(undefined, archivedAt);
    expect(result.retentionUntil).toBeNull();
    expect(result.retentionBasis).toMatch(/no retention rule declared for this country/i);
  });
});
