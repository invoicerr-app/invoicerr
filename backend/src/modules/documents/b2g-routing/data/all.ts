/**
 * The only aggregator — adding a country's B2G routing rule means adding `data/xx.json` plus one line
 * here, mirroring `channel-policy/data/all.ts`'s own header verbatim on why this reads the file with
 * `fs.readFileSync` rather than `import`ing it as a TS module: editing a rule is then a plain data
 * change, never a TypeScript one.
 *
 * This wave shipped exactly three countries — fr, de, it — per that task's own explicit scope
 * ("AUCUN pays au-delà de fr/de/it dans cette vague"). A FOURTH, es, is added by a LATER task (Spain
 * — FACe, Ley 25/2013, see `data/es.json`'s own header for the citation): unlike fr/de, es routes to
 * a channel THIS task also implements (`transports/face-transport.ts`), the same "already wired"
 * shape it.json already holds for SdI. A country with no entry here has NO B2G rule at all:
 * `b2g-routing.ts`'s own read side (which reads the DATABASE, not this file — see that module's own
 * header) surfaces that as an HONEST refusal ("no B2G rule declared for XX"), never a silent B2B
 * fallback — the entire point of this mechanism.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidB2gRoutingFact, B2gRoutingRuleFact } from '../schema';

const COUNTRY_FILES = ['fr', 'de', 'it', 'es'] as const;

interface RawB2gRoutingFile {
  countryCode: string;
  rule: B2gRoutingRuleFact;
}

function loadCountryFile(code: string): B2gRoutingRuleFact {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as RawB2gRoutingFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/b2g-routing/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  if (parsed.rule.countryCode !== parsed.countryCode) {
    throw new Error(
      `documents/b2g-routing/data/${code}.json: top-level countryCode ("${parsed.countryCode}") and ` +
        `rule.countryCode ("${parsed.rule.countryCode}") must match.`,
    );
  }
  assertValidB2gRoutingFact(parsed.rule, `documents/b2g-routing/data/${code}.json`);
  return parsed.rule;
}

/** Every wired jurisdiction's B2G routing rule, one file per country — see the module docstring. */
export const ALL_B2G_ROUTING_FILES: B2gRoutingRuleFact[] = COUNTRY_FILES.map(loadCountryFile);
