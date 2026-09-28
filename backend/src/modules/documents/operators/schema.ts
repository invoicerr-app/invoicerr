/**
 * The OPERATOR catalogue - issue #526. A country's channel-policy file (`transports/channel-policy/`)
 * answers "does France mandate a channel", never "which company can I actually connect to for that
 * channel" - that second question has no country-file home today, and grows without limit
 * independently of the (small, closed) set of legal channels themselves: ten French "plateformes
 * agreees" are not ten channels, they are ten OPERATORS all implementing the SAME legal channel
 * (`pdp`), told apart only by `baseUrl` and credentials (see `PdpTransportDeps`/`extractPdpCredentials`
 * in `transports/pdp-transport.ts`). This catalogue is the missing layer: which operator implements
 * which legal channel, in which country, through which `transports/transport-registry.ts` id (when
 * this codebase has actually wired one), and what it can do.
 *
 * ONE OPERATOR, MANY OFFERINGS (owner review of PR #528, 2026-09-28). An operator is a single
 * business entity - a name, an identity, its own provenance for existing as described - that can
 * implement MORE THAN ONE legal channel, in more than one country, at once: A-Cube is an Italian SdI
 * intermediary AND a Peppol access point; Billit is a French "plateforme agreee" AND a Belgian Peppol
 * access point; B2BRouter speaks generic Peppol and MAY also be a French PA candidate. The earlier
 * shape (`legalChannel`/`countries`/`transportId`/`baseUrl`/`capabilities`/`sandbox`/`provenance` all
 * flat on the operator) could not describe that without duplicating the whole operator once per
 * channel - which is exactly the "ten platforms, ten operators" problem this catalogue exists to
 * solve, reintroduced one level down. `OperatorOffering` is the fix: everything CHANNEL-SPECIFIC
 * (which legal channel, which countries THIS offering serves, which transport id, which baseUrl,
 * what it can do, whether ITS OWN claim is verified) moves onto one array entry per offering: the
 * SAME operator can be verified as an Italian SdI intermediary and unverified as a French PA
 * candidate at the same time, because each offering carries its own `provenance`, never one shared
 * across claims that were not equally checked.
 *
 * ONE FILE PER OPERATOR, not one per country - a deliberate adaptation of the house pattern (see
 * `transports/channel-policy/schema.ts`'s and `b2g-routing/schema.ts`'s own headers for the two
 * precedents this format sits between): an operator is not naturally keyed by a single country.
 * Keying by operator id instead keeps the same "adding one means adding one file, discovered, never
 * hand-maintained" discipline `data/all.ts` already holds for country catalogues, just on a different
 * axis.
 *
 * `legalChannel` is deliberately a free string, NOT validated against a closed enum here - the same
 * "two independently maintained sources" reasoning `channel-policy/schema.ts`'s own `providerId`
 * comment and `b2g-routing/schema.ts`'s own `transportId` comment already give: this catalogue and
 * whatever future code group screens by legal channel (issue #527) are allowed to diverge briefly
 * without a load-time crash. Known values today: "pdp" (France), "sdi" (Italy, SDICoop/direct), "ksef"
 * (Poland), "chorus-pro" (France, B2G), "peppol" (the generic cross-border network - unlike an
 * earlier pass of this file, NOW seeded where an operator's own Peppol capability is actually
 * sourceable, see data/acube.json and data/billit.json), "pt-at" (Portugal declaration). "sdi-pec"
 * (Italy via a PEC mailbox) is a real, distinct legal channel this codebase implements
 * (`transports/sdi-pec-transport.ts`) but deliberately has NO operator offering anywhere: the
 * "operator" there is the company's own qualified PEC mailbox provider (Aruba, Legalmail, or any
 * accredited PEC vendor - a purely administrative subscription, no accreditation or commercial
 * contract required) - a generic requirement, not a specific product this catalogue can name without
 * inventing one.
 *
 * Every offering carries its own provenance (`kind: 'legal'` quoting the exact primary-source text
 * with the date it was checked, or `kind: 'unverified'` with a `resolutionNote`), reusing
 * `country-policy/schema.ts`'s `PolicyProvenance` exactly like `channel-policy/schema.ts` and
 * `b2g-routing/schema.ts` already do - no fourth copy of the same two-shape interface. "Legal" here
 * does not mean "statute text": it means "read directly from a primary source (the operator's own
 * site/docs, or this repository's own proven integration code) and quoted", the same broadened
 * reading `b2g-routing/schema.ts`'s header already documents for facts that are not, strictly, law.
 * The OPERATOR ITSELF also carries a top-level `provenance` - a narrower claim than any one offering's
 * own ("this named entity exists, at this domain, as described"), not a summary or an average of its
 * offerings' provenance kinds.
 */
