/**
 * The country DOMESTIC REVERSE-CHARGE CATEGORY catalog. `tax/resolve-invoice-tax.ts` never calls the
 * tax engine for a domestic invoice (seller country === buyer country) unless the seller carries a
 * non-STANDARD `taxScheme` — a domestic invoice where the BUYER, not the seller, owes the VAT (Italy's
 * "inversione contabile" on construction subcontracting, Portugal's "IVA - autoliquidação" on waste and
 * scrap, Germany's "Steuerschuldnerschaft des Leistungsempfängers" on building works, France's own
 * CGI art. 283 cases) is invisible to this product today: it goes out carrying whatever rate the user
 * typed, with no legal mention at all. This catalog is STEP 2 of fixing that — the sourced list of
 * WHICH transaction categories trigger it, per country. It is deliberately inert: nothing in
 * `tax-engine.ts`, `resolve-invoice-tax.ts` or the frontend reads it yet — see this directory's own
 * `data/all.ts` header and `DESIGN.md` (this same directory) for what a FUTURE wave still has to wire:
 * the `country-fields/` overlay a line would use to pick a category, the new `DocumentLine` field and
 * `domesticVat` branch `tax-engine.ts` would need, and the new `LOCALIZED_MENTION` situation key each
 * country's own mention would resolve through.
 *
 * Same "a country is data" provenance discipline as `country-policy/schema.ts`'s own
 * `DocumentActionRuleFact` and `transports/channel-policy/schema.ts`'s own `ChannelPolicyFact` — this
 * format REUSES that discipline's `PolicyProvenance` union rather than re-declaring an identical pair
 * of interfaces a third time (unlike `tax/tax-systems/schema.ts`, which duplicates its own copy because
 * it lives one level further from `country-policy/` inside `tax/`'s own narrower namespace — this
 * catalog sits directly under `documents/`, the same level `country-policy/` itself does, so the
 * `channel-policy/schema.ts` precedent — importing `PolicyProvenance` from `../country-policy/schema`
 * — is the closer fit):
 *
 *  - `legal`: sourced to the exact statutory text, quoted verbatim, with the date it was checked.
 *  - `unverified`: not sourced to law — `resolutionNote` says what would have to be checked. Written
 *    for a reader who is not a lawyer: this note is customer-visible prose in sibling catalogs
 *    (`country-policy/`'s own header says so explicitly) and this one makes no exception, even though
 *    nothing renders it yet — a note that only makes sense to whoever wrote it is a note that will
 *    still be wrong when something finally does render it.
 *
 * WHY PER-CATEGORY, not one provenance for the whole country file (contrast `tax-systems/schema.ts`'s
 * single `provenance` per country): a country's domestic reverse-charge scope is never one fact, it is
 * a LIST of unrelated statutory carve-outs (construction subcontracting, gold, scrap, telecom...), each
 * resting on its own comma/lettera/Nummer/alínea — exactly the shape `country-policy/schema.ts`'s own
 * `rules: DocumentActionRuleFact[]` and `channel-policy/schema.ts`'s own `facts: ChannelPolicyFact[]`
 * already use for the same reason. Collapsing them into one file-level provenance would either force
 * every category to share the SAME `sourceCheckedAt` (false precision the day only one of them is
 * re-verified) or silently launder an `unverified` category under a `legal` file, exactly the "looks
 * fine but isn't" state this whole discipline exists to make impossible.
 *
 * `key` IS NOT a claim that two countries' categories under the same key are legally identical in
 * scope. It is a stable, cross-country-*readable* slug chosen for convenience (so a future picker or
 * report can group "construction subcontracting" across FR/IT/DE/PT under one label) — but Italy's own
 * "building services" carve-out (comma 6 lett. a-ter: cleaning, demolition, plant installation AND
 * completion works on buildings) is textually WIDER than Germany's "Reinigen von Gebäuden" (cleaning
 * only, § 13b Abs. 2 Nr. 8): they get DIFFERENT keys (`it-building-services` /
 * `de-building-cleaning`) precisely because conflating them under one shared key would be an
 * unverified equivalence claim this catalog's own discipline forbids making silently. A key is shared
 * ONLY where the underlying statutory scope is, on the retrieved text, actually the same kind of
 * transaction (e.g. `construction-subcontracting`, `precious-metals`) — see each country's own
 * `data/<cc>.json` for which choice was made and why.
 */
import { PolicyProvenance } from '../country-policy/schema';

