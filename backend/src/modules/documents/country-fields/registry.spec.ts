import { CountryFieldOverlayFile } from './schema';
import { CountryFieldOverlayCatalog } from './registry';

const FR_FILE: CountryFieldOverlayFile = {
  countryCode: 'FR',
  overlays: [
    {
      typeId: 'invoice',
      operations: [{ op: 'remove', path: '', key: 'notes' }],
    },
  ],
};

describe('CountryFieldOverlayCatalog', () => {
  it('is case-insensitive and reports which countries it knows', () => {
    const catalog = new CountryFieldOverlayCatalog([FR_FILE]);
    expect(catalog.has('fr')).toBe(true);
    expect(catalog.has('FR')).toBe(true);
    expect(catalog.has('DE')).toBe(false);
    expect(catalog.countries()).toEqual(['FR']);
  });

  it('returns the operations declared for a known (country, typeId) pair', () => {
    const catalog = new CountryFieldOverlayCatalog([FR_FILE]);
    expect(catalog.operationsFor('FR', 'invoice')).toEqual([{ op: 'remove', path: '', key: 'notes' }]);
  });

  it('returns an empty list — never throws — for a country with no file at all', () => {
    const catalog = new CountryFieldOverlayCatalog([FR_FILE]);
    expect(catalog.operationsFor('DE', 'invoice')).toEqual([]);
  });

  it('returns an empty list — never throws — for a known country whose file does not mention this type', () => {
    const catalog = new CountryFieldOverlayCatalog([FR_FILE]);
    expect(catalog.operationsFor('FR', 'quote')).toEqual([]);
  });

  it('defaults to the real shipped catalog, which is empty today (see data/all.ts)', () => {
    const catalog = new CountryFieldOverlayCatalog();
    expect(catalog.countries()).toEqual([]);
    expect(catalog.operationsFor('FR', 'invoice')).toEqual([]);
  });
});