import { PolicyProvenance } from '../country-policy/schema';

/** What an operator can actually DO once connected, for ONE offering - read, not guessed, from this
 *  repository's own transport code where one exists (a `conformity/pollers/` entry for
 *  `lifecycleStatuses`, a `*-reception*` file for `receive`), or from the operator's own published
 *  API docs otherwise. */
export interface OperatorCapabilities {
  /** Can send/deposit an invoice through this offering. */
  emit: boolean;
  /** Can receive an invoice on this company's behalf through this offering. */
  receive: boolean;
  /** Whether a post-deposit conformity/status verdict is actually followed (a REAL poller exists -
   *  see `conformity/pollers/`), never merely "the platform's API happens to expose one". */
  lifecycleStatuses: boolean;
  /** Whether this offering itself discharges a DECLARATIVE reporting obligation (`reporting/`) on the
   *  seller's behalf - categorically different from `emit`/`receive` (delivery), same distinction
   *  `channels.service.ts#reportingObligations`'s own header draws. */
  eReporting: boolean;
}

/** The two hosts a `pdp`-shaped offering is told apart by - see this file's own header. Both
 *  optional: an offering that is NOT reached through a generic multi-operator transport (i.e. it has
 *  its OWN dedicated transport id, like "acube" or "billit") has no ambiguity to resolve and normally
 *  carries neither - its `transportId` alone already names it. */
export interface OperatorBaseUrl {
  sandbox?: string;
  production?: string;
}

/**
 * ONE legal-channel offering of an operator - everything that used to be flat on `OperatorFact`
 * before this operator could describe more than one channel at once (see this file's own header,
 * "ONE OPERATOR, MANY OFFERINGS"). An operator with a single channel still has exactly one of these
 * in its `offerings` array - nothing about the single-offering case is special-cased anywhere.
 */
