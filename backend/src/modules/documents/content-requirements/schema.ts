/**
 * The country CONTENT-REQUIREMENT file format — the trigger for "does this country's law require a
 * specific EN 16931 FIELD to carry a specific, derivable value on every invoice". A DIFFERENT concern
 * from `mentions/` (which prints country-mandated free TEXT — BG-1, BT-21/BT-22) and from
 * `country-policy/` (which decides whether a document ACTION may run at all): this format decides
 * whether one particular STRUCTURED FIELD's value is a matter of national law, temporal, sourced —
 * the same "country is data" discipline every sibling format in `documents/` already holds, scaled to
 * a THIRD shape of country fact none of the existing ones is honest for.
 *
 * Named for the CONCEPT, not the first fact it carries — the same reasoning `channel-policy/
 * schema.ts`'s own header gives for why that directory was renamed from "channel-suggestion" once one
 * of its own facts stopped being merely advisory: a directory called "business-process" (BT-23's own
 * name) would stop being an honest name the day a second field (a future BT, not BT-23) needed the
 * exact same "mandated from a date, with a citation" shape. A NEW, small, dedicated module rather
 * than folding this into `mentions/` — that module's own `InvoiceNoteRule` is built entirely around
 * rendering free TEXT (BT-22, `noteValues` interpolation); BT-23 is a closed-vocabulary CODE with no
 * text of its own, and stretching `mentions/`'s shape (or its name) to cover it would cost touching
 * every existing mentions/ file, test, and caller for a concept that does not actually need any of
 * mentions/'s own text-interpolation machinery. Lowest cost: a new file of the same MOLD.
 *
 * Root TODO item 15's own remainder: a real superpdp deposit's conformity POLL (never the deposit
 * ACCEPTANCE gate itself — see `../transports/pdp/pdp.live.spec.ts`'s own header on why that
 * distinction matters) kept citing exactly one cause after items 15/A4 landed —
 *
 *   "BR-FR-08/BT-23 : La valeur du mode de facturation (ram:ID) est absente ou n'est pas autorisée."
 *
 * — because `formats/semantic/business-process.ts`'s own `frenchBusinessProcessCode`/
 * `applyFrenchBusinessProcess` were proven, unit-tested, and never WIRED: that file's own header
 * explained the missing piece was exactly "a country-conditional decision" with nowhere sourced to
 * live yet. This format is that missing piece.
 *
 * Deliberately modeled on `channel-policy/schema.ts`'s own `ChannelPolicyFact` — same half-open
 * `mandatedFrom` (a date in the future is the ordinary, intended state, not an error — see that
 * file's own header), same "no `unverified` escape hatch for a binding fact" rule, same two-argument
 * `assertValidContentRequirementFact` gate called once, at load time (`data/all.ts`) — there is no
 * second, seed-time gate to mirror (`registry.ts`'s own header explains why, the same reason
 * `mentions/registry.ts` and `channel-policy/registry.ts` both give: nothing here is ever mirrored
 * into a database `country-policy/`'s own facts are). UNLIKE `channel-policy/`, there is no
 * `'suggested'` requirement level here: a content requirement either binds from a date, or the
 * country has no file/fact for it at all — there is no product-opinion "usual" state for a FIELD the
 * way there is for a transport CHANNEL, so this format does not need `ChannelRequirement`'s own
 * two-value union.
 */
import { LegalProvenance } from '../country-policy/schema';

/**
 * One country's requirement that a specific field carry a country-specific, derivable value from a
 * given date — e.g. France's BT-23 "cadre de facturation", mandatory from 2026-09-01.
 */
export interface ContentRequirementFact {
  /** The EN 16931 business-term id this fact concerns, e.g. "BT-23" — free text, deliberately NOT
   *  validated against any live field/BT catalog: this file and whatever code branches on `field`
   *  (today, only `formats/semantic/business-process.ts`) are independently maintained, the same
   *  declared-independence risk `country-policy/schema.ts`'s own `typeId`/`actionId` already accept. */
  field: string;
  /**
   * ISO date (yyyy-mm-dd) this requirement becomes binding — compared against the DOCUMENT's own
   * `issueDate`, never the server's current date, the exact same temporal contract
   * `channel-policy/mandate.ts`'s own `activeChannelMandateFor` already holds for a channel mandate
   * (see that file's header for the full reasoning: a country's rule is a fact about WHEN AN
   * OPERATION WAS CARRIED OUT, and re-judging an old invoice by today's clock would restate a
   * document that was correct when issued). A date in the future is the ordinary, intended state for
   * a requirement whose start date is already known ahead of time, never an error.
   */
  mandatedFrom: string;
  /** A content requirement is ALWAYS a legal claim (it asserts a country's law demands a specific
   *  field value) — never `PolicyProvenance`'s wider `'unverified'` branch the way a channel
   *  SUGGESTION still can be: there is no non-binding "content is usually formatted this way" state
   *  this format needs to express, so this field is typed directly as `LegalProvenance`, not the
   *  union, and `assertValidContentRequirementFact` needs no branch on `provenance.kind` at all. */
  provenance: LegalProvenance;
  /** Free-form caveats — same convention as every sibling format's own `notes`. */
  notes?: string;
}

export interface CountryContentRequirementsFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  facts: ContentRequirementFact[];
  /** Free-form, file-level caveats. */
  notes?: string;
}

export class InvalidContentRequirementFactError extends Error {}

/**
 * The one gate a content requirement cannot get past without a real citation and a real start date —
 * called from `data/all.ts` at load time, the same single-gate discipline `mentions/schema.ts#
 * assertValidMentionRule`'s own header explains is enough here (nothing in this format is ever
 * mirrored into a database the way `country-policy/`'s own facts are, so there is no second write
 * path a load-time-only gate could miss).
 */
export function assertValidContentRequirementFact(fact: ContentRequirementFact, context: string): void {
  if (!fact.field?.trim()) {
    throw new InvalidContentRequirementFactError(
      `${context}: a content requirement fact is missing its "field".`,
    );
  }
  if (!fact.mandatedFrom?.trim()) {
    throw new InvalidContentRequirementFactError(
      `${context}: fact "${fact.field}" has no "mandatedFrom" date — a requirement with no start ` +
        "date can never be evaluated against an invoice's own issue date.",
    );
  }
  const provenance = fact.provenance as { kind?: unknown } | null | undefined;
  if (provenance?.kind !== 'legal') {
    throw new InvalidContentRequirementFactError(
      `${context}: fact "${fact.field}" has no valid "legal" provenance — a content requirement is ` +
        'always a legal claim and must carry a real citation (sourceText + sourceCheckedAt), never ' +
        '"unverified": if the law is not actually confirmed, this fact should not be shipped yet.',
    );
  }
  const legal = fact.provenance as LegalProvenance;
  if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
    throw new InvalidContentRequirementFactError(
      `${context}: fact "${fact.field}" claims "legal" provenance but is missing sourceText and/or ` +
        'sourceCheckedAt.',
    );
  }
}
