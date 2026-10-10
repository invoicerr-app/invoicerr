import { domesticCurrencyFor } from './seed-company';

describe('domesticCurrencyFor', () => {
  it.each([
    ['DE', 'EUR'],
    ['DZ', 'DZD'],
    ['FR', 'EUR'],
    ['IT', 'EUR'],
    ['PL', 'PLN'],
    ['PT', 'EUR'],
  ] as const)('%s bills its domestic documents in %s', (countryCode, currency) => {
    expect(domesticCurrencyFor({ countryCode })).toBe(currency);
  });

  it('refuses a country with no currency on file', () => {
    expect(() => domesticCurrencyFor({ countryCode: 'XX' } as never)).toThrow(/XX declares neither/);
  });
});
