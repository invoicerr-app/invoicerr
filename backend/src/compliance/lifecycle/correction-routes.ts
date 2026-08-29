/**
 * P3-T02 — reading the correction routes a profile declares.
 *
 * P3-T01 (`docs/compliance/CORRECTION-ROUTES.yaml`) statused 11 routes across the 7 pivots and found
 * that NO route carries the same status in every country — not even `CREDIT_NOTE`, which every
 * shipped profile used to declare. The single `correctionModel` enum could not hold that, so the
 * routes now live beside it and the enum is DERIVED from them.
 *
 * Derived, not duplicated. D-002 recorded the risk that phase 3 would build a third representation
 * of something already modelled twice; `primaryCorrectionModel()` plus the data-integrity assertion
 * that the declared enum equals the derived one is the answer to that warning. There is one source
 * of truth, and drift is a failing test rather than a silent divergence.
 *
 * WHAT IS DELIBERATELY ABSENT: composing two countries. The eventual goal is (emitter, receiver,
 * kind) → actions, resolved the way `tax-engine.ts` composes a seller and a buyer profile rather
 * than enumerating an N×N matrix. The SHAPE is ready for that — each rule carries its own status,
 * direction and transmission, so two rule sets can be intersected. The RULE is not: P3-T01 sourced
 * each country in isolation and established nothing about whose law governs a correction when the
 * two diverge. Writing an intersection here would be inventing the one kind of thing this codebase
 * must never invent. It needs its own sourced task first.
 */
import { CorrectionRouteRule } from '../profiles/schema';
import { CorrectionModel, CorrectionRoute, RouteStatus, VariationDirection } from '../types';

/**
 * The three routes the legacy enum can name, and the two precedences used to pick one.
 *
 * They differ on purpose. When a route is REQUIRED, the compelled one wins and the most specific
 * comes first: Poland requires a corrective invoice, Mexico requires cancel-and-replace, and neither
 * caller may be steered toward the credit note they also happen to allow.
 *
 * When NOTHING is compelled, the historical default wins instead. The United States is the reason:
 * every route there is `OPEN` in the weak sense that no text forbids it — the whole country is a
 * sourced negative — so a required-style precedence would flip it from `CREDIT_NOTE` to
 * `CORRECTIVE_INVOICE` on no legal basis whatsoever. Reordering a country because a list happened to
 * be sorted one way is exactly the kind of invented rule this module must not produce. France and
 * Italy land in this tier too, and both keep the value they shipped with.
 */
const REQUIRED_PRECEDENCE: readonly CorrectionModel[] = [
  'CORRECTIVE_INVOICE',
  'CANCEL_AND_REPLACE',
  'CREDIT_NOTE',
];
const OPEN_PRECEDENCE: readonly CorrectionModel[] = [
  'CREDIT_NOTE',
  'CORRECTIVE_INVOICE',
  'CANCEL_AND_REPLACE',
];
const LEGACY_MODELS: readonly CorrectionModel[] = REQUIRED_PRECEDENCE;

/** Whether a route is one the `CorrectionModel` enum can express at all. */
function isLegacyModel(route: CorrectionRoute): route is CorrectionModel {
  return (LEGACY_MODELS as readonly string[]).includes(route);
}

export function findRoute(
  routes: readonly CorrectionRouteRule[] | undefined,
  route: CorrectionRoute,
): CorrectionRouteRule | undefined {
  return routes?.find((r) => r.route === route);
}

/**
 * All entries for a route. A route may legitimately appear more than once: the first entry is the
 * general rule and each later one a case-specific carve-out. France is the case — the credit note is
 * OPEN for a cancelled sale and FORBIDDEN for an unpaid invoice, and collapsing that into one status
 * would lose whichever half was dropped. data-integrity requires every entry after the first to say
 * which case it covers.
 */
export function findAllRoutes(
  routes: readonly CorrectionRouteRule[] | undefined,
  route: CorrectionRoute,
): CorrectionRouteRule[] {
  return (routes ?? []).filter((r) => r.route === route);
}

export function statusOf(
  routes: readonly CorrectionRouteRule[] | undefined,
  route: CorrectionRoute,
): RouteStatus | undefined {
  return findRoute(routes, route)?.status;
}

/** REQUIRED or OPEN — the two statuses under which a caller may actually take the route. */
export function isAvailable(
  routes: readonly CorrectionRouteRule[] | undefined,
  route: CorrectionRoute,
): boolean {
  const s = statusOf(routes, route);
  return s === 'REQUIRED' || s === 'OPEN';
}

/**
 * The routes whose transmission the country FORBIDS. This is the set P3-T03 needs: France on
 * statuses Refusée/Rejetée and Italy after a scarto both REQUIRE a correction document and forbid
 * it leaving. `correctInvoice()` currently issues and then transmits, unconditionally.
 */
export function untransmittableRoutes(
  routes: readonly CorrectionRouteRule[] | undefined,
): CorrectionRouteRule[] {
  return (routes ?? []).filter((r) => r.transmission === 'FORBIDDEN');
}

/** Routes available for a given direction of variation. A rule with no direction serves both. */
export function routesForDirection(
  routes: readonly CorrectionRouteRule[] | undefined,
  direction: VariationDirection,
): CorrectionRouteRule[] {
  return (routes ?? []).filter(
    (r) => isAvailable(routes, r.route) && (r.direction === undefined || r.direction === direction),
  );
}

/**
 * Which of the three buildable strategies this country's routes come down to.
 *
 * A required legacy route wins over an open one, and each tier has its own precedence for the reason
 * given above the two lists. Falls back to `CREDIT_NOTE` when a profile declares no routes at all —
 * which is the pre-P3-T02 behaviour of every profile, so an unresearched country keeps behaving
 * exactly as it did.
 */
export function primaryCorrectionModel(routes: readonly CorrectionRouteRule[] | undefined): CorrectionModel {
  if (!routes?.length) return 'CREDIT_NOTE';
  const legacy = routes.filter((r) => isLegacyModel(r.route));
  const pick = (order: readonly CorrectionModel[], status: RouteStatus): CorrectionModel | undefined =>
    order.find((m) => legacy.some((r) => r.route === m && r.status === status));
  return pick(REQUIRED_PRECEDENCE, 'REQUIRED') ?? pick(OPEN_PRECEDENCE, 'OPEN') ?? 'CREDIT_NOTE';
}
