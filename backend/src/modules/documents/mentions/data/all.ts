/**
 * The only aggregator — adding a country's mandatory mentions means adding `data/xx.json` and NOTHING
 * else, mirroring `transports/channel-policy/data/all.ts`'s own header verbatim on why this reads the
 * file with `fs.readFileSync` rather than `import`ing it as a TS module: editing a mention (or a rate
 * in its value table) is then a plain data change, never a TypeScript one, and needs no rebuild step
 * beyond what any other data file in this repo already needs (`nest-cli.json`'s own `**\/*.json`
 * asset rule copies these next to the compiled code in `dist/src`).
 *
 * Every rule is validated HERE, at load time (`assertValidMentionRule` — schema.ts), so a mention
 * with no `legalRef` fails as soon as this module is imported (at boot), never silently — the same
 * "a mandate without a citation does not load" discipline
 * `transports/channel-policy/data/all.ts` already holds for a channel mandate.
 *
 * Only France ships today, and that is a RESEARCHED CONCLUSION rather than a gap waiting to be
 * filled. The other four in-scope countries were each read against their primary source on
 * 2026-09-13 — Germany's UStG §§ 14, 14a, 14b and 19 (gesetze-im-internet.de), Poland's ustawa o VAT
 * art. 106e (the gazetted consolidated text on dziennikustaw.gov.pl), Italy's DPR 633/1972 art. 21
 * (normattiva.it), and Portugal's CIVA art. 36.º and 57.º (the AT's own consolidated PDF on
 * info.portaldasfinancas.gov.pt) — and NONE of them requires a mention on every invoice. What their
 * statutes require is either a STRUCTURED FIELD (which belongs to `content-requirements/` or
 * `country-fields/`, not here) or a mention CONDITIONED on the transaction: self-billing
 * ("Gutschrift", "samofakturowanie", "autofaturação"), reverse charge ("Steuerschuldnerschaft des
 * Leistungsempfängers", "odwrotne obciążenie", "inversione contabile", "IVA - autoliquidação"),
 * cash accounting ("metoda kasowa"), Poland's split-payment note above PLN 15 000 on Annex-15 goods,
 * the German retention notice owed only on construction work for a private recipient, the margin
 * schemes, and Portugal's own small-business note under art. 53.º.
 *
 * This resolver cannot express any of those: `resolveInvoiceNotes(file, at)` receives a country file
 * and a date and nothing else, so every `statutory: true` rule prints on EVERY invoice from that
 * country. Encoding a conditional mention here would put a false legal claim on documents it does not
 * apply to — strictly worse than printing nothing. France fits precisely because C. com. art. L441-9
 * I al. 5 applies to every B2B invoice unconditionally. Adding a fifth country therefore means either
 * finding a genuinely unconditional mention, or first giving `InvoiceNoteRule` a condition axis
 * evaluated against an explicit context (both call sites — `rendering/render-instance-pdf.ts` and
 * `formats/semantic/build-semantic-invoice.ts` — already hold the whole document), which is its own
 * piece of work and would still need transaction facts the product does not capture today.
 *
 * The list is DISCOVERED, not hand-maintained: `discoverCountryCodes()` reads this
 * directory with `readdirSync` and keeps only names matching `/^[a-z]{2}\.json$/` — a lowercase
 * two-letter code plus `.json`, which is a country file and nothing else (it excludes this `all.ts`
 * and `all.spec.ts`, neither of which is `.json`). Adding a second country's mentions is exactly its
 * own `data/xx.json`, no line to add here — `readdirSync` makes no ordering promise, so the codes are
 * sorted before loading regardless of how many ship.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidMentionRule, CountryMentionsFile } from '../schema';

const COUNTRY_FILE_PATTERN = /^[a-z]{2}\.json$/;

/** Every country code with a `data/xx.json` file next to this loader, sorted for a deterministic
 *  load order — see the module docstring for why this reads the directory instead of a fixed list. */
function discoverCountryCodes(): string[] {
  return readdirSync(__dirname)
    .filter((name) => COUNTRY_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function loadCountryFile(code: string): CountryMentionsFile {
  const path = join(__dirname, `${code}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as CountryMentionsFile;
  if (parsed.countryCode !== code.toUpperCase()) {
    throw new Error(
      `documents/mentions/data/${code}.json declares countryCode "${parsed.countryCode}", ` +
        `expected "${code.toUpperCase()}"`,
    );
  }
  for (const entry of parsed.invoiceNotes ?? []) {
    assertValidMentionRule(entry, `documents/mentions/data/${code}.json`);
  }
  return parsed;
}

/** Every wired jurisdiction's mandatory mentions, one file per country — see the module docstring. A
 *  country with no entry here has no mention at all: `invoice-notes.ts#resolveInvoiceNotes` emits
 *  nothing for it, and every existing CII/UBL/PDF test for a non-FR document is unaffected. */
export const ALL_MENTIONS_FILES: CountryMentionsFile[] = discoverCountryCodes().map(loadCountryFile);
