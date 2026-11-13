/**
 * Proves the code lists a country file actually ships reach the consumer-facing lookup, and that a
 * list mirroring the e-invoice tables cannot drift from them: the declarations model repeats the
 * FatturaPA codes so a declaration can be built without importing the invoice path, and this spec
 * is what keeps the two copies equal.
 */
import { ALL_COMPOSED_COUNTRIES } from '../countries/compose';
import { lookupIn, UnmappedCodeError } from './lookup';

const countriesWithLists = ALL_COMPOSED_COUNTRIES.filter((country) => country.codeLists !== undefined);

describe('code lists shipped in countries/data', () => {
  it('ships at least one list, read by the shared lookup', () => {
    expect(countriesWithLists.length).toBeGreaterThan(0);
  });

  it('answers every list from its own data, without a fixture', () => {
    for (const country of countriesWithLists) {
      for (const list of country.codeLists!.lists) {
        if (list.entries[0].when) continue;
        expect(lookupIn(country.codeLists!, list.id, {}).code).toBe(list.entries[0].code);
      }
    }
  });

  it('repeats the invoice exemption codes a list mirrors, code for code', () => {
    for (const country of countriesWithLists) {
      const invoiceCodes = country.einvoiceCodes?.exemptionCodes?.map((entry) => entry.code) ?? [];
      if (invoiceCodes.length === 0) continue;
      const mirrored = country.codeLists!.lists.map((list) => list.entries.map((entry) => entry.code));
      expect(mirrored).toContainEqual(invoiceCodes);
    }
  });
});

describe('Polish VAT-UE parts, read from pl.json', () => {
  const polishLists = () => {
    const poland = ALL_COMPOSED_COUNTRIES.find((country) => country.countryCode === 'PL');
    if (!poland?.codeLists) throw new Error('pl.json ships no codeLists section');
    return poland.codeLists;
  };

  it.each([
    ['GOODS_SUPPLY', 'C'],
    ['GOODS_ACQUISITION', 'D'],
    ['SERVICE_SUPPLY', 'E'],
    ['CALL_OFF_STOCK_TRANSFER', 'F'],
  ])('reports a %s in part %s', (operation, part) => {
    expect(lookupIn(polishLists(), 'vatUePart', { operation }).code).toBe(part);
  });

  it('refuses an operation the form has no part for, instead of defaulting one', () => {
    expect(() => lookupIn(polishLists(), 'vatUePart', { operation: 'DOMESTIC_SUPPLY' })).toThrow(
      UnmappedCodeError,
    );
    expect(() => lookupIn(polishLists(), 'vatUePart', {})).toThrow(/No code in list "vatUePart"/);
  });
});