export interface DomesticReverseChargeCategoryFact {
  /** Stable slug, unique within one country's file — see this file's own header for what it does and
   *  does NOT claim across countries. Machine-addressable (a future `country-fields/` overlay would
   *  use this as a select option's `value`), never itself a legal citation. */
  key: string;
  /** Short human label — for a future picker, not itself a legal claim. Plain data, same convention as
   *  `country-fields/schema.ts`'s own `DocumentFieldDescriptor.label` (rendered verbatim, never
   *  through `t()` — see that file's own header on why a per-country legal category name is not
   *  translated). */
  label: string;
  /** The precise statutory citation this category rests on (e.g. "DPR 633/1972 art. 17 comma 6 lett.
   *  a)", "UStG § 13b Abs. 2 Nr. 4", "CIVA art. 2.º n.º 1 alínea j)", "CGI art. 283, 2 nonies") —
   *  carried separately from `provenance.sourceText` so a reader (or a future UI) can show WHICH
   *  article without reprinting the whole quoted paragraph. */
  legalRef: string;
  provenance: PolicyProvenance;
  /** Free-form caveats — same convention as `country-policy/schema.ts`'s own per-rule `notes`. Used
   *  here for the two things a bare `legalRef`/`sourceText` pair cannot say on its own: a condition
   *  this catalog deliberately does NOT model (a buyer-status test, a EUR threshold, the Italian
   *  "contraente generale" carve-out), and a category's own sunset/effective date when the statute
   *  itself carries one (Italy's own comma 6 lett. b/c/d-bis/d-ter/d-quater sunset on 2026-12-31;
   *  Portugal's own alínea j) takes effect 2026-07-01, optionally 2026-01-01) — this schema has no
   *  temporal-validity field of its own (contrast `mentions/schema.ts`'s `Temporal<T>`); see this
   *  catalog's own `data/it.json`/`data/pt.json` for why that gap is named rather than silently
   *  worked around, and `DESIGN.md` (this same directory) for what a real fix would need. */
  notes?: string;
}

export interface CountryDomesticReverseChargeFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  categories: DomesticReverseChargeCategoryFact[];
  /** Free-form, file-level caveats — e.g. a mechanism this country's law has that is deliberately not
   *  modeled as a category at all (Italy's own art. 74 commi 7-8 scrap-metal regime, a DIFFERENT
   *  article from the one this file's categories are drawn from). */
  notes?: string;
}

export class InvalidDomesticReverseChargeProvenanceError extends Error {}

/**
 * The one gate a category cannot get past without a real provenance — same role
 * `country-policy/schema.ts#assertValidProvenance` and
 * `channel-policy/schema.ts#assertValidChannelPolicyFact` play for their own facts. Called from
 * `data/all.ts` at load time: nothing here is ever mirrored into a database the way `country-policy/`'s
 * own facts are (see that module's header for why IT needs a second, seed-time gate and this catalog,
 * like `mentions/`'s own, does not — there is no second write path that could skip the file loader).
 */
export function assertValidDomesticReverseChargeCategory(
  fact: DomesticReverseChargeCategoryFact,
  context: string,
): void {
  if (!fact.key?.trim()) {
    throw new InvalidDomesticReverseChargeProvenanceError(
      `${context}: a domestic reverse-charge category has no "key".`,
    );
  }
  if (!fact.label?.trim()) {
    throw new InvalidDomesticReverseChargeProvenanceError(
      `${context}: category "${fact.key}" has no "label".`,
    );
  }
  if (!fact.legalRef?.trim()) {
    throw new InvalidDomesticReverseChargeProvenanceError(
      `${context}: category "${fact.key}" has no "legalRef" — a domestic reverse-charge category may ` +
        'never be declared without saying which statutory provision imposes it.',
    );
  }

  const provenance = fact.provenance as { kind?: unknown } | null | undefined;
  if (!provenance || (provenance.kind !== 'legal' && provenance.kind !== 'unverified')) {
    throw new InvalidDomesticReverseChargeProvenanceError(
      `${context}: category "${fact.key}" has no valid provenance (kind must be "legal" or ` +
        '"unverified") — a domestic reverse-charge category may never exist without saying where it ' +
        'came from.',
    );
  }

  if (provenance.kind === 'legal') {
    const legal = fact.provenance as Extract<PolicyProvenance, { kind: 'legal' }>;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidDomesticReverseChargeProvenanceError(
        `${context}: category "${fact.key}" claims "legal" provenance but is missing sourceText ` +
          'and/or sourceCheckedAt.',
      );
    }
    return;
  }

  const unverified = fact.provenance as Extract<PolicyProvenance, { kind: 'unverified' }>;
  if (!unverified.resolutionNote?.trim()) {
    throw new InvalidDomesticReverseChargeProvenanceError(
      `${context}: category "${fact.key}" is "unverified" but has no resolutionNote — an unverified ` +
        'category must say what would settle it.',
    );
  }
}
