import { describe, expect, it } from 'vitest';

import { SUPPORTED_COUNTRY_CODES } from './data-pools';
import { generatePartyIdentifiers } from './party-identifiers';
import { createRng } from './rng';

const SEEDS = ['demo-seed-1', 42, 'a-very-different-seed'];
const PARTIES_PER_SEED = 3;

function sampleCountry(seed: string | number, countryCode: (typeof SUPPORTED_COUNTRY_CODES)[number]) {
  const rng = createRng(seed);
  const parties = Array.from({ length: PARTIES_PER_SEED }, () => generatePartyIdentifiers(rng, countryCode));
  // The next draw pins how much randomness the generator consumed, so later seed steps stay stable too.
  return { parties, nextDraw: rng() };
}

describe('generatePartyIdentifiers', () => {
  it.each(SEEDS)('produces a stable identifier set for every demo country with seed %s', (seed) => {
    const output = Object.fromEntries(SUPPORTED_COUNTRY_CODES.map((cc) => [cc, sampleCountry(seed, cc)]));
    expect(output).toMatchSnapshot();
  });
});
