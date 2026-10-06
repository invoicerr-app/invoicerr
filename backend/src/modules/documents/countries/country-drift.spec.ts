import { classifyCountryDrift } from './country-drift';

interface Row {
  countryCode: string;
  value: string;
}

const signature = (rows: Row[]): string => rows.map((row) => row.value).join(',');

describe('classifyCountryDrift', () => {
  it('reports each list in code unit order, uppercase before lowercase', () => {
    const expected = new Map<string, Row[]>([
      ['zz', [{ countryCode: 'zz', value: '1' }]],
      ['BB', [{ countryCode: 'BB', value: '1' }]],
      ['aa', [{ countryCode: 'aa', value: '1' }]],
      ['CC', [{ countryCode: 'CC', value: '1' }]],
    ]);
    const existing: Row[] = [
      { countryCode: 'aa', value: '2' },
      { countryCode: 'CC', value: '2' },
      { countryCode: 'yy', value: '1' },
      { countryCode: 'DD', value: '1' },
    ];

    expect(classifyCountryDrift(expected, existing, signature)).toEqual({
      inSync: false,
      addedCountries: ['BB', 'zz'],
      changedCountries: ['CC', 'aa'],
      removedCountries: ['DD', 'yy'],
    });
  });

  it('is in sync when every country signature matches', () => {
    const rows: Row[] = [{ countryCode: 'AA', value: '1' }];

    expect(classifyCountryDrift(new Map([['AA', rows]]), [...rows], signature).inSync).toBe(true);
  });
});
