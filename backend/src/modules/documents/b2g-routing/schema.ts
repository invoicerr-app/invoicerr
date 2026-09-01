/**
 * The B2G ROUTING file format — a country's own answer to "what happens when this company sends an
 * invoice to a GOVERNMENT client of THIS country". Sibling of `channel-policy/schema.ts` (which
 * answers "what does a country say about a channel for the SELLER's own country") and
 * `country-policy/schema.ts` (which answers "which document actions may a company of this country
 * run at all") — a THIRD, deliberately separate concern: neither of those two is keyed on the
 * CLIENT's country, and neither reads `Client.kind` at all.
 *
 * Unlike `channel-policy/schema.ts`'s `ChannelPolicyFact`, there is no `requirement: 'suggested' |
 * 'mandated'` tier here. Every row this format describes IS a mandate by construction — directive
 * 2014/55/UE's own baseline is that RECEIVING an e-invoice is already compulsory for a contracting
 * authority (see `documentation/compliance/...` and every shipped file's own EU-baseline note); there
 * is no meaningful "this channel is merely the usual one" reading for a government recipient the way
 * there is for a seller's own country. A B2G routing fact can still carry `unverified` provenance
 * (see `assertValidB2gRoutingFact` below) — unlike `channel-policy/schema.ts`'s `mandated` tier, an
 * `unverified` B2G fact is still LOADED and still ENFORCED: it means the underlying legal text was
 * not independently re-checked against ITS OWN primary source in this pass, never "this rule is
 * optional, ignore it". This mirrors `country-policy/schema.ts`'s own precedent (a `country-policy`
 * rule can be `unverified` and still block/allow an action) rather than `channel-policy/schema.ts`'s
 * stricter one (which forbids `unverified` for anything binding) — see `assertValidB2gRoutingFact`'s
 * own comment for why THIS format reuses the country-policy-style gate, not the channel-policy one.
 *
 * `PolicyProvenance`/`LegalProvenance`/`UnverifiedProvenance` are REUSED from `country-policy/schema.ts`
 * (types only, exactly like `channel-policy/schema.ts` already does) rather than redeclared — same
 * shape, same two kinds, no reason for a fourth copy of the interface.
 */
import { LegalProvenance, PolicyProvenance, UnverifiedProvenance } from '../country-policy/schema';

export { LegalProvenance, UnverifiedProvenance };

/**
 * One national identifier the CLIENT (the government body itself) must already carry — checked
 * against `PartyIdentifier.scheme` on that client. `scheme` is a free string, deliberately NOT
 * constrained to the `country-identifiers/` catalog's own two shipped values ("LEGAL_ID"/"VAT" —
 * see that module's own schema.ts header on why a third scheme there loses a couple of dedicated
 * UI conveniences, never why a third scheme cannot EXIST): a B2G-only identifier (e.g. Italy's
 * "Codice Univoco Ufficio") that no ordinary client of that country needs is exactly the case this
 * field exists for.
 */
export interface RequiredClientIdentifierFact {
  scheme: string;
  label: string;
  /** Why this identifier is required — SOURCED, quoted or plainly explained, never invented. Folded
   *  verbatim into the "send" preflight's own refusal message when missing (see
   *  `actions/invoice-actions.ts`'s own B2G block messages) so the user reads the reason, not just
   *  the field name. */
  why: string;
}

/**
 * One field the INVOICE ITSELF (`DocumentInstance.data`, top-level key) must carry before it may be
 * sent to a government client of this country — e.g. Germany's Leitweg-ID, carried generically as
 * `data.buyerReference` (see `country-fields/data/de.json`'s own header: this exact field, already
 * read by `formats/shared-build.ts#extractBuyerReference` regardless of which screen — if any — put
 * an input for it). `required: false` is INFORMATIONAL only (surfaced as a help hint, never a block)
 * — France's own "code service" entry is the shipped example: some public entities need it, some
 * don't, and this catalog has no per-entity granularity to decide which.
 */
export interface RequiredDocumentFieldFact {
  field: string;
  label: string;
  why: string;
  required: boolean;
}

export interface B2gRoutingRuleFact {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). This
   *  is the CLIENT's own country, never the seller's — see this file's own header. */
  countryCode: string;
  /** A `transports/transport-registry.ts` id. Deliberately NOT validated against the live registry
   *  here — same reasoning as `channel-policy/schema.ts`'s own `providerId`: a rule may legitimately
   *  name a channel that does not exist yet ("chorus-pro", "zre-ozgre" — see this directory's own
   *  data files), and sending then refuses, loudly, naming exactly that; never a load-time crash for
   *  an intentionally-unimplemented channel, which is this model's own thesis. */
  transportId: string;
  /** A `formats/format-registry.ts` id, e.g. "facturx", "xrechnung", "fatturapa". Unlike
   *  `transportId`, this one IS expected to resolve against the live `FormatProviderRegistry` — see
   *  `data-integrity.spec.ts`-style checks in `data/all.spec.ts`. */
  formatSyntax: string;
  requiredClientIdentifiers?: RequiredClientIdentifierFact[];
  requiredDocumentFields?: RequiredDocumentFieldFact[];
  provenance: PolicyProvenance;
  /** Free-form caveats — same convention as `channel-policy/schema.ts`'s own per-fact `notes`. */
  notes?: string;
}

