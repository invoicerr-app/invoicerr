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
 *
 * A LATER audit task (2026-09-02, "il manque du B2G pour des pays") went through the remaining 23 EU
 * member states one by one, reading the European Commission's own eInvoicing Country Factsheets
 * (ec.europa.eu/digital-building-blocks) plus, for pl, the Polish Ministry of Finance's own KSeF
 * portal — see `B2G_COVERAGE.md` at the repo root for the full 27-row audit table (read/covered,
 * read-but-not-deliverable and why, unreadable and what was attempted). TEN countries came back
 * genuinely deliverable with this repo's OWN existing bricks and were added: be/cy/ee/gr/lt/lu/lv/mt/
 * se (all `transportId: "peppol"`, `formatSyntax: "peppol-bis"` — the generic, no-national-CIUS case;
 * see each file's own header for its own citation) and pl (`transportId: "ksef"`, `formatSyntax:
 * "fa3"` — Poland's OWN national channel/format, already implemented and already proven live,
 * deliberately chosen over the Peppol-based PEF platform whose Polish-specific extension this repo
 * does not vendor; see `data/pl.json`'s own header for why). THIRTEEN more were read and are
 * DELIBERATELY NOT shipped here — a required national CIUS this repo does not vendor (at/hr/dk/fi/ie/
 * nl/pt/ro/si/sk) or no confirmed Peppol-network reachability for the country's own closed platform
 * (bg/cz/hu) — see `B2G_COVERAGE.md` for the citation behind each one; adding a rule for any of them
 * today would mean either claiming a format this repo cannot actually build, or a channel with no
 * evidence it is reachable at all — precisely the "artefact qui a l'air conforme sans l'être" this
 * whole mechanism exists to refuse.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidB2gRoutingFact, B2gRoutingRuleFact } from '../schema';

const COUNTRY_FILES = [
  'fr',
  'de',
  'it',
  'es',
  'be',
  'cy',
  'ee',
  'gr',
  'lt',
  'lu',
  'lv',
  'mt',
  'pl',
  'se',
] as const;

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
