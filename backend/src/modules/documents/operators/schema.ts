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
 * ONE FILE PER OPERATOR, not one per country - a deliberate adaptation of the house pattern (see
 * `transports/channel-policy/schema.ts`'s and `b2g-routing/schema.ts`'s own headers for the two
 * precedents this format sits between): an operator is not naturally keyed by a single country (A-Cube
 * is Italian AND a Peppol access point reachable from anywhere; Billit is Belgian AND a French PA).
 * Keying by operator id instead keeps the same "adding one means adding one file, discovered, never
 * hand-maintained" discipline `data/all.ts` already holds for country catalogues, just on a different
 * axis.
 *
 * `legalChannel` is deliberately a free string, NOT validated against a closed enum here - the same
 * "two independently maintained sources" reasoning `channel-policy/schema.ts`'s own `providerId`
 * comment and `b2g-routing/schema.ts`'s own `transportId` comment already give: this catalogue and
 * whatever future code group screens by legal channel (issue #527) are allowed to diverge briefly
 * without a load-time crash. Known values today: "pdp" (France), "sdi" (Italy, SDICoop/direct), "ksef"
 * (Poland), "chorus-pro" (France, B2G), "peppol" (the generic cross-border network, no operator seeded
 * here - see `data/all.ts`'s own header on why), "pt-at" (Portugal declaration). "sdi-pec" (Italy via a
 * PEC mailbox) is a real, distinct legal channel this codebase implements
 * (`transports/sdi-pec-transport.ts`) but deliberately has NO operator entry: the "operator" there is
 * the company's own qualified PEC mailbox provider (Aruba, Legalmail, or any accredited PEC vendor  -
 * a purely administrative subscription, no accreditation or commercial contract required) - a generic
 * requirement, not a specific product this catalogue can name without inventing one.
 *
 * Every fact carries its own provenance (`kind: 'legal'` quoting the exact primary-source text with
 * the date it was checked, or `kind: 'unverified'` with a `resolutionNote`), reusing
 * `country-policy/schema.ts`'s `PolicyProvenance` exactly like `channel-policy/schema.ts` and
 * `b2g-routing/schema.ts` already do - no fourth copy of the same two-shape interface. "Legal" here
 * does not mean "statute text": it means "read directly from a primary source (the operator's own
 * site/docs, or this repository's own proven integration code) and quoted", the same broadened
 * reading `b2g-routing/schema.ts`'s header already documents for facts that are not, strictly, law.
 */
import { PolicyProvenance } from '../country-policy/schema';

/** What an operator can actually DO once connected - read, not guessed, from this repository's own
 *  transport code where one exists (a `conformity/pollers/` entry for `lifecycleStatuses`, a
 *  `*-reception*` file for `receive`), or from the operator's own published API docs otherwise. */
export interface OperatorCapabilities {
  /** Can send/deposit an invoice through this operator. */
  emit: boolean;
  /** Can receive an invoice on this company's behalf through this operator. */
  receive: boolean;
  /** Whether a post-deposit conformity/status verdict is actually followed (a REAL poller exists  -
   *  see `conformity/pollers/`), never merely "the platform's API happens to expose one". */
  lifecycleStatuses: boolean;
  /** Whether this operator itself discharges a DECLARATIVE reporting obligation (`reporting/`) on the
   *  seller's behalf - categorically different from `emit`/`receive` (delivery), same distinction
   *  `channels.service.ts#reportingObligations`'s own header draws. */
  eReporting: boolean;
}

/** The two hosts a `pdp`-shaped account is told apart by - see this file's own header. Both optional:
 *  an operator that is NOT reachable through the generic multi-operator "pdp" transport (i.e. it has
 *  its OWN dedicated transport id, like "acube" or "billit") has no ambiguity to resolve and normally
 *  carries neither - its `transportId` alone already names it. */
export interface OperatorBaseUrl {
  sandbox?: string;
  production?: string;
}

export interface OperatorFact {
  /** Unique, lowercase, kebab-case - must match the file's own name (data/all.ts checks this). */
  id: string;
  /** Display name - plain data, the same convention as `DocumentTypeDescriptor.label`. */
  name: string;
  /** ISO 3166-1 alpha-2, uppercase. Where this operator is registered/relevant - NOT necessarily
   *  where its network reaches (a Peppol access point reaches far more countries than it is
   *  registered in); see each entry's own `notes` for that distinction when it matters. */
  countries: string[];
  /** See this file's own header - deliberately not a closed enum. */
  legalChannel: string;
  /** A `transports/transport-registry.ts` id, when this codebase has actually wired one for this
   *  operator. Absent for an operator this catalogue knows about but has not integrated yet (most of
   *  the free-sandbox candidates researched for the French accredited-platform role) - deliberately
   *  NOT validated against the live registry here, same reasoning `channel-policy/schema.ts`'s own
   *  `providerId` already gives: this catalogue and the registry are two independently maintained
   *  sources. */
  transportId?: string;
  /** Present only when this operator is reached through a GENERIC, multi-operator transport (today:
   *  only "pdp" - see `transports/pdp-transport.ts`'s own header on the SuperPDP/AFNOR API split) and
   *  is what lets a company's OWN connected `baseUrl` be resolved back to this specific operator (see
   *  `resolve-operator.ts`). An operator with its OWN dedicated transport id (acube, billit, iopole,
   *  invopop, chorus-pro, ksef, sdi) needs no such disambiguation - `transportId` alone already
   *  identifies it uniquely - and normally omits this field entirely. */
  baseUrl?: OperatorBaseUrl;
  capabilities: OperatorCapabilities;
  sandbox: {
    available: boolean;
    notes?: string;
  };
  provenance: PolicyProvenance;
  /** Free-form caveats - same convention as every sibling catalogue's own `notes`. */
  notes?: string;
}

