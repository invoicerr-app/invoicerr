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

  it('defaults to the real shipped catalog — the five wired countries each ship a real overlay (see data/all.ts)', () => {
    const catalog = new CountryFieldOverlayCatalog();
    expect(catalog.countries()).toEqual(['DE', 'FR', 'IT', 'PL', 'PT']);
    const supplyType = {
      op: 'add',
      path: 'lines',
      field: expect.objectContaining({ key: 'supplyType', kind: 'select' }),
    };
    expect(catalog.operationsFor('FR', 'invoice')).toEqual([supplyType]);
    expect(catalog.operationsFor('IT', 'invoice')).toEqual([supplyType]);
    expect(catalog.operationsFor('PT', 'invoice')).toEqual([supplyType]);
    expect(catalog.operationsFor('DE', 'invoice')).toEqual([
      {
        op: 'add',
        path: '',
        field: expect.objectContaining({ key: 'buyerReference', kind: 'text' }),
      },
      supplyType,
    ]);
    expect(catalog.operationsFor('PL', 'invoice')).toEqual([
      {
        op: 'add',
        path: '',
        field: expect.objectContaining({
          key: 'correctionReason',
          kind: 'text',
          requiredIfPresent: 'correctsInvoiceId',
        }),
      },
      supplyType,
    ]);
    // A country with no file at all still resolves to an empty list, never a throw.
    expect(catalog.operationsFor('ES', 'invoice')).toEqual([]);
  });
});
