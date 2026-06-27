import { Temporal } from './schema';
import { allByDate, pickByDate } from './temporal';

const rules: Temporal<string>[] = [
  { validFrom: '1900-01-01', validTo: '2026-09-01', value: 'POST_AUDIT' },
  { validFrom: '2026-09-01', value: 'CTC' },
];

describe('pickByDate', () => {
  it('returns the window in force', () => {
    expect(pickByDate(rules, new Date('2020-05-05'))).toBe('POST_AUDIT');
    expect(pickByDate(rules, new Date('2027-01-01'))).toBe('CTC');
  });

  it('treats validTo as EXCLUSIVE (the boundary day belongs to the next window)', () => {
    expect(pickByDate(rules, new Date('2026-08-31'))).toBe('POST_AUDIT');
    expect(pickByDate(rules, new Date('2026-09-01'))).toBe('CTC');
  });

  it('prefers the latest validFrom when windows overlap', () => {
    const overlapping: Temporal<string>[] = [
      { validFrom: '2000-01-01', value: 'base' },
      { validFrom: '2020-01-01', value: 'newer' },
    ];
    expect(pickByDate(overlapping, new Date('2021-01-01'))).toBe('newer');
  });

  it('returns null when nothing is in force', () => {
    expect(pickByDate([{ validFrom: '2030-01-01', value: 'future' }], new Date('2025-01-01'))).toBeNull();
  });
});

describe('allByDate', () => {
  it('returns every rule in force (for selector differentiation at the same date)', () => {
    const multi: Temporal<string>[] = [
      { validFrom: '2026-09-01', value: 'b2b' },
      { validFrom: '2026-09-01', value: 'b2c' },
      { validFrom: '2030-01-01', value: 'future' },
    ];
    expect(allByDate(multi, new Date('2027-01-01')).sort()).toEqual(['b2b', 'b2c']);
  });
});
