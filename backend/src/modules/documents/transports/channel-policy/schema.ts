/**
 * The country CHANNEL-POLICY file format — root TODO items 10 and 11. Item 10 shipped the first half:
 * a settings-screen prompt that tells a company "this transport is the usual one for your country"
 * (product memory: FR → PDP) — a non-binding, advisory HINT, never a block. Item 11 ("canal imposé par
 * pays") adds the second half: a fact can now say a channel is not merely usual but LEGALLY REQUIRED,
 * with its own sourced provenance, and that fact DOES have a binding effect once the invoice it
 * applies to is issued on or after its start date.
 *
 * Renamed from "channel-suggestion" (item 10) to "channel-policy" (item 11): calling this directory
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
  /** Free-form, e.g. `{ role: 'B2B' }` — an explicit extension point, deliberately UNUSED by this
   *  task's own mechanism (every shipped mandate today applies unconditionally to every invoice the
   *  issuing company sends): a future mandate that only binds a subset of invoices (a role, a buyer
   *  country) has somewhere to put that fact without a schema change, but nothing reads it yet — the
   *  same "not devinée" discipline `country-policy/schema.ts`'s own `notes` field already holds for a
   *  different kind of extra fact. */
  scope?: Record<string, unknown>;
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
