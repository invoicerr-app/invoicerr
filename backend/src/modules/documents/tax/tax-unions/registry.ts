/**
 * The tax-union reference table loader (issue #603, PR A) - the single place
 * `tax/tax-unions/data/tax-unions.json` is read off disk and validated, the same "validated once,
 * centrally" discipline `countries/data/all.ts` holds for the 6 shipped sellers' own composed view.
 * This table is NOT part of that composed view (see `schema.ts`'s own header on why: it must cover
 * every possible BUYER country, not only the 6 shipped sellers).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidTaxUnionsFile, TaxUnionCountryFact, TaxUnionsFile } from './schema';

const FILE_PATH = join(__dirname, 'data', 'tax-unions.json');
const CONTEXT = 'documents/tax/tax-unions/data/tax-unions.json';

function loadTaxUnionsFile(): TaxUnionsFile {
  const raw = readFileSync(FILE_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as TaxUnionsFile;
  assertValidTaxUnionsFile(parsed, CONTEXT);
  return parsed;
}

/** The validated file content - exported for tests and for anything that wants the raw rows (the
 *  before/after proof script this PR's own report links). Everything else should go through
 *  `TaxUnionRegistry` below. */
export const TAX_UNIONS_FILE: TaxUnionsFile = loadTaxUnionsFile();

export type TaxUnion = 'EU' | 'GCC';

function buildIndex(countries: TaxUnionCountryFact[]): Record<string, TaxUnionCountryFact> {
  const index: Record<string, TaxUnionCountryFact> = {};
  for (const fact of countries) index[fact.code] = fact;
  return index;
}

/** Keyed by `vatPrefix` (falling back to `code` when a row has none), NOT by `code` - the exact
 *  distinction that makes Greece ("GR" in ISO, "EL" in a VAT number) resolvable by either copy's own
 *  original lookup key: `build-semantic-invoice.ts`'s pre-existing `VAT_PREFIX_TO_PEPPOL_EAS` was
 *  keyed by VAT prefix, never by ISO code. */
function buildPeppolEasByPrefix(countries: TaxUnionCountryFact[]): Record<string, string> {
  const index: Record<string, string> = {};
  for (const fact of countries) {
    if (fact.peppolEas) index[fact.vatPrefix ?? fact.code] = fact.peppolEas;
  }
  return index;
}

/** Every 2-letter token the OCR heuristic should accept as VAT-id-shaped: both a recognized row's own
 *  `code` (when it is a real ISO code) and its `vatPrefix` (when set and different) - the exact pair
 *  the pre-existing `EU_VAT_PREFIXES` carried for Greece (both "GR" and "EL"). */
function buildOcrRecognizedPrefixes(countries: TaxUnionCountryFact[]): ReadonlySet<string> {
  const prefixes = new Set<string>();
  for (const fact of countries) {
    if (!fact.recognizedByOcr) continue;
    if (fact.iso3166) prefixes.add(fact.code);
    if (fact.vatPrefix) prefixes.add(fact.vatPrefix);
  }
  return prefixes;
}

/**
 * Read-only accessor over the tax-union reference table - the single source `tax/classification.ts`
 * (`taxUnionOf`), `formats/semantic/build-semantic-invoice.ts` (Peppol EAS) and
 * `formats/national/fatturapa-provider.ts` (EU decision) now all read, instead of each keeping its
 * own copy. `ocr-service/local-client.ts` reads `ocrRecognizedPrefixes()` directly (that module lives
 * outside `documents/`, the same cross-module import its own file already made to
 * `received-invoices/ocr/extractor`).
 */
export class TaxUnionRegistry {
  private readonly byCode: Record<string, TaxUnionCountryFact>;
  private readonly peppolEasByPrefix: Record<string, string>;
  private readonly ocrPrefixes: ReadonlySet<string>;

  constructor(file: TaxUnionsFile = TAX_UNIONS_FILE) {
    this.byCode = buildIndex(file.countries);
    this.peppolEasByPrefix = buildPeppolEasByPrefix(file.countries);
    this.ocrPrefixes = buildOcrRecognizedPrefixes(file.countries);
  }

  /** `'EU'`/`'GCC'`/`null` for an ISO country code - the exact signature the pre-existing
   *  `tax/classification.ts#taxUnionOf` already had. */
  taxUnionOf(countryCode: string): TaxUnion | null {
    const fact = this.byCode[(countryCode ?? '').toUpperCase()];
    if (!fact) return null;
    if (fact.euMember) return 'EU';
    if (fact.gccMember) return 'GCC';
    return null;
  }

  /** The OpenPeppol EAS code for a VAT identifier's own 2-letter prefix, or `undefined` when none is
   *  on file - looked up by PREFIX, never by ISO code (see `buildPeppolEasByPrefix`'s own header). */
  peppolEasForPrefix(prefix: string | null | undefined): string | undefined {
    if (!prefix) return undefined;
    return this.peppolEasByPrefix[prefix.toUpperCase()];
  }

  /** Every 2-letter token the OCR upload-screen heuristic should treat as VAT-id-shaped - see
   *  `buildOcrRecognizedPrefixes`'s own header. */
  ocrRecognizedPrefixes(): ReadonlySet<string> {
    return this.ocrPrefixes;
  }
}

export const defaultTaxUnionRegistry = new TaxUnionRegistry();