export interface OperatorOffering {
  /** See this file's own header - deliberately not a closed enum. */
  legalChannel: string;
  /** ONE plain sentence, user-facing, what this offering IS and who it is FOR - e.g. "A French
   *  accredited platform (PA) with a free, self-serve sandbox." Owner review of #527: `notes` below
   *  is internal documentation (provenance trails, corrected mistakes, cross-references to source
   *  code) and must never reach a settings-screen row - this field is the one that does, rendered
   *  by `channels.settings.tsx`'s own `OperatorRow`. Plain data, the same convention `OperatorFact
   *  .name` already holds (never a legal claim, never sourced prose) - keep it short enough to read
   *  as a list-row caption, not a paragraph. */
  description: string;
  /** ISO 3166-1 alpha-2, uppercase. Where THIS offering is registered/relevant - NOT necessarily
   *  where its network reaches (a Peppol access point reaches far more countries than it is
   *  registered in); see the offering's own `notes` for that distinction when it matters. Two
   *  offerings of the SAME operator are free to name different countries (A-Cube: "sdi" -> IT,
   *  "peppol" -> IT as its own home base but reachable well beyond it). */
  countries: string[];
  /** A `transports/transport-registry.ts` id, when this codebase has actually wired one for THIS
   *  offering specifically - never assume every offering of an operator shares the same transport id,
   *  or even has one at all (see data/acube.json's own "sdi" vs "peppol" offerings: the wired "acube"
   *  transport only ever builds FatturaPA, so its "peppol" offering carries no `transportId` even
   *  though the "sdi" one does). Deliberately NOT validated against the live registry here, same
   *  reasoning `channel-policy/schema.ts`'s own `providerId` already gives: this catalogue and the
   *  registry are two independently maintained sources. */
  transportId?: string;
  /** Present only when THIS offering is reached through a GENERIC, multi-operator transport (today:
   *  only "pdp" - see `transports/pdp-transport.ts`'s own header on the SuperPDP/AFNOR API split) and
   *  is what lets a company's OWN connected `baseUrl` be resolved back to this specific offering (see
   *  `registry.ts#resolveForTransportConfig`). An offering with its OWN dedicated transport id (acube,
   *  billit, iopole, invopop, chorus-pro, ksef, sdi) needs no such disambiguation - `transportId`
   *  alone already identifies it uniquely - and normally omits this field entirely. */
  baseUrl?: OperatorBaseUrl;
  capabilities: OperatorCapabilities;
  sandbox: {
    available: boolean;
    notes?: string;
  };
  /** THIS offering's own claim, sourced independently of the operator's other offerings and of the
   *  operator's own top-level `provenance` - see this file's own header: the same operator can be
   *  `legal` here and `unverified` on a different offering. */
  provenance: PolicyProvenance;
  /** Free-form caveats for THIS offering - same convention as every sibling catalogue's own `notes`. */
  notes?: string;
}

export interface OperatorFact {
  /** Unique, lowercase, kebab-case - must match the file's own name (data/all.ts checks this). */
  id: string;
  /** Display name - plain data, the same convention as `DocumentTypeDescriptor.label`. */
  name: string;
  /** The ENTITY's own provenance - "this named operator exists, at this domain, as described" -
   *  narrower than any one offering's own claim and never a stand-in for it: an entry with a
   *  `legal`-provenance identity can still carry an `unverified` offering, and vice versa. */
  provenance: PolicyProvenance;
  /** Every legal channel this operator implements - never empty (an operator with no offering is not
   *  a fact this catalogue can carry; `assertValidOperatorFact` enforces this). */
  offerings: OperatorOffering[];
  /** Free-form caveats about the ENTITY itself - same convention as every sibling catalogue's own
   *  `notes`. An offering-specific caveat belongs on that offering's own `notes` instead. */
  notes?: string;
}

export class InvalidOperatorProvenanceError extends Error {}

function assertValidProvenance(
  provenance: PolicyProvenance | null | undefined,
  context: string,
  subject: string,
): void {
  const kind = (provenance as { kind?: unknown } | null | undefined)?.kind;
  if (!provenance || (kind !== 'legal' && kind !== 'unverified')) {
    throw new InvalidOperatorProvenanceError(
      `${context}: ${subject} has no valid provenance (kind must be "legal" or "unverified") - a fact ` +
        'may never exist without saying where it was read and when.',
    );
  }
  if (kind === 'legal') {
    const legal = provenance as Extract<PolicyProvenance, { kind: 'legal' }>;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidOperatorProvenanceError(
        `${context}: ${subject} claims "legal" provenance but is missing sourceText and/or ` +
          'sourceCheckedAt.',
      );
    }
  } else {
    const unverified = provenance as Extract<PolicyProvenance, { kind: 'unverified' }>;
    if (!unverified.resolutionNote?.trim()) {
      throw new InvalidOperatorProvenanceError(
        `${context}: ${subject} is "unverified" but has no resolutionNote - an unverified fact must ` +
          'say what would settle it.',
      );
    }
  }
}

