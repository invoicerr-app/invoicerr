/**
 * The only aggregator — adding a country's channel policy means adding `data/xx.json` plus one line
 * here, mirroring `country-policy/data/all.ts`'s own header verbatim on why this reads the file with
 * `fs.readFileSync` rather than `import`ing it as a TS module: editing a fact is then a plain data
 * change, never a TypeScript one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidChannelPolicyFact, CountryChannelPolicyFile } from '../schema';

const COUNTRY_FILES = ['fr', 'pl', 'it'] as const;

function loadCountryFile(code: string): CountryChannelPolicyFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryChannelPolicyFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/transports/channel-policy/data/${code}.json declares countryCode ` +
        `"${parsed.countryCode}", expected "${code.toUpperCase()}"`,
    );
  }
  for (const fact of parsed.facts) {
    assertValidChannelPolicyFact(fact, `documents/transports/channel-policy/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's channel policy, one file per country — see the module docstring. A
 *  country with no entry here has no fact at all — the settings screen shows no "connect X" prompt
 *  and no invoice from that country is ever channel-mandated, never a guess in either direction. */
export const ALL_CHANNEL_POLICY_FILES: CountryChannelPolicyFile[] = COUNTRY_FILES.map(loadCountryFile);
