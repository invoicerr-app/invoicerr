/**
 * The VAT rate catalog — a per-country, sourced list of the VAT rates a business in that country can
 * actually choose from for one invoice LINE (see descriptors/invoice.descriptor.ts's `vatRate` field
 * and descriptors/company-view.ts, which is what actually fills a field's `options` from this data
 * per company). Restored from the removed compliance engine's own tax-rates catalog — recoverable at
 * git tag `avant-refonte-documents:backend/src/compliance/tax-rates/schema.ts` — but re-expressed in
 * THIS branch's own provenance vocabulary (`kind: 'legal' | 'unverified'`) rather than the old
 * OFFICIAL/UNVERIFIED/BEST_EFFORT/PLANNED/FALLBACK `Confidence` scale, so every sourced fact this
 * "documents" module declares (this catalog, and country-policy/schema.ts's own document-action
 * rules) means EXACTLY the same thing by "legal" and "unverified".
 *
 * This is presentation/choice data for a document's own field, never a second tax authority: nothing
 * in this branch computes tax from it (there is no tax engine left in this codebase at all — see
 * contributions/invoice-contributions.ts's own "no VAT, no rounding rule" boundary). A rate here is
 * exactly what a user picks from a dropdown, with the source that justifies the number sitting right
 * next to it.
 *
 * The provenance shape is DELIBERATELY NOT imported from country-policy/schema.ts even though it is
 * structurally identical (`kind: 'legal' | 'unverified'`, same two payload shapes): that file's own
 * header already explains why it duplicates a few lines of company/country resolution rather than
 * share a helper ("this one needs a DIFFERENT [...] message [...] a shared helper would either have
 * to parameterize the message anyway or risk perturbing the already-tested one") — the same argument
 * applies here: `assertValidVatRateProvenance`'s error names a rate's `id`, not a rule's
 * `typeId.actionId`, so sharing one function would mean branching on which caller it is. Two small,
 * independently-readable copies beat one function that has to know about both shapes of caller.
 */

export interface LegalProvenance {
  kind: 'legal';
  /** The exact text this rate is based on — quoted, not paraphrased. */
  sourceText: string;
  /** ISO date (yyyy-mm-dd) this text was last checked against its source. */
  sourceCheckedAt: string;
}

export interface UnverifiedProvenance {
  kind: 'unverified';
  /** What would have to be checked (which text, which register, which authority) to turn this into a
   *  `legal` entry — never left blank, the same discipline country-policy/schema.ts's own
   *  `UnverifiedProvenance` holds. */
  resolutionNote: string;
}

export type VatRateProvenance = LegalProvenance | UnverifiedProvenance;

/**
 * A coarse, user-facing bucket for grouping a country's own rate ladder in a dropdown — NOT the EN
 * 16931 BT-151 category code (`S`/`Z`/`E`/`AE`/`K`/`G`/`O`, a legal-invoice classification a proper
 * tax engine would derive). A country with more than one rate below "standard" (France has three: 10
 * / 5.5 / 2.1) places the ones below its ordinary reduced rate under SUPER_REDUCED — `label` carries
 * the exact official term (e.g. "Taux particulier"), this field only carries the ranking.
 */
export type VatRateCategory = 'STANDARD' | 'REDUCED' | 'SUPER_REDUCED' | 'ZERO' | 'EXEMPT';

export interface VatRateFact {
  /** Stable slug, unique within the country file, e.g. "fr-standard" — identifies the CONCEPT (the
   *  standard rate), not a specific number, so a rate change over time would be a new entry with a
   *  fresh id rather than silently overwriting this one's meaning. (This catalog does not model
   *  temporal validity at all today — see data/fr.json's own header for why — so in practice this id
   *  is simply this rate's stable identity for as long as it is current.) */
  id: string;
  /** Percentage, e.g. 20 for 20%. Stored as the field's value in a 'select' field descriptor as the
   *  STRING form of this number (e.g. "20") — see registry.ts's `vatRateFieldOptions`. */
  rate: number;
  /** Human label, the country's own official term where one exists (e.g. "Taux normal"). Shown to
   *  the user as-is — it is DATA, like a client or article name, not application chrome, so it is
   *  deliberately NOT run through i18n `t()` (same convention every other descriptor `label` in this
   *  module already follows). */
  label: string;
  category: VatRateCategory;
  provenance: VatRateProvenance;
  /** Caveats, or — for an `unverified` entry — anything beyond what `resolutionNote` already says. */
  notes?: string;
}

export interface CountryVatRatesFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  rates: VatRateFact[];
  /** Free-form, file-level caveats — distinct from a per-rate `notes`. */
  notes?: string;
}

export class InvalidVatRateProvenanceError extends Error {}

/**
 * The one gate a rate cannot get past without a real provenance — see this file's header for why
 * this is its own small function rather than a shared one with country-policy/schema.ts's
 * `assertValidProvenance`. Called from two independent places (data/all.ts at load time, and
 * available for any future seed step) so neither a hand-built catalog nor a JSON file that skipped
 * this exact shape can slip a bare, unsourced rate through.
 */
export function assertValidVatRateProvenance(fact: VatRateFact, context: string): void {
  const provenance = fact.provenance as { kind?: unknown } | null | undefined;
  if (!provenance || (provenance.kind !== 'legal' && provenance.kind !== 'unverified')) {
    throw new InvalidVatRateProvenanceError(
      `${context}: VAT rate "${fact.id}" has no valid provenance (kind must be "legal" or ` +
        '"unverified") — a VAT rate may never exist without saying where it came from.',
    );
  }

  if (provenance.kind === 'legal') {
    const legal = fact.provenance as LegalProvenance;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidVatRateProvenanceError(
        `${context}: VAT rate "${fact.id}" claims "legal" provenance but is missing sourceText ` +
          'and/or sourceCheckedAt.',
      );
    }
    return;
  }

  const unverified = fact.provenance as UnverifiedProvenance;
  if (!unverified.resolutionNote?.trim()) {
    throw new InvalidVatRateProvenanceError(
      `${context}: VAT rate "${fact.id}" is "unverified" but has no resolutionNote — an unverified ` +
        'rate must say what would settle it.',
    );
  }
}
