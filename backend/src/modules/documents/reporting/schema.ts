/**
 * The country REPORTING-OBLIGATION file format — a NEW concept, not a rename of channel-policy
 * (`transports/channel-policy/schema.ts`). That mechanism answers "does this country force a
 * DELIVERY channel" (a TRANSPORT question — how the invoice physically reaches the buyer);
 * this one answers a completely different question: "does this country require the SELLER to
 * DECLARE the invoice's data to its own tax authority, after issuance, regardless of how the
 * invoice was delivered". Hungary (NAV Online Számla) and Greece (AADE myDATA) are the two shipped
 * examples: an invoice sent by plain e-mail (or Peppol, or anything else) still has to be reported
 * to NAV/myDATA in near-real-time — the delivery channel and the declarative obligation are
 * orthogonal facts about the same invoice, which is exactly why this lives in its own directory,
 * next to (never inside) `transports/channel-policy/`.
 *
 * Modeled directly on `transports/channel-policy/schema.ts` (same file shape: a per-country JSON
 * file, an array of `facts`, a `provenance` gate) because the RISK profile is identical — a wrongly
 * claimed obligation would either falsely force a company through a reporting flow it can ignore, or
 * (worse) let a genuinely-obligated company skip a country's legal reporting duty — so a fact here
 * carries the SAME `PolicyProvenance` (`country-policy/schema.ts`) two-shape discipline: `legal`
 * (a real citation) or `unverified` (named, with a resolution note), never asserted bare.
 *
 * Unlike `channel-policy/schema.ts`'s `requirement: 'suggested' | 'mandated'`, a reporting
 * obligation has no "advisory" tier: a row in a country's file IS the country's own reporting
 * mandate for that provider — the same "every row is inherently binding" posture
 * `b2g-routing/schema.ts` already holds for B2G routing rules, for the identical reason (there is no
 * such thing as an "optional" tax-authority declaration once a country actually requires one).
 */
import { PolicyProvenance } from '../country-policy/schema';

/**
 * The document TYPE this obligation applies to — a `descriptors/types.ts` id. A UNION, not a bare
 * `string`, even though only `'invoice'` is ever populated today: NAV's own obligation legally
 * extends to correction documents too (modifying/cancelling invoices — see
 * `providers/nav-declaration-provider.ts`'s own header), which this codebase models as a SEPARATE
 * document type (`'credit-note'`) that a future pass could add here with zero schema change, exactly
 * the extensibility `channel-policy/schema.ts`'s own `scope` field affords for a different axis.
 */
export type ReportableDocumentType = 'invoice' | 'credit-note';

export interface ReportingObligationFact {
  /** A `reporting/declaration-provider.ts` `DeclarationProviderRegistry` id — e.g. "nav", "mydata".
   *  Deliberately NOT validated against the live registry here, the same "two independently
   *  maintained sources" risk `channel-policy/schema.ts`'s own `providerId` already accepts. */
  providerId: string;
  appliesTo: ReportableDocumentType;
  provenance: PolicyProvenance;
  /** Free-form caveats — same convention as every sibling country-fact file's own `notes`. */
  notes?: string;
}

export interface CountryReportingObligationFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  facts: ReportingObligationFact[];
}

export class InvalidReportingObligationProvenanceError extends Error {}

/**
 * The one gate a fact cannot get past without a real provenance — called from two independent
 * places (`data/all.ts` when a file loads; this module's own specs), the same "never trust a single
 * call site" discipline `channel-policy/schema.ts`'s own `assertValidChannelPolicyFact` documents.
 */
export function assertValidReportingObligationFact(fact: ReportingObligationFact, context: string): void {
  if (!fact.providerId?.trim()) {
    throw new InvalidReportingObligationProvenanceError(
      `${context}: a reporting-obligation fact is missing its "providerId".`,
    );
  }
  if (fact.appliesTo !== 'invoice' && fact.appliesTo !== 'credit-note') {
    throw new InvalidReportingObligationProvenanceError(
      `${context}: fact "${fact.providerId}" has no valid "appliesTo" (must be "invoice" or ` +
        '"credit-note").',
    );
  }

  const provenance = fact.provenance as { kind?: unknown } | null | undefined;
  if (!provenance || (provenance.kind !== 'legal' && provenance.kind !== 'unverified')) {
    throw new InvalidReportingObligationProvenanceError(
      `${context}: fact "${fact.providerId}" has no valid provenance (kind must be "legal" or ` +
        '"unverified") — a reporting obligation may never exist without saying where it came from.',
    );
  }

  if (provenance.kind === 'legal') {
    const legal = fact.provenance as Extract<PolicyProvenance, { kind: 'legal' }>;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidReportingObligationProvenanceError(
        `${context}: fact "${fact.providerId}" claims "legal" provenance but is missing sourceText ` +
          'and/or sourceCheckedAt.',
      );
    }
  } else {
    const unverified = fact.provenance as Extract<PolicyProvenance, { kind: 'unverified' }>;
    if (!unverified.resolutionNote?.trim()) {
      throw new InvalidReportingObligationProvenanceError(
        `${context}: fact "${fact.providerId}" is "unverified" but has no resolutionNote — an ` +
          'unverified fact must say what would settle it.',
      );
    }
  }
}
