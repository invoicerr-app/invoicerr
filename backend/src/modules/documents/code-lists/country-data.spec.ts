/**
 * Proves the code lists a country file actually ships reach the consumer-facing lookup, and that a
 * list mirroring the e-invoice tables cannot drift from them: the declarations model repeats the
 * FatturaPA codes so a declaration can be built without importing the invoice path, and this spec
 * is what keeps the two copies equal.
 */
import { ALL_COMPOSED_COUNTRIES } from '../countries/compose';
import { lookupIn } from './lookup';

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
