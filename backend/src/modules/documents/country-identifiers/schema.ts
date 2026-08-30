/**
 * The country IDENTIFIER-REQUIREMENTS catalog — the same "a country is data" family as
 * country-policy/schema.ts, for a genuinely different concern: not which document ACTIONS a
 * country allows (country-policy/), not which FIELDS a document type has (country-fields/), but
 * which national identifier SCHEMES (SIRET, EIN, VAT…) a party of a given type must supply before
 * an invoice can be issued to or by it. See data/fr.json and data/us.json for worked examples, and
 * country-identifiers.ts for how a fact is read back at request time.
 *
 * This module is what used to be the removed compliance engine's `CountryComplianceProfile.
 * requiredIdentifiers` (see `git show avant-refonte-documents:backend/src/compliance/profiles/data/
 * fr.ts` and `.../us.ts`) — that shape carried NO provenance field at all, so its content is
 * treated here as an unsourced starting point to re-grade honestly, never as an already-verified
 * fact merely being relocated.
 *
 * Every fact MUST carry its own PROVENANCE — nothing here is allowed to exist without saying where
 * it came from, enforced by `assertValidProvenance` below, called at TWO independent points
 * (data/all.ts when a file is loaded, seed.ts again right before writing) for the exact reason
 * country-policy/schema.ts's own header gives for doing the same thing twice.
 *
 *  - `legal`: sourced to an exact legal (or otherwise primary/official) text, with the date it was
 *    last checked against that text.
 *  - `unverified`: not sourced that way — `resolutionNote` says PLAINLY what would have to be
 *    checked to turn this into a `legal` entry. An `unverified` entry is not a lesser citizen: see
 *    data/fr.json and data/us.json in this same directory for how far a real research pass got
 *    before hitting a real access limit (legifrance.gouv.fr, economie.gouv.fr and
 *    impots.gouv.fr all refused this task's automated requests on 2026-08-30 — the same wall
 *    country-policy/data/fr.json already documents for Légifrance specifically).
 */

export type PartyType = 'COMPANY' | 'INDIVIDUAL';

export interface LegalProvenance {
  kind: 'legal';
  /** The exact text this fact is based on — quoted, not paraphrased. */
  sourceText: string;
  /** ISO date (yyyy-mm-dd) this text was last checked against its source. */
  sourceCheckedAt: string;
}

export interface UnverifiedProvenance {
  kind: 'unverified';
  /** What would have to be checked (which text, which register, which authority) to settle this
   *  fact — never left blank, same discipline as country-policy/schema.ts's own
   *  UnverifiedProvenance.resolutionNote. */
  resolutionNote: string;
}

export type IdentifierProvenance = LegalProvenance | UnverifiedProvenance;

export interface IdentifierSchemeFact {
  /** A stable, CROSS-COUNTRY key the FRONTEND switches on — never a display label. See
   *  frontend/src/pages/(app)/clients/_components/client-upsert.tsx's
   *  `data-cy={`client-identifier-${req.scheme}`}` and frontend/src/components/onboarding.tsx +
   *  frontend/src/pages/(app)/settings/_components/company.settings.tsx's own
   *  `req.scheme === "LEGAL_ID"` / `"VAT"` special-casing for their dedicated data-cy targets.
   *  "LEGAL_ID" and "VAT" are the only two schemes any shipped file uses today — renaming one is a
   *  breaking change to those data-cy targets, not a free rename. */
  scheme: string;
  /** Which party type(s) this scheme applies to for this country. */
  appliesTo: PartyType | 'BOTH';
  /** What the frontend prints beside the field — country-specific for the SAME scheme key, e.g.
   *  "SIRET" for FR's LEGAL_ID, "EIN" for US's LEGAL_ID. */
  label: string;
  /** Whether this country makes the identifier mandatory for this party type — a legal CLAIM
   *  exactly like `pattern` below, covered by this fact's own `provenance`, never a UI default. */
  required: boolean;
  /** Optional validation regex. Declared here for a future consumer; no frontend code enforces it
   *  today (checked 2026-08-30 — see the country-identifiers.spec.ts assertion on this). */
  pattern?: string;
  helpText?: string;
  provenance: IdentifierProvenance;
  /** Free-form caveats — same convention as country-policy/schema.ts's own per-rule `notes`. */
  notes?: string;
}

export interface CountryIdentifierRequirementsFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  schemes: IdentifierSchemeFact[];
  /** Free-form, file-level caveats. */
  notes?: string;
}

export class InvalidIdentifierProvenanceError extends Error {}

/**
 * The one gate a fact cannot get past without a real provenance — see this file's header for why
 * it is called from two independent places rather than trusted to only ever run once.
 */
export function assertValidProvenance(fact: IdentifierSchemeFact, context: string): void {
  const provenance = fact.provenance as { kind?: unknown } | null | undefined;
  if (!provenance || (provenance.kind !== 'legal' && provenance.kind !== 'unverified')) {
    throw new InvalidIdentifierProvenanceError(
      `${context}: identifier scheme "${fact.scheme}" has no valid provenance (kind must be ` +
        '"legal" or "unverified") — an identifier requirement may never exist without saying where ' +
        'it came from.',
    );
  }

  if (provenance.kind === 'legal') {
    const legal = fact.provenance as LegalProvenance;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidIdentifierProvenanceError(
        `${context}: identifier scheme "${fact.scheme}" claims "legal" provenance but is missing ` +
          'sourceText and/or sourceCheckedAt.',
      );
    }
    return;
  }

  const unverified = fact.provenance as UnverifiedProvenance;
  if (!unverified.resolutionNote?.trim()) {
    throw new InvalidIdentifierProvenanceError(
      `${context}: identifier scheme "${fact.scheme}" is "unverified" but has no resolutionNote — ` +
        'an unverified fact must say what would settle it.',
    );
  }
}
