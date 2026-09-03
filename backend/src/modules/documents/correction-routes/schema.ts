/**
 * The country CORRECTION-ROUTES file format — TODO_CORRECTION.md C1. A correction route is HOW a
 * country lets (or forbids) a seller correct an already-ISSUED invoice: a separate credit note, a
 * corrective invoice referencing the original, an internal write-off never sent anywhere, an
 * authority-side annulment, and so on. Same file-per-country, load-time-gated shape as
 * `b2g-routing/schema.ts` and `country-policy/schema.ts` (this module's own two direct siblings) — see
 * this directory's `registry.ts` header for why this one, unlike those two, stays a PURE file read
 * with no database mirror.
 *
 * The SOURCE this format transcribes is `docs/compliance/CORRECTION-ROUTES.yaml` — a research
 * document, not code, and NOT itself a source of law (see that file's own header: `sourced` there
 * means checked against a primary legal text, `unverified` means nobody has). This schema's own gate
 * mirrors that distinction one level down: every route here carries EITHER a `legal` provenance
 * (quoting the YAML's own `basis`/citation for that route, verbatim) OR an `unverified` one — never a
 * bare, unsourced status. There is no third option and no silent default.
 *
 * THE VOCABULARY IS CLOSED, DELIBERATELY. `docs/compliance/CORRECTION-ROUTES.yaml`'s own "LE
 * VOCABULAIRE DES VOIES" section names exactly eleven routes, built abstract by construction so no
 * business code ever has to spell a country's own local name for one (a French "avoir" and a Polish
 * "faktura korygująca" are different routes entirely — CREDIT_NOTE vs CORRECTIVE_INVOICE — while a
 * French "avoir interne" and an Italian post-scarto internal write-off are the SAME route,
 * INTERNAL_CREDIT_NOTE, under two different legal systems). `CORRECTION_ROUTE_IDS` below is that exact
 * eleven, and `assertValidCorrectionRouteFact` refuses anything else — a country file may not invent a
 * twelfth route (e.g. Poland's own abolished "BUYER_CORRECTION_NOTE", or Germany's narrower
 * "CREDIT_NOTE_ALLOCATION" sub-case) as if it were one of the eleven canonical axes; a genuinely new
 * axis discovered for some country belongs back in the YAML first, as P3-T01 itself proves it already
 * happened four times ("four_routes_the_plan_did_not_list").
 */

import { LegalProvenance, PolicyProvenance, UnverifiedProvenance } from '../country-policy/schema';

export { LegalProvenance, UnverifiedProvenance };

/** The eleven correction routes named in `docs/compliance/CORRECTION-ROUTES.yaml`'s own "routes:"
 *  vocabulary section — see this file's own header for why this list is closed. */
export const CORRECTION_ROUTE_IDS = [
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'CORRECTIVE_INVOICE',
  'CANCEL_AND_REPLACE',
  'INTERNAL_CREDIT_NOTE',
  'AUTHORITY_ANNULMENT',
  'RESUBMIT_SAME_IDENTITY',
  'ANNOTATED_DUPLICATE',
  'LEDGER_ANNOTATION',
  'NO_DOCUMENT_BY_LAW',
  'COUNTERPARTY_OBJECTION',
] as const;

export type CorrectionRouteId = (typeof CORRECTION_ROUTE_IDS)[number];

/**
 * `required`/`allowed`/`forbidden` are the three the YAML itself uses (as `required`/`open`/
 * `forbidden` — renamed to `allowed` here only to read naturally next to `required`/`forbidden`,
 * never a change of meaning). `unverified` is a FOURTH, honest state: the YAML explicitly marks a
 * route `unverified` for a country ("settled_by: Non recherchée pour ..."), or simply never mentions
 * it for that country at all — both transcribe to `unverified` here, never promoted to a guess (see
 * `assertValidCorrectionRouteFact`'s own coupling of this field to `provenance.kind`).
 */
export type CorrectionRouteStatus = 'required' | 'allowed' | 'forbidden' | 'unverified';

export interface CorrectionRouteFact {
  routeId: CorrectionRouteId;
  status: CorrectionRouteStatus;
  provenance: PolicyProvenance;
  /** Free-form caveats — same convention as `b2g-routing/schema.ts`'s own per-fact `notes`. For this
   *  format specifically: MUST carry (a) where in `docs/compliance/CORRECTION-ROUTES.yaml` this row
   *  was transcribed from (path + the YAML's own `meta.updated` date) and (b) the primary source the
   *  YAML itself cites — see `data/fr.json` for a worked example. Optional only at the TYPE level
   *  because `schema.spec.ts`'s own fixtures build a bare fact to exercise the gate; every SHIPPED row
   *  has one (enforced by `data/all.spec.ts`'s content-pinning tests, not by this gate itself — a
   *  missing transcription pointer is a documentation smell, not an unsafe-to-load fact the way a
   *  missing legal citation is).
   */
  notes?: string;
}

export interface CountryCorrectionRoutesFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  /** Always exactly the eleven `CORRECTION_ROUTE_IDS`, one entry each — see `data/all.ts`'s own
   *  loader for why a shipped file is required to be exhaustive rather than sparse: a country file
   *  that simply omitted a route would be indistinguishable, from the read side, from "this country
   *  file forgot to consider it", the exact ambiguity `unverified` exists to remove. */
  routes: CorrectionRouteFact[];
  /** Free-form, file-level caveats — the country's own YAML-level `provenance`/`consulted`/`caveat`/
   *  `headline` folded into one string, same convention as `mentions/schema.ts`'s own file-level
   *  `notes`. Distinct from a per-route `notes`, which explains ONE route. */
  notes?: string;
}

export class InvalidCorrectionRouteProvenanceError extends Error {}

/**
 * The one gate a route cannot get past without a real citation — same role
 * `b2g-routing/schema.ts#assertValidB2gRoutingFact` and `country-policy/schema.ts#assertValidProvenance`
 * play for their own formats, with ONE addition neither of those needs: `status` and `provenance.kind`
 * are COUPLED here, not independent. `country-policy/schema.ts`'s own `allowed: boolean` can carry
 * either provenance kind (an `unverified` rule can still say `allowed: true`) because "allowed" there
 * is a genuine, if under-researched, belief. Here `unverified` IS the status — a route nobody has
 * researched for this country has no business claiming `required`/`allowed`/`forbidden` at all, and a
 * route this file confidently calls `required`/`allowed`/`forbidden` has no business hiding behind an
 * `unverified` provenance. So:
 *   - status "unverified"                       -> provenance.kind MUST be "unverified"
 *   - status "required"/"allowed"/"forbidden"    -> provenance.kind MUST be "legal"
 * Flipping either side of that pairing is exactly the mutation this gate exists to catch — see
 * `schema.spec.ts`'s own "mutation-ready" tests.
 */
export function assertValidCorrectionRouteFact(fact: CorrectionRouteFact, context: string): void {
  if (!(CORRECTION_ROUTE_IDS as readonly string[]).includes(fact.routeId)) {
    throw new InvalidCorrectionRouteProvenanceError(
      `${context}: "${fact.routeId}" is not one of the eleven canonical correction routes ` +
        `(${CORRECTION_ROUTE_IDS.join(', ')}) — a country file may not invent a route outside the ` +
        'vocabulary docs/compliance/CORRECTION-ROUTES.yaml already establishes.',
    );
  }

  const validStatuses: CorrectionRouteStatus[] = ['required', 'allowed', 'forbidden', 'unverified'];
  if (!validStatuses.includes(fact.status)) {
    throw new InvalidCorrectionRouteProvenanceError(
      `${context} (${fact.routeId}): status "${fact.status}" is not one of ${validStatuses.join(', ')}.`,
    );
  }

  const provenance = fact.provenance as { kind?: unknown } | null | undefined;
  if (!provenance || (provenance.kind !== 'legal' && provenance.kind !== 'unverified')) {
    throw new InvalidCorrectionRouteProvenanceError(
      `${context} (${fact.routeId}): a correction-route fact has no valid provenance (kind must be ` +
        '"legal" or "unverified") — it may never exist without saying where it came from.',
    );
  }

  if (fact.status === 'unverified') {
    if (provenance.kind !== 'unverified') {
      throw new InvalidCorrectionRouteProvenanceError(
        `${context} (${fact.routeId}): status is "unverified" but provenance.kind is "legal" — an ` +
          'unverified route may not smuggle in a legal citation that would make it something else.',
      );
    }
    const unverified = fact.provenance as UnverifiedProvenance;
    if (!unverified.resolutionNote?.trim()) {
      throw new InvalidCorrectionRouteProvenanceError(
        `${context} (${fact.routeId}): is "unverified" but has no resolutionNote — an unverified ` +
          'route must say what would settle it (or plainly that the YAML never addressed it for this ' +
          'country).',
      );
    }
    return;
  }

  // status is required/allowed/forbidden here — THE GATE this whole module exists to enforce.
  if (provenance.kind !== 'legal') {
    throw new InvalidCorrectionRouteProvenanceError(
      `${context} (${fact.routeId}): status is "${fact.status}" but provenance.kind is "unverified" — ` +
        'a route may never claim required/allowed/forbidden without a legal citation backing it.',
    );
  }
  const legal = fact.provenance as LegalProvenance;
  if (!legal.sourceText?.trim() || !legal.sourceCheckedAt?.trim()) {
    throw new InvalidCorrectionRouteProvenanceError(
      `${context} (${fact.routeId}): claims "legal" provenance but is missing sourceText and/or ` +
        'sourceCheckedAt.',
    );
  }
}
