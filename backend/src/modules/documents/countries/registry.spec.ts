/**
 * Same small contract test every sibling catalog's own registry.spec-equivalent holds — `has()`,
 * `countries()`, and the getter agree with each other and with the composed data underneath. Not
 * exercised by anything outside `countries/` yet (see registry.ts's own header).
 */
import { ALL_COMPOSED_COUNTRIES } from './compose';
import { ComposedCountryCatalog, defaultComposedCountryCatalog } from './registry';

describe('countries/registry — ComposedCountryCatalog', () => {
  it('countries() lists exactly the composed countries, sorted', () => {
    expect(defaultComposedCountryCatalog.countries()).toEqual(
      ALL_COMPOSED_COUNTRIES.map((v) => v.countryCode).sort(),
    );
  });

  it('has() agrees with countries() for every shipped code, case-insensitively', () => {
    for (const code of defaultComposedCountryCatalog.countries()) {
      expect(defaultComposedCountryCatalog.has(code)).toBe(true);
      expect(defaultComposedCountryCatalog.has(code.toLowerCase())).toBe(true);
    }
  });

  it('has() is false, and get() is undefined, for a country no catalog ships', () => {
    expect(defaultComposedCountryCatalog.has('ZZ')).toBe(false);
    expect(defaultComposedCountryCatalog.get('ZZ')).toBeUndefined();
  });

  it('get() returns the exact same object compose.ts produced, not a copy', () => {
    const fr = ALL_COMPOSED_COUNTRIES.find((v) => v.countryCode === 'FR')!;
    expect(defaultComposedCountryCatalog.get('FR')).toBe(fr);
    expect(defaultComposedCountryCatalog.get('fr')).toBe(fr);
  });

  it('a catalog built from an explicit, smaller list only knows about that list (constructor override works, like every sibling registry)', () => {
    const fr = ALL_COMPOSED_COUNTRIES.find((v) => v.countryCode === 'FR')!;
    const scoped = new ComposedCountryCatalog([fr]);
    expect(scoped.countries()).toEqual(['FR']);
    expect(scoped.has('DE')).toBe(false);
  });
});
