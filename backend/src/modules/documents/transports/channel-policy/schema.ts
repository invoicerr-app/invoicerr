/**
 * The country CHANNEL-POLICY file format. A policy file carries two kinds of fact. The first is a
 * settings-screen prompt that tells a company "this transport is the usual one for your country"
 * (FR → PDP) — a non-binding, advisory HINT, never a block. The second ("channel mandated by
 * country") says a channel is not merely usual but LEGALLY REQUIRED,
 * with its own sourced provenance, and that fact DOES have a binding effect once the invoice it
 * applies to is issued on or after its start date.
 *
 * Renamed from "channel-suggestion" to "channel-policy": calling this directory
 * "suggestion" stopped being an honest name the moment one of its own facts could mean "mandatory" —
 * the same reasoning that keeps `country-policy/`'s own file format named for the wider concept
 * ("policy") rather than for whichever single case it originally shipped with. The concept this format
 * describes is now "what does this country say about this channel", of which "it's the usual one"
 * (`requirement: 'suggested'`) is one possible answer and "it's the law" (`requirement: 'mandated'`)
 * is another.
 *
 * `requirement: 'suggested'` is EXACTLY the old, sole behavior this file used to allow: a hint the
 * frontend may or may not act on (`channels.settings.tsx` renders it as a "Connect" prompt, nothing
 * more) — see `country-policy/schema.ts`'s own header for why this reuses `PolicyProvenance` rather
 * than inventing a second legal/unverified vocabulary.
 *
 * `requirement: 'mandated'` is new. It DOES have a binding effect: `channel-policy/mandate.ts`'s own
 * `activeChannelMandateFor`, read by `invoice-actions.ts`'s "send" preflight, REFUSES sending an
 * invoice through any OTHER transport once that invoice's own `issueDate` is on or after
 * `mandatedFrom` — never the server's own "today", see `mandate.ts`'s header for why. A `mandated`
 * fact is a genuine legal claim ("this channel is not optional for this country") and therefore may
 * NEVER carry `unverified` provenance the way a `suggested` fact still can (a suggestion is a product
 * opinion; a mandate is a claim about the law). `assertValidChannelPolicyFact` enforces this below: a
 * `requirement: 'mandated'` entry with anything other than a well-formed `'legal'` provenance
 * (`sourceText` + `sourceCheckedAt`, exactly like `country-policy/schema.ts`'s own `LegalProvenance`)
 * THROWS at load — called from the same two kinds of place `country-policy/schema.ts`'s own
 * `assertValidProvenance` is (`data/all.ts` when a file loads; nothing here is ever mirrored into a
 * database the way `country-policy/`'s own facts are — see `registry.ts`'s header for why a second,
 * seed-time gate would have nothing new to guard against here) — a hand-built catalog that skipped the
 * file loader (a test, a future caller) must be refused too, never trusted just because it constructed
 * fine as an object literal.
 */
import { PolicyProvenance } from '../../country-policy/schema';

export type ChannelRequirement = 'suggested' | 'mandated';

/** The only value `ChannelPolicyScope.parties` may take today - see that field's own header. Kept as
 *  a named union rather than a bare string so that adding a second narrowing (a role, a threshold)
 *  is a deliberate, compile-checked change here, never a value someone invents in a JSON file. */
export type ChannelPolicyParties = 'domestic';

/** See `ChannelPolicyFact.scope`. A CLOSED shape: `assertValidChannelPolicyFact` refuses any other
 *  key, because an ignored key here would silently mean "this narrowing does not apply". */
export interface ChannelPolicyScope {
  parties?: ChannelPolicyParties;
}