function assertValidOffering(offering: OperatorOffering, context: string, operatorId: string): void {
  const subject = `operator "${operatorId}"'s offering "${offering.legalChannel || '(missing)'}"`;
  if (!offering.legalChannel?.trim()) {
    throw new InvalidOperatorProvenanceError(
      `${context}: operator "${operatorId}" has an offering missing its "legalChannel".`,
    );
  }
  if (!offering.description?.trim()) {
    throw new InvalidOperatorProvenanceError(
      `${context}: ${subject} has no "description" - the settings screen renders THIS to the user, ` +
        'never "notes" (internal documentation) - a fact may never reach that screen unlabeled.',
    );
  }
  if (!Array.isArray(offering.countries) || offering.countries.length === 0) {
    throw new InvalidOperatorProvenanceError(
      `${context}: ${subject} declares no "countries" - an offering relevant nowhere is not a fact ` +
        'this catalogue can carry.',
    );
  }
  if (offering.transportId !== undefined && !offering.transportId.trim()) {
    throw new InvalidOperatorProvenanceError(
      `${context}: ${subject} declares a blank "transportId" - omit the field entirely for an offering ` +
        'this codebase has not integrated yet.',
    );
  }
  if (offering.baseUrl !== undefined) {
    const { sandbox, production } = offering.baseUrl;
    if (!sandbox && !production) {
      throw new InvalidOperatorProvenanceError(
        `${context}: ${subject} declares an empty "baseUrl" - omit the field entirely rather than ` +
          'declaring a disambiguation that disambiguates nothing.',
      );
    }
  }
  const capabilities = offering.capabilities as OperatorCapabilities | null | undefined;
  if (!capabilities || typeof capabilities !== 'object') {
    throw new InvalidOperatorProvenanceError(`${context}: ${subject} is missing its "capabilities".`);
  }
  for (const key of ['emit', 'receive', 'lifecycleStatuses', 'eReporting'] as const) {
    if (typeof capabilities[key] !== 'boolean') {
      throw new InvalidOperatorProvenanceError(
        `${context}: ${subject} has a non-boolean (or missing) "capabilities.${key}".`,
      );
    }
  }
  if (!offering.sandbox || typeof offering.sandbox.available !== 'boolean') {
    throw new InvalidOperatorProvenanceError(`${context}: ${subject} is missing "sandbox.available".`);
  }
  assertValidProvenance(offering.provenance, context, subject);
}

/** Same shape and same two gates (provenance well-formedness, "cite or refuse") as
 *  `channel-policy/schema.ts#assertValidChannelPolicyFact` and
 *  `b2g-routing/schema.ts#assertValidB2gRoutingFact` - a THIRD, independent copy exists rather than a
 *  shared helper because each of the three pins its own error-message wording to its own fact shape,
 *  the same divergence `channel-policy/schema.ts`'s own header explains for why IT is not a shared
 *  function with `country-policy/schema.ts`. Validates the ENTITY (id, name, its own provenance) and
 *  then EVERY offering independently - one bad offering refuses the whole file, the same "load-time,
 *  never partial" discipline every sibling catalogue holds. */
export function assertValidOperatorFact(fact: OperatorFact, context: string): void {
  if (!fact.id?.trim()) {
    throw new InvalidOperatorProvenanceError(`${context}: an operator fact is missing its "id".`);
  }
  if (!fact.name?.trim()) {
    throw new InvalidOperatorProvenanceError(`${context}: operator "${fact.id}" is missing its "name".`);
  }
  assertValidProvenance(fact.provenance, context, `operator "${fact.id}"`);
  if (!Array.isArray(fact.offerings) || fact.offerings.length === 0) {
    throw new InvalidOperatorProvenanceError(
      `${context}: operator "${fact.id}" declares no "offerings" - an operator that implements no ` +
        'legal channel is not a fact this catalogue can carry.',
    );
  }
  for (const offering of fact.offerings) {
    assertValidOffering(offering, context, fact.id);
  }
}
