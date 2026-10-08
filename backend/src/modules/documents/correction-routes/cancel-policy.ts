/**
 * Whether cancelling an already-issued invoice can be done locally for a seller country, read off the
 * CANCEL_AND_REPLACE route of that country's `correctionRoutes` section (`locallyImplementable`,
 * `restrictedToStatuses`). The legal status alone is not enough: a route can be `required` in law
 * yet realized only through another mechanism (a corrective invoice), which this app does not treat
 * as a cancel. The result has the `CountryPolicyDecision` shape so `documents.service.ts` composes it
 * through the same 403/409 machinery as every other action.
 */
import { CountryPolicyDecision } from '../country-policy/country-policy';
import { defaultCorrectionRoutesCatalog } from './registry';
import { CorrectionRouteFact } from './schema';

function findCancelAndReplaceRoute(countryCode: string): CorrectionRouteFact | undefined {
  const file = defaultCorrectionRoutesCatalog.fileFor(countryCode);
  return file?.routes.find((route) => route.routeId === 'CANCEL_AND_REPLACE');
}

/** The route's own words, verbatim, never a summary written for this endpoint. */
function describeRouteWords(route: CorrectionRouteFact): string {
  return route.provenance.kind === 'legal'
    ? `"${route.provenance.sourceText}" (checked ${route.provenance.sourceCheckedAt})`
    : `unverified — ${route.provenance.resolutionNote}`;
}

function describeCancelRefusal(countryCode: string, route: CorrectionRouteFact): string {
  return (
    `Cancelling an invoice locally is not implementable for "${countryCode}" today: its own ` +
    `CANCEL_AND_REPLACE data (status: ${route.status}) says ${describeRouteWords(route)} — the route ` +
    'is declared under local law, but this application does not yet automate it locally.'
  );
}

/** `countryCode` is the seller country, as `resolveCompanyCountryCode` returns it. */
export function resolveCancelPolicyForCountry(countryCode: string | undefined | null): CountryPolicyDecision {
  const resolved = (countryCode ?? '').trim().toUpperCase();
  const route = resolved ? findCancelAndReplaceRoute(resolved) : undefined;

  if (!route) {
    return {
      allowed: false,
      reason: resolved
        ? `No correction-routes data (CANCEL_AND_REPLACE) is declared for "${resolved}" — cancellation ` +
          'cannot be founded without it.'
        : "This company's country does not resolve to a recognized country — cancellation cannot be " +
          'founded without a resolved seller country.',
    };
  }

  if (!route.locallyImplementable) {
    return { allowed: false, reason: describeCancelRefusal(resolved, route) };
  }

  return route.restrictedToStatuses
    ? { allowed: true, restrictedToStatuses: route.restrictedToStatuses }
    : { allowed: true };
}

/** Every seller country whose data founds a local cancel. */
export function countriesWithLocalCancel(): string[] {
  return defaultCorrectionRoutesCatalog
    .countries()
    .filter((countryCode) => findCancelAndReplaceRoute(countryCode)?.locallyImplementable === true);
}
