/**
 * The only aggregator — adding a country's channel suggestion means adding `data/xx.json` plus one
 * line here, mirroring `country-policy/data/all.ts`'s own header verbatim on why this reads the file
 * with `fs.readFileSync` rather than `import`ing it as a TS module: editing a suggestion is then a
 * plain data change, never a TypeScript one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidChannelSuggestion, CountryChannelSuggestionFile } from '../schema';

const COUNTRY_FILES = ['fr'] as const;

function loadCountryFile(code: string): CountryChannelSuggestionFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryChannelSuggestionFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/transports/channel-suggestion/data/${code}.json declares countryCode ` +
        `"${parsed.countryCode}", expected "${code.toUpperCase()}"`,
    );
  }
  for (const fact of parsed.suggestions) {
    assertValidChannelSuggestion(fact, `documents/transports/channel-suggestion/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's channel suggestion(s), one file per country — see the module
 *  docstring. A country with no entry here has no suggestion at all — the settings screen simply
 *  shows no "connect X" prompt, never a guess. */
export const ALL_CHANNEL_SUGGESTION_FILES: CountryChannelSuggestionFile[] =
  COUNTRY_FILES.map(loadCountryFile);
