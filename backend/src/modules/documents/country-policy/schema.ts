/**
 * The country DOCUMENT-ACTION POLICY — the file format for "which country may run which document
 * action" (documents/, this branch's own concern — not the removed compliance engine, which used to
 * own tax/format/transmission rules under a similarly-shaped "a country is data" principle). See
 * data/fr.json and data/us.json for worked examples, and country-policy.ts for how a rule is read
 * back at request time.
 *
 * Every rule MUST carry its own PROVENANCE — nothing here is allowed to exist without saying where
 * it came from, enforced by `assertValidProvenance` below. That function is called at TWO
 * independent points (data/all.ts when a file is loaded, seed.ts again right before writing) so
 * that neither "a hand-built catalog that skipped the file loader" nor "a JSON file that skipped
 * this exact shape" can ever slip a bare, unsourced rule into the database.
 *
 *  - `legal`: sourced to an exact legal text, with the date it was last checked against that text.
 *  - `unverified`: not sourced to law — `resolutionNote` says PLAINLY what would have to be checked
 *    to turn this into a `legal` entry. An `unverified` entry is not a lesser citizen: a country file
 *    made mostly of honest `unverified` entries is the expected, acceptable state for a jurisdiction
 *    nobody has finished the legal research for — see this module's own fr.json/us.json for how far
 *    one real research pass got before hitting a real access limit (Légifrance blocks automated
 *    requests; this module says so rather than pretending a citation came from there when it didn't).
 */

export interface LegalProvenance {
  kind: 'legal';
  /** The exact text this rule is based on — quoted, not paraphrased. */
  sourceText: string;
  /** ISO date (yyyy-mm-dd) this text was last checked against its source. */
  sourceCheckedAt: string;
}

export interface UnverifiedProvenance {
  kind: 'unverified';
  /** What would have to be checked (which text, which register, which authority) to settle this
   *  rule — never left blank: an "unverified" entry with no resolution note is exactly the kind of
   *  "looks fine but isn't" state this format exists to make impossible. */
  resolutionNote: string;
}

export type PolicyProvenance = LegalProvenance | UnverifiedProvenance;

export interface DocumentActionRuleFact {
  /** A DocumentTypeDescriptor.id (documents/descriptors/types.ts) — e.g. "invoice". Deliberately NOT
   *  validated against the live DocumentTypeRegistry here: the policy file and the descriptor
   *  registry are two independently-maintained sources, the same shape of risk the (removed) VAT
   *  rate catalog and tax-engine.ts used to carry between them. */
  typeId: string;
  /** A DocumentActionDescriptor.id declared on that type — e.g. "send". */
  actionId: string;
  /** Whether this country permits the action. `false` is a genuine, sourced PROHIBITION — not the
   *  same thing as the action simply being absent from this file's `rules` (which also refuses it,
   *  but as "not yet declared" rather than "forbidden"; see country-policy.ts's
   *  evaluateCountryPolicy for the distinction the two refusal messages make). */
  allowed: boolean;
  provenance: PolicyProvenance;
  /** Free-form caveats — same convention as the (removed) VAT rate catalog's own VatRateFact.notes. */
  notes?: string;
}

export interface CountryDocumentPolicyFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  rules: DocumentActionRuleFact[];
  /** Free-form, file-level caveats — e.g. "this file deliberately does not cover X" — distinct from
   *  a per-rule `notes`, which explains ONE rule. */
  notes?: string;
}

export class InvalidPolicyProvenanceError extends Error {}

/**
 * The one gate a rule cannot get past without a real provenance — see this file's header for why it
 * is called from two independent places rather than trusted to only ever run once.
 */
export function assertValidProvenance(rule: DocumentActionRuleFact, context: string): void {
  const provenance = rule.provenance as { kind?: unknown } | null | undefined;
  if (!provenance || (provenance.kind !== 'legal' && provenance.kind !== 'unverified')) {
    throw new InvalidPolicyProvenanceError(
      `${context}: rule "${rule.typeId}.${rule.actionId}" has no valid provenance (kind must be ` +
        '"legal" or "unverified") — a document-action rule may never exist without saying where it ' +
        'came from.',
    );
  }

  if (provenance.kind === 'legal') {
    const legal = rule.provenance as LegalProvenance;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidPolicyProvenanceError(
        `${context}: rule "${rule.typeId}.${rule.actionId}" claims "legal" provenance but is missing ` +
          'sourceText and/or sourceCheckedAt.',
      );
    }
    return;
  }

  const unverified = rule.provenance as UnverifiedProvenance;
  if (!unverified.resolutionNote?.trim()) {
    throw new InvalidPolicyProvenanceError(
      `${context}: rule "${rule.typeId}.${rule.actionId}" is "unverified" but has no resolutionNote — ` +
        'an unverified rule must say what would settle it.',
    );
  }
}