export interface ChannelPolicyFact {
  /** A `documents/transports/transport-registry.ts` id — e.g. "pdp". Deliberately NOT validated
   *  against the live `TransportRegistry` here: this file and that registry are two independently
   *  maintained sources, the same shape of risk `country-policy/schema.ts`'s own `typeId`/`actionId`
   *  already accepts for the exact same reason (see that file's own comment on `typeId`). */
  providerId: string;
  requirement: ChannelRequirement;
  /**
   * ISO date (yyyy-mm-dd) this requirement becomes binding. REQUIRED when `requirement: 'mandated'`
   * (meaningless otherwise — nothing is "mandated from" some date if it was never mandated at all) —
   * enforced below, never silently defaulted.
   *
   * Compared against the DOCUMENT's own `issueDate` field, never the server's current date — see
   * `mandate.ts`'s own header for the full reasoning. A date in the FUTURE is the ordinary, INTENDED
   * state for a mandate whose start date is already known ahead of time (e.g. FR/PDP below, known
   * today to start 2026-09-01): it means "suggested today, mandated once an invoice's own issue date
   * reaches it", never an error and never a no-op waiting to be "activated" later by a code change.
   */
  mandatedFrom?: string;
  /**
   * Other `transport-registry.ts` ids that satisfy this SAME mandate — a country's law mandates a
   * legal channel (e.g. "use the Sistema di Interscambio"), not necessarily one specific piece of
   * code in this repository, and a single legal channel can have more than one lawful sub-channel
   * this codebase implements as SEPARATE transports: Italy's SdI accepts both the accredited
   * SDICoop web service (`transportId: "sdi"`) and, requiring no accreditation at all, a PEC mailbox
   * (`transportId: "sdi-pec"`) — see `transports/sdi-pec-transport.ts`'s own header for the primary
   * source. Absent (or empty) means the mandate has exactly one satisfying transport, `providerId`
   * itself — the ordinary case for every mandate shipped before this field existed (FR/pdp has no
   * PEC-shaped equivalent). `mandate.ts#activeChannelMandateFor` passes this through unchanged;
   * `invoice-actions.ts`'s own preflight is what actually treats a listed id as equally compliant.
   */
  equivalentProviderIds?: string[];
  /**
   * WHICH invoices this fact binds, when it does not bind every one of them. Was reserved as a
   * free-form `Record<string, unknown>` and read by nothing; it is now READ, by
   * `mandate.ts#activeChannelMandateForOperation`, and therefore CLOSED (see
   * `assertValidChannelPolicyFact` below). The reason the field stopped being free-form the moment
   * it acquired an effect: it now DISARMS a legal block, so a typo in a key or a value would
   * silently turn a mandate off - the worst possible failure direction for this file, and exactly
   * the "looks fine but isn't" state this whole format exists to make impossible. An unknown key or
   * an unknown value THROWS at load rather than being ignored.
   *
   * `parties: 'domestic'` - the mandate binds only an operation whose BUYER is established in this
   * same country. This is not a product opinion: both national channel mandates shipped today say so
   * in their own statutory text, quoted verbatim in their own `provenance.sourceText`. France's CGI
   * art. 289 bis binds the emission through a plateforme agréée only between taxable persons
   * established in France; Italy's D.Lgs. 127/2015 art. 1 comma 3 binds SdI invoicing only for
   * supplies "tra soggetti residenti o stabiliti nel territorio dello Stato". Once one party is
   * established elsewhere, the INVOICING mandate falls away and what each side owes its own
   * administration is a DECLARATION (France: e-reporting, CGI art. 290; Italy: the comma 3-bis
   * transmission of data on operations with non-established subjects) - a different obligation,
   * discharged by different means, which this catalog does not model at all and must not pretend to
   * (see `reporting/`'s own data files and their `notes` for how far that side actually goes).
   *
   * Absent means the fact binds every invoice the issuing company sends, unconditionally - the
   * behaviour every fact had before this field was read, kept as the default so that adding a
   * mandate stays "declare it and it binds", never "declare it and remember to arm it".
   */
  scope?: ChannelPolicyScope;
  provenance: PolicyProvenance;
  /** Free-form caveats — same convention as `country-policy/schema.ts`'s own `DocumentActionRuleFact.notes`. */
  notes?: string;
}

export interface CountryChannelPolicyFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  facts: ChannelPolicyFact[];
  /** Free-form, file-level caveats — same convention as `country-policy/schema.ts`'s own. */
  notes?: string;
}

export class InvalidChannelPolicyProvenanceError extends Error {}

/** Same shape as `country-policy/schema.ts`'s `assertValidProvenance` — a separate function (not a
 *  shared one parameterized by a message) because that one's error text is pinned to "typeId.actionId"
 *  wording by its own spec; this fact has neither field, and now carries a THIRD failure mode
 *  (`requirement`/`mandatedFrom`) that file has no equivalent of at all. */
