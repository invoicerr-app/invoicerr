import { byCodeUnit } from '@/lib/compare';

export interface CountryDriftLists {
  inSync: boolean;
  addedCountries: string[];
  changedCountries: string[];
  removedCountries: string[];
}

/** Compares a catalog's expected rows with the stored rows, country by country, through `signature`. */
export function classifyCountryDrift<Row extends { countryCode: string }>(
  expectedByCountry: Map<string, Row[]>,
  existingRows: Row[],
  signature: (rows: Row[]) => string,
): CountryDriftLists {
  const actualByCountry = new Map<string, Row[]>();
  for (const row of existingRows) {
    const bucket = actualByCountry.get(row.countryCode);
    if (bucket) bucket.push(row);
    else actualByCountry.set(row.countryCode, [row]);
  }

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const countryCode of new Set([...expectedByCountry.keys(), ...actualByCountry.keys()])) {
    const expected = expectedByCountry.get(countryCode);
    const actual = actualByCountry.get(countryCode);

    if (expected && !actual) {
      added.push(countryCode);
    } else if (!expected && actual) {
      removed.push(countryCode);
    } else if (expected && actual && signature(expected) !== signature(actual)) {
      changed.push(countryCode);
    }
  }

  return {
    inSync: added.length === 0 && changed.length === 0 && removed.length === 0,
    addedCountries: added.sort(byCodeUnit),
    changedCountries: changed.sort(byCodeUnit),
    removedCountries: removed.sort(byCodeUnit),
  };
}
