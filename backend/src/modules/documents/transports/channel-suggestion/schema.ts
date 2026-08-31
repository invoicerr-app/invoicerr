/**
 * The country CHANNEL-SUGGESTION file format — item 10 (root TODO), the settings-screen prompt that
 * tells a company "this transport is the usual one for your country" (product memory: FR → PDP).
 *
 * Deliberately NOT `country-policy/`'s `DocumentActionRuleFact`: a policy rule decides whether an
 * ACTION is legally permitted (and country-policy.ts's evaluator BLOCKS on it) — this is only ever a
 * non-binding, advisory HINT the frontend may or may not act on (data/fr.json.tsx renders it as a
 * "Connect" prompt, nothing more). Making a channel legally MANDATORY per country — actually
 * requiring it, not merely suggesting it — is root TODO item 11 ("canal imposé par pays"), a
 * different, sourced, ⚖ concern this format does not attempt.
 *
 * Reuses `PolicyProvenance` from `country-policy/schema.ts` rather than inventing a second
 * legal/unverified vocabulary: a suggestion is still a claim ("this is the channel worth proposing
 * to this country"), and it deserves the same "never exists unsourced" discipline that module already
 * enforces — see `assertValidChannelSuggestion` below, called at the same two points
 * (`data/all.ts` on load, and nowhere else: unlike country-policy, nothing here is ever written to a
 * database or re-validated at seed time — this is read directly, at request time, the same way
 * `country-fields/registry.ts`'s own catalog is).
 */
import { PolicyProvenance } from '../../country-policy/schema';

export interface ChannelSuggestionFact {
  /** A `documents/transports/transport-registry.ts` id — e.g. "pdp". Deliberately NOT validated
   *  against the live `TransportRegistry` here: this file and that registry are two independently
   *  maintained sources, the same shape of risk `country-policy/schema.ts`'s own `typeId`/`actionId`
   *  already accepts for the exact same reason (see that file's own comment on `typeId`). */
  providerId: string;
  provenance: PolicyProvenance;
}

export interface CountryChannelSuggestionFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  suggestions: ChannelSuggestionFact[];
}

export class InvalidChannelSuggestionProvenanceError extends Error {}

/** Same shape as `country-policy/schema.ts`'s `assertValidProvenance` — a separate function (not a
 *  shared one parameterized by a message) because that one's error text is pinned to
 *  "typeId.actionId" wording by its own spec; this fact has neither field. */
export function assertValidChannelSuggestion(fact: ChannelSuggestionFact, context: string): void {
  const provenance = fact.provenance as { kind?: unknown } | null | undefined;
  if (!fact.providerId?.trim()) {
    throw new InvalidChannelSuggestionProvenanceError(
      `${context}: a channel suggestion is missing its "providerId".`,
    );
  }
  if (!provenance || (provenance.kind !== 'legal' && provenance.kind !== 'unverified')) {
    throw new InvalidChannelSuggestionProvenanceError(
      `${context}: suggestion "${fact.providerId}" has no valid provenance (kind must be "legal" or ` +
        '"unverified") — a channel suggestion may never exist without saying where it came from.',
    );
  }

  if (provenance.kind === 'legal') {
    const legal = fact.provenance as Extract<PolicyProvenance, { kind: 'legal' }>;
    if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
      throw new InvalidChannelSuggestionProvenanceError(
        `${context}: suggestion "${fact.providerId}" claims "legal" provenance but is missing ` +
          'sourceText and/or sourceCheckedAt.',
      );
    }
    return;
  }

  const unverified = fact.provenance as Extract<PolicyProvenance, { kind: 'unverified' }>;
  if (!unverified.resolutionNote?.trim()) {
    throw new InvalidChannelSuggestionProvenanceError(
      `${context}: suggestion "${fact.providerId}" is "unverified" but has no resolutionNote — an ` +
        'unverified suggestion must say what would settle it.',
    );
  }
}