export interface CountryB2gRoutingFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  rule: B2gRoutingRuleFact;
}

export class InvalidB2gRoutingProvenanceError extends Error {}

/**
 * Same two-shape gate as `country-policy/schema.ts`'s own `assertValidProvenance` (a `legal` fact
 * needs `sourceText`+`sourceCheckedAt`, an `unverified` one needs `resolutionNote`) — a SEPARATE
 * function, not a shared one parameterized by message, for the same reason `channel-policy/schema.ts`
 * gives for its own copy: this fact's error text names "a B2G routing fact" and its OWN extra shape
 * checks (`transportId`/`formatSyntax`/well-formed identifier and field lists), which neither
 * `country-policy/schema.ts` nor `channel-policy/schema.ts` has any equivalent of.
 *
 * Deliberately does NOT require `provenance.kind === 'legal'` the way `channel-policy/schema.ts`'s
 * `assertValidChannelPolicyFact` requires for `requirement: 'mandated'` — see this file's own header
 * for why: every B2G routing fact is already, unconditionally, a mandate, so there is no separate
 * "claims to be legally required" flag whose provenance needs a STRICTER gate than the base one; an
 * honestly-labeled `unverified` fact is exactly as loadable as a `legal` one, both still enforced.
 */
export function assertValidB2gRoutingFact(fact: B2gRoutingRuleFact, context: string): void {
  if (!fact.countryCode?.trim()) {
    throw new InvalidB2gRoutingProvenanceError(
      `${context}: a B2G routing fact is missing its "countryCode".`,
    );
  }
  if (!fact.transportId?.trim()) {
    throw new InvalidB2gRoutingProvenanceError(
      `${context} (${fact.countryCode}): a B2G routing fact is missing its "transportId".`,
    );
  }
  if (!fact.formatSyntax?.trim()) {
    throw new InvalidB2gRoutingProvenanceError(
      `${context} (${fact.countryCode}): a B2G routing fact is missing its "formatSyntax".`,
    );
  }

  for (const identifier of fact.requiredClientIdentifiers ?? []) {
    if (!identifier.scheme?.trim() || !identifier.label?.trim() || !identifier.why?.trim()) {
      throw new InvalidB2gRoutingProvenanceError(
        `${context} (${fact.countryCode}): a "requiredClientIdentifiers" entry needs a non-empty ` +
          '"scheme", "label" and "why" — never a silently blank one.',
      );
    }
  }
  for (const field of fact.requiredDocumentFields ?? []) {
    if (!field.field?.trim() || !field.label?.trim() || !field.why?.trim()) {
      throw new InvalidB2gRoutingProvenanceError(
        `${context} (${fact.countryCode}): a "requiredDocumentFields" entry needs a non-empty ` +
          '"field", "label" and "why" — never a silently blank one.',
      );
    }
    if (typeof field.required !== 'boolean') {
      throw new InvalidB2gRoutingProvenanceError(
        `${context} (${fact.countryCode}): "requiredDocumentFields" entry "${field.field}" needs an ` +
          'explicit boolean "required" — never left undefined.',
      );
    }
  }

  const provenance = fact.provenance as { kind?: unknown } | null | undefined;
  if (!provenance || (provenance.kind !== 'legal' && provenance.kind !== 'unverified')) {
    throw new InvalidB2gRoutingProvenanceError(
      `${context} (${fact.countryCode}): a B2G routing fact has no valid provenance (kind must be ` +
        '"legal" or "unverified") — it may never exist without saying where it came from.',
    );
  }

  if (provenance.kind === 'legal') {
    const legal = fact.provenance as LegalProvenance;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidB2gRoutingProvenanceError(
        `${context} (${fact.countryCode}): claims "legal" provenance but is missing sourceText ` +
          'and/or sourceCheckedAt.',
      );
    }
  } else {
    const unverified = fact.provenance as UnverifiedProvenance;
    if (!unverified.resolutionNote?.trim()) {
      throw new InvalidB2gRoutingProvenanceError(
        `${context} (${fact.countryCode}): is "unverified" but has no resolutionNote — an unverified ` +
          'fact must say what would settle it.',
      );
    }
  }
}
