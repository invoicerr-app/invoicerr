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
  /**
   * Narrows an ALLOWED rule to specific document STATUSES (the type's own `DocumentTypeDescriptor`
   * lifecycle statuses — descriptors/lifecycle.ts) — e.g. a country permitting "invoice.save-draft"
   * only while the record is still "draft". Absent (or empty) means every status the TYPE's own
   * lifecycle allows the action to run at in the first place — no narrowing beyond what the
   * descriptor already declares, the same "absent = no extra restriction" convention `notes` below
   * already follows for a different fact.
   *
   * Meaningless, and IGNORED, when `allowed: false` — a forbidden action is already forbidden at
   * every status; there is nothing left to narrow. Declared flat, beside `allowed`, rather than
   * nested inside an "allowed-branch-only" shape, to keep this fact as plain as `notes` is.
   *
   * This is still a LEGAL/product claim about what the country's own rule covers, same as `allowed`
   * itself — it needs the same `provenance` this whole rule already carries, never a second one of
   * its own: a rule saying "allowed, but only from these statuses" is one fact, not two.
   */
  statuses?: string[];
  /** Free-form caveats — same convention as the (removed) VAT rate catalog's own VatRateFact.notes. */
  notes?: string;
}

export interface CountryDocumentPolicyFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  /**
   * Which document TYPES this country's Documents sidebar group shows at all — a NEW, separate
   * layer from `rules` below: `rules` says which ACTIONS a type already assumed to exist may run;
   * this says which types exist for this country in the first place. Not a legal claim (which is why
   * it carries no provenance, unlike a rule) — it is a product decision about what to show, the same
   * category of fact `DocumentTypeDescriptor.label` already is.
   *
   * Optional on this TYPE — some test fixtures (seed.spec.ts) build a bare `{ countryCode, rules }`
   * to exercise `rules`-only machinery and should not have to grow one just to keep compiling — but
   * data/all.ts's LOADER requires it non-empty for every SHIPPED file: a country file that declares
   * zero types would mean "this country has a policy file but nothing to show", which is never the
   * intended state (see country-policy.ts's own "no permissive fallback, no silent gap" discipline)
   * — a country with genuinely nothing to declare should have NO file at all, exactly like it has
   * none for `rules`.
   */
  documentTypes?: string[];
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