export class InvalidOperatorProvenanceError extends Error {}

/** Same shape and same two gates (provenance well-formedness, "cite or refuse") as
 *  `channel-policy/schema.ts#assertValidChannelPolicyFact` and
 *  `b2g-routing/schema.ts#assertValidB2gRoutingFact` - a THIRD, independent copy exists rather than a
 *  shared helper because each of the three pins its own error-message wording to its own fact shape,
 *  the same divergence `channel-policy/schema.ts`'s own header explains for why IT is not a shared
 *  function with `country-policy/schema.ts`. */
export function assertValidOperatorFact(fact: OperatorFact, context: string): void {
  if (!fact.id?.trim()) {
    throw new InvalidOperatorProvenanceError(`${context}: an operator fact is missing its "id".`);
  }
  if (!fact.name?.trim()) {
    throw new InvalidOperatorProvenanceError(`${context}: operator "${fact.id}" is missing its "name".`);
  }
  if (!Array.isArray(fact.countries) || fact.countries.length === 0) {
    throw new InvalidOperatorProvenanceError(
      `${context}: operator "${fact.id}" declares no "countries" - an operator relevant nowhere is not ` +
        'a fact this catalogue can carry.',
    );
  }
  if (!fact.legalChannel?.trim()) {
    throw new InvalidOperatorProvenanceError(
      `${context}: operator "${fact.id}" is missing its "legalChannel".`,
    );
  }
  if (fact.transportId !== undefined && !fact.transportId.trim()) {
    throw new InvalidOperatorProvenanceError(
      `${context}: operator "${fact.id}" declares a blank "transportId" - omit the field entirely for ` +
        'an operator this codebase has not integrated yet.',
    );
  }
  if (fact.baseUrl !== undefined) {
    const { sandbox, production } = fact.baseUrl;
    if (!sandbox && !production) {
      throw new InvalidOperatorProvenanceError(
        `${context}: operator "${fact.id}" declares an empty "baseUrl" - omit the field entirely rather ` +
          'than declaring a disambiguation that disambiguates nothing.',
      );
    }
  }
  const capabilities = fact.capabilities as OperatorCapabilities | null | undefined;
  if (!capabilities || typeof capabilities !== 'object') {
    throw new InvalidOperatorProvenanceError(
      `${context}: operator "${fact.id}" is missing its "capabilities".`,
    );
  }
  for (const key of ['emit', 'receive', 'lifecycleStatuses', 'eReporting'] as const) {
    if (typeof capabilities[key] !== 'boolean') {
      throw new InvalidOperatorProvenanceError(
        `${context}: operator "${fact.id}" has a non-boolean (or missing) "capabilities.${key}".`,
      );
    }
  }
  if (!fact.sandbox || typeof fact.sandbox.available !== 'boolean') {
    throw new InvalidOperatorProvenanceError(
      `${context}: operator "${fact.id}" is missing "sandbox.available".`,
    );
  }

  // The rule every sibling catalogue enforces, restated for this one: a fact may never exist without
  // saying where it came from - see this file's own header on what "legal" means here.
  const provenance = fact.provenance as { kind?: unknown } | null | undefined;
  if (!provenance || (provenance.kind !== 'legal' && provenance.kind !== 'unverified')) {
    throw new InvalidOperatorProvenanceError(
      `${context}: operator "${fact.id}" has no valid provenance (kind must be "legal" or "unverified") ` +
        ' -  an operator fact may never exist without saying where it was read and when.',
    );
  }
  if (provenance.kind === 'legal') {
    const legal = fact.provenance as Extract<PolicyProvenance, { kind: 'legal' }>;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidOperatorProvenanceError(
        `${context}: operator "${fact.id}" claims "legal" provenance but is missing sourceText and/or ` +
          'sourceCheckedAt.',
      );
    }
  } else {
    const unverified = fact.provenance as Extract<PolicyProvenance, { kind: 'unverified' }>;
    if (!unverified.resolutionNote?.trim()) {
      throw new InvalidOperatorProvenanceError(
        `${context}: operator "${fact.id}" is "unverified" but has no resolutionNote - an unverified ` +
          'fact must say what would settle it.',
      );
    }
  }
}
