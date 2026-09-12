/**
 * The only aggregator — adding a country's B2G routing rule means adding `data/xx.json` and NOTHING
 * else, mirroring `channel-policy/data/all.ts`'s own header verbatim on why this reads the file with
 * `fs.readFileSync` rather than `import`ing it as a TS module: editing a rule is then a plain data
 * change, never a TypeScript one.
 *
 * HISTORY (kept for context — see the "DISCOVERED, not maintained" paragraph below for what actually
 * governs today's list, never this prose): shipped fr/de/it, then es (Spain, FACe) and pl. A 2026-09-02
 * audit of the remaining 23 EU member states (European Commission eInvoicing Country Factsheets, plus
 * the Polish Ministry of Finance's own KSeF portal for pl — see `B2G_COVERAGE.md` at the repo root for
 * the full 27-row audit table) then added TEN more: be/cy/ee/gr/lt/lu/lv/mt/se (generic Peppol BIS, no
 * national CIUS) and, once its NLCIUS blocker was closed by vendoring the delta, nl. AT/HR/DK/FI/IE/PT/
 * RO/SI/SK/BG/CZ/HU were read at the time and deliberately left unshipped (no vendorable national CIUS,
 * or no confirmed Peppol reachability) — see `B2G_COVERAGE.md` for the citation behind each one.
 *
 * The product's scope was then reduced to five countries (FR/PL/IT/PT/DE, 2026-09-10): every rule
 * outside that set was deleted along with its `data/xx.json` (`b2g-routing/data/all.spec.ts`'s own
 * header has the exact list). For es and nl specifically, a LATER pass (2026-09-12) went further and
 * deleted the transport/format code that had implemented their channel outright — FACe/Facturae
 * (`transports/face-transport.ts`, `formats/national/facturae-provider.ts`) and NLCIUS
 * (`formats/nlcius-provider.ts`, `formats/vendored/nl/`) — rather than leaving fully-working code
 * registered for a country nobody asked to support; see `LIVE_TESTING.md`/`B2G_COVERAGE.md` for exactly
 * what that gave up. A country with no entry here has NO B2G rule at all: `b2g-routing.ts`'s own read
 * side (which reads the DATABASE, not this file — see that module's own header) surfaces that as an
 * HONEST refusal ("no B2G rule declared for XX"), never a silent B2B fallback — the entire point of
 * this mechanism.
 *
 * The country list above used to be a hand-maintained array; it is now DISCOVERED, not maintained —
 * `discoverCountryCodes()` reads this directory with `readdirSync` and keeps only names matching
 * `/^[a-z]{2}\.json$/` — a lowercase two-letter code plus `.json`, which is a country file and
 * nothing else (it excludes this `all.ts` and `all.spec.ts`, neither of which is `.json`).
 * `readdirSync` makes no ordering promise, so the codes are sorted before loading — deterministic,
 * reproducible, independent of the OS or filesystem. Adding a country back needs only its own
 * `data/xx.json` (and, if its channel's code was also deleted, that code rebuilt) — the prose above
 * stays the historical record of WHY each wave shipped when it did, not a registration step to repeat.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidB2gRoutingFact, B2gRoutingRuleFact } from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order — see the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

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
export const ALL_B2G_ROUTING_FILES: B2gRoutingRuleFact[] = discoverCountryCodes().map(loadCountryFile);