export function assertValidChannelPolicyFact(fact: ChannelPolicyFact, context: string): void {
  if (!fact.providerId?.trim()) {
    throw new InvalidChannelPolicyProvenanceError(
      `${context}: a channel policy fact is missing its "providerId".`,
    );
  }
  if (fact.requirement !== 'suggested' && fact.requirement !== 'mandated') {
    throw new InvalidChannelPolicyProvenanceError(
      `${context}: fact "${fact.providerId}" has no valid "requirement" (must be "suggested" or ` +
        '"mandated").',
    );
  }

  if (fact.equivalentProviderIds !== undefined) {
    if (fact.equivalentProviderIds.length === 0 || fact.equivalentProviderIds.some((id) => !id?.trim())) {
      throw new InvalidChannelPolicyProvenanceError(
        `${context}: fact "${fact.providerId}" declares "equivalentProviderIds" but it is empty or ` +
          'contains a blank entry — omit the field entirely rather than listing nothing.',
      );
    }
    if (fact.equivalentProviderIds.includes(fact.providerId)) {
      throw new InvalidChannelPolicyProvenanceError(
        `${context}: fact "${fact.providerId}" lists itself in "equivalentProviderIds" — a provider ` +
          'never needs to be declared equivalent to itself.',
      );
    }
  }

  // `scope` is now READ (`mandate.ts#activeChannelMandateForOperation`) and DISARMS a mandate, so an
  // unrecognized key or value can never be tolerated here: ignoring it would silently widen a
  // mandate that a data file meant to narrow, or - worse in the other direction - leave a narrowing
  // the author believed they had declared with no effect at all. See `ChannelPolicyFact.scope`.
  if (fact.scope !== undefined) {
    const scope = fact.scope as Record<string, unknown> | null;
    if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
      throw new InvalidChannelPolicyProvenanceError(
        `${context}: fact "${fact.providerId}" declares a "scope" that is not an object.`,
      );
    }
    const unknownKey = Object.keys(scope).find((key) => key !== 'parties');
    if (unknownKey) {
      throw new InvalidChannelPolicyProvenanceError(
        `${context}: fact "${fact.providerId}" declares an unknown "scope" key "${unknownKey}" - ` +
          'the only key this format understands today is "parties". An unrecognized key would be ' +
          'read by nothing and silently change nothing, so it is refused rather than ignored.',
      );
    }
    if (scope.parties !== undefined && scope.parties !== 'domestic') {
      throw new InvalidChannelPolicyProvenanceError(
        `${context}: fact "${fact.providerId}" declares "scope.parties" as ` +
          `"${String(scope.parties)}" - the only value this format understands today is "domestic".`,
      );
    }
    if (Object.keys(scope).length === 0) {
      throw new InvalidChannelPolicyProvenanceError(
        `${context}: fact "${fact.providerId}" declares an empty "scope" - omit the field entirely ` +
          'rather than declaring a narrowing that narrows nothing.',
      );
    }
  }

  const provenance = fact.provenance as { kind?: unknown } | null | undefined;
  if (!provenance || (provenance.kind !== 'legal' && provenance.kind !== 'unverified')) {
    throw new InvalidChannelPolicyProvenanceError(
      `${context}: fact "${fact.providerId}" has no valid provenance (kind must be "legal" or ` +
        '"unverified") — a channel policy fact may never exist without saying where it came from.',
    );
  }

  if (provenance.kind === 'legal') {
    const legal = fact.provenance as Extract<PolicyProvenance, { kind: 'legal' }>;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidChannelPolicyProvenanceError(
        `${context}: fact "${fact.providerId}" claims "legal" provenance but is missing sourceText ` +
          'and/or sourceCheckedAt.',
      );
    }
  } else {
    const unverified = fact.provenance as Extract<PolicyProvenance, { kind: 'unverified' }>;
    if (!unverified.resolutionNote?.trim()) {
      throw new InvalidChannelPolicyProvenanceError(
        `${context}: fact "${fact.providerId}" is "unverified" but has no resolutionNote — an ` +
          'unverified fact must say what would settle it.',
      );
    }
  }

  // The one rule this format adds beyond country-policy/schema.ts's own, and the reason this
  // function could not simply stay `assertValidChannelSuggestion` unchanged — see this file's own
  // header. Claiming a channel is LEGALLY MANDATORY without a genuine legal citation is exactly the
  // "looks fine but isn't" state this whole discipline exists to make impossible.
  if (fact.requirement === 'mandated') {
    if (fact.provenance.kind !== 'legal') {
      throw new InvalidChannelPolicyProvenanceError(
        `${context}: fact "${fact.providerId}" is "mandated" but its provenance is "${fact.provenance.kind}" ` +
          '— a mandate is a legal claim and must carry a real citation ("legal": sourceText + ' +
          'sourceCheckedAt), never "unverified": if the law is not actually confirmed, declare this ' +
          'fact "suggested" instead of "mandated" on faith.',
      );
    }
    if (!fact.mandatedFrom?.trim()) {
      throw new InvalidChannelPolicyProvenanceError(
        `${context}: fact "${fact.providerId}" is "mandated" but has no "mandatedFrom" date — a ` +
          "mandate with no start date can never be evaluated against an invoice's own issue date.",
      );
    }
  }
}
