/**
 * The READ side of the correction-routes catalog (TODO_CORRECTION.md C1) — a plain function reading
 * the in-memory `CorrectionRoutesCatalog` directly, same convention `b2g-routing/b2g-routing.ts` and
 * `country-policy/country-policy.ts` already established for "read one fact about a country, decide":
 * no DI token, mockable with `jest.mock` the exact same way `documents.service.correction-routes.spec.ts`
 * mocks this module wholesale.
 *
 * Reads the SELLER's own country ONLY — the country of the ACTIVE COMPANY issuing (and now
 * correcting) the document, resolved by `country-policy/country-policy.ts#resolveCompanyCountryCode`
 * exactly the way every other document-action gate in this module already does. This is a REAL,
 * DOCUMENTED LIMIT, not an oversight: `docs/compliance/CORRECTION-JURISDICTION.yaml` (P3-U01) finds
 * FOUR distinct cross-border attachments, and confirms this repo's own engine already follows the
 * right one for THIS specific question — "A_invoicing_rules" (which correction DOCUMENT a country
 * imposes) attaches to the supplier's own state under EU directive 2006/112/CE art. 219 bis. But a
 * SECOND layer, "B_substantive_vat" (whether/how the tax base may be reduced, and the DEADLINE for
 * doing so), attaches to the STATE OF TAXATION instead — which, under reverse-charge, can be the
 * BUYER's own country. Composing the two (P3-U02) is NOT written here: this endpoint answers "what
 * document does my own country require", never "what does this specific cross-border correction, to
 * this specific buyer, actually require" — see `LIMITATION_TEXT` below, always returned alongside the
 * routes so a caller can never mistake the one question for the other.
 */
import {
  CORRECTION_ROUTE_IDS,
  CorrectionRouteId,
  CorrectionRouteStatus,
  LegalProvenance,
  UnverifiedProvenance,
} from './schema';
import { defaultCorrectionRoutesCatalog } from './registry';

/** Where a human adds the missing file — spelled out in the block message itself, same convention as
 *  `country-policy.ts`'s own `DATA_DIR_HINT` / `b2g-routing.ts`'s own `B2G_ROUTING_DATA_DIR_HINT`. */
export const CORRECTION_ROUTES_DATA_DIR_HINT = 'backend/src/modules/documents/correction-routes/data';

/**
 * The only route this repo actually WIRES to a real mechanism today: the credit-note document type's
 * own creation (`actions/credit-note-actions.ts`), pre-linked to the invoice it corrects (mandatory
 * reference, currency locked — see TODO_PRODUIT.md T4-d/T3). Every other one of the eleven canonical
 * routes is DECLARED (a country may `require`/`allow`/`forbid` it) but has NO implementation behind it
 * — this set is the one place that honesty is decided, so a country file changing its mind about a
 * STATUS can never accidentally change what the API claims is IMPLEMENTED, and vice versa.
 *
 * DELIBERATELY NOT `CANCEL_AND_REPLACE`, `AUTHORITY_ANNULMENT`, etc. even where a country requires
 * them (Mexico, Germany) — TODO_CORRECTION.md C1's own scope is the catalog and the read API; wiring a
 * second real mechanism is C2/C3's job, not this one's.
 */
const IMPLEMENTED_ROUTE_IDS: ReadonlySet<CorrectionRouteId> = new Set(['INTERNAL_CREDIT_NOTE']);

/** Same shared phrasing every "GET .../correction-routes" response carries — see this module's own
 *  header for the P3-U01/P3-U02 reasoning this text is a plain-language summary of. */
const LIMITATION_TEXT =
  "This reads the document's SELLER country only (the active company issuing it) — never the buyer's. " +
  'For a purely domestic invoice this is the whole answer (docs/compliance/CORRECTION-JURISDICTION.yaml ' +
  'confirms the invoicing-rule layer, art. 219 bis, already correctly follows the supplier). For a ' +
  'cross-border one, the SELLER×BUYER composition (task P3-U02, TODO_CORRECTION.md) is NOT written: ' +
  "the buyer's own country can, under reverse-charge, govern whether/how the tax base may be reduced " +
  'and by when — a fact this endpoint does not know and never guesses.';

/** One route, as this API hands it back — see this file's own header for `implemented`'s exact
 *  meaning and `describeLabel` for how `label` is built. */
export interface CorrectionRouteView {
  routeId: CorrectionRouteId;
  status: CorrectionRouteStatus;
  /** The legal citation (or, for `unverified`, the honest resolution note) VERBATIM from the country
   *  file's own `provenance` — never a summary written for this endpoint. See `schema.ts`'s own header
   *  on why a route may not exist without exactly this. */
  label: string;
  implemented: boolean;
}

export interface CorrectionRoutesDecision {
  countryCode: string;
  routes: CorrectionRouteView[];
  limitation: string;
}

function describeLabel(provenance: LegalProvenance | UnverifiedProvenance): string {
  if (provenance.kind === 'legal') {
    return `"${provenance.sourceText}" (checked ${provenance.sourceCheckedAt})`;
  }
  return `unverified — ${provenance.resolutionNote}`;
}

/**
 * The full correction-routes decision for one seller country, or `undefined` when no file is declared
 * for it at all (unresolved country code included) — the caller (`documents.service.ts`) turns
 * `undefined` into the NAMED 404 TODO_CORRECTION.md C1 requires ("aucune règle de correction déclarée
 * pour XX"), never a silent empty list.
 */
export function resolveCorrectionRoutesForCountry(
  countryCode: string | undefined | null,
): CorrectionRoutesDecision | undefined {
  const resolved = (countryCode ?? '').trim().toUpperCase();
  if (!resolved) return undefined;

  const file = defaultCorrectionRoutesCatalog.fileFor(resolved);
  if (!file) return undefined;

  // Defensive, not load-bearing: `data/all.ts` already guarantees every SHIPPED file lists all eleven
  // canonical routes (`data/all.spec.ts`'s own pinned count). Sorted to `CORRECTION_ROUTE_IDS`' own
  // declared order so the API's own array order never depends on a JSON file's own line order.
  const byId = new Map(file.routes.map((route) => [route.routeId, route]));
  const routes: CorrectionRouteView[] = CORRECTION_ROUTE_IDS.filter((id) => byId.has(id)).map((id) => {
    const route = byId.get(id)!;
    return {
      routeId: route.routeId,
      status: route.status,
      label: describeLabel(route.provenance),
      implemented: IMPLEMENTED_ROUTE_IDS.has(route.routeId),
    };
  });

  return { countryCode: resolved, routes, limitation: LIMITATION_TEXT };
}
