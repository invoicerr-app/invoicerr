/**
 * TODO_CORRECTION.md C3 — whether cancelling an already-ISSUED invoice is something this repo can
 * actually do LOCALLY for a given seller country, and from which of the invoice's own post-issuance
 * statuses ("sent"/"send_failed" — invoice.descriptor.ts's own CANCEL_TRANSITIONS). Read straight off
 * the SAME correction-routes catalog C1 already loads (registry.ts) — this is a DECISION about the
 * eleven-route vocabulary's own CANCEL_AND_REPLACE, never a second, independently-typed country file.
 *
 * `resolveCancelPolicyForCountry` returns the exact same shape `country-policy/country-policy.ts`'s
 * own `evaluateCountryPolicy` does (`CountryPolicyDecision`) so `documents.service.ts` can compose it
 * through the IDENTICAL 403/409 machinery `runAction` already holds for every other action — see that
 * file's own `resolveActionPolicy`. What differs is the SOURCE: `country-policy/` is a DB-mirrored
 * table covering three countries today (FR/US/HU — data/all.ts), a coverage gap orthogonal to this
 * one and out of this task's scope to close; `correction-routes/` covers all SEVEN pivots with the
 * exact legal citation this action needs, which is why "cancel" reads THIS catalog instead, never the
 * country-policy/ table (see documents.service.ts's own comment on why the two are deliberately kept
 * apart rather than merged).
 *
 * ## Why this can't be a generic "status is required/allowed -> implementable" rule
 *
 * Unlike INTERNAL_CREDIT_NOTE's own universal `IMPLEMENTED_ROUTE_IDS` entry (correction-routes.ts,
 * C1/C2: the credit-note SCREEN works identically regardless of which country calls it, only its
 * required/allowed/forbidden STATUS varies), CANCEL_AND_REPLACE's own REALIZATION genuinely differs
 * per country — two of the seven pivots DECLARE it `required`/`allowed` yet have NO real local
 * cancellation mechanism behind it at all:
 *
 *  - Poland (`required`): data/pl.json's own notes say it plainly — "Exécuté AU MOYEN de factures
 *    correctives, jamais par une annulation — la voie existe, le mécanisme d'annulation non." The
 *    ROUTE is mandatory, but its own REALIZATION is a corrective invoice (CORRECTIVE_INVOICE, a
 *    different mechanism this task does not build), never a status flip on the original record.
 *  - Mexico (`required`): data/mx.json's own sourceText NAMES an authority operation as step 2 of the
 *    mandated order — "Al registrar la solicitud de cancelación..." (a request submitted THROUGH the
 *    SAT/PAC channel) — exactly as un-implementable as AUTHORITY_ANNULMENT itself (data/mx.json's own
 *    AUTHORITY_ANNULMENT entry, also `required`, for the identical missing-channel reason: this repo
 *    wires no SAT/PAC transport at all today — `grep -rn mx transports/` finds nothing), even though
 *    the ROUTE ID differs. AUTHORITY_ANNULMENT itself stays out of scope for every pivot for the same
 *    reason (KSeF/SdI/PDP wire no cancellation OPERATION today either) — see documents.service.ts's
 *    own `resolveActionPolicy` header.
 *
 * Spain's own CANCEL_AND_REPLACE is simply `forbidden` — the generic refusal already covers it, no
 * exception needed. So this stays a per-country WHITELIST (`CANCEL_LOCAL_AVAILABILITY` below), each
 * entry justified inline and cross-checked against the ACTUAL loaded route status
 * (`resolveCancelPolicyForCountry` throws if a country's own JSON status no longer matches what this
 * whitelist assumes — cancel-policy.spec.ts proves it) so a future edit to a country's own correction-
 * routes file that invalidates one of these assumptions fails LOUDLY at the moment it is READ, never
 * silently drifts into a wrong answer.
 *
 * Italy is the one exception with a REAL local mechanism but a NARROWER scope than the other three:
 * its own data says CANCEL_AND_REPLACE exists "Après scarto UNIQUEMENT (inexistant après livraison au
 * destinataire)" — i.e. only once SdI has REJECTED the invoice, never once it actually reached the
 * recipient. This app's own "send_failed" status IS SdI's scarto (a transmission the transport itself
 * reports as failed/rejected); "sent" is a successful delivery, the one case Italy's own data says
 * this route does NOT cover. Hence Italy is the only pivot with `restrictedToStatuses: ['send_failed']`
 * — cancel stays impossible for an Italian invoice that was actually delivered, honestly narrower than
 * the descriptor's own `availableWhen: ['sent', 'send_failed']`, exactly reflecting the gap the data
 * itself draws (composed by `documents.service.ts#runAction`'s existing `restrictedToStatuses` 409,
 * the same mechanism `country-policy/`'s own per-status narrowing already uses for other actions).
 *
 * FR, DE and US ground an UNRESTRICTED local cancel: none of their own CANCEL_AND_REPLACE sourceText
 * names an authority step, a transmission-outcome precondition, or any other narrowing — FR ("Doit
 * porter référence exacte à la facture initiale et la mention expresse de l'annulation de celle-ci"),
 * DE ("Auch der Stornierung einer Rechnung nebst Neuausstellung einer sie ersetzenden Rechnung kann
 * eine Rückwirkung [...] zukommen" — DE additionally grounds the SAME conclusion a second, independent
 * way through NO_DOCUMENT_BY_LAW, `allowed`, Germany's own DEFAULT correction route, "aucune correction
 * de facture n'est requise" — not read by this module since CANCEL_AND_REPLACE alone already suffices),
 * US ("Rien à annuler auprès de personne [...] Réémettre est un acte purement privé").
 */
import { CountryPolicyDecision } from '../country-policy/country-policy';
import { defaultCorrectionRoutesCatalog } from './registry';
import { CorrectionRouteFact, CorrectionRouteStatus } from './schema';

/** One whitelisted country's own local-cancel decision — see this file's header for why the entry
 *  ALSO pins the status it was reviewed against (`expectedStatus`), never trusted blind. */
interface CancelWhitelistEntry {
  expectedStatus: CorrectionRouteStatus;
  /** Absent = no narrowing beyond the descriptor's own `availableWhen` (['sent', 'send_failed']) —
   *  same "absent means no extra restriction" convention `country-policy/schema.ts`'s own
   *  `DocumentActionRuleFact.statuses` already holds. */
  restrictedToStatuses?: string[];
}

/** The whitelist itself — see this file's header for the per-country reasoning. A country's absence
 *  here is not an oversight: Spain (`forbidden`) needs no exception at all, and Poland/Mexico are
 *  DELIBERATELY excluded despite their own `required` status (the two documented "route exists,
 *  mechanism doesn't" cases) — the generic refusal path (`describeCancelRefusal` below) covers every
 *  one of those, citing the route's own words, never a silent fallback. */
const CANCEL_LOCAL_AVAILABILITY: Record<string, CancelWhitelistEntry> = {
  FR: { expectedStatus: 'allowed' },
  DE: { expectedStatus: 'allowed' },
  US: { expectedStatus: 'allowed' },
  IT: { expectedStatus: 'allowed', restrictedToStatuses: ['send_failed'] },
};

function findCancelAndReplaceRoute(countryCode: string): CorrectionRouteFact | undefined {
  const file = defaultCorrectionRoutesCatalog.fileFor(countryCode);
  return file?.routes.find((route) => route.routeId === 'CANCEL_AND_REPLACE');
}

/** The route's own words, verbatim — same "never a summary written for this endpoint" discipline
 *  `correction-routes.ts`'s own `describeLabel` already holds for the C1 API (kept as its own small,
 *  local copy rather than an import: sharing a three-line pure function across two files that must
 *  never import each other — see this file's own header on the correction-routes.ts <-> cancel-
 *  policy.ts dependency direction — is not worth the indirection). */
function describeRouteWords(route: CorrectionRouteFact): string {
  return route.provenance.kind === 'legal'
    ? `"${route.provenance.sourceText}" (checked ${route.provenance.sourceCheckedAt})`
    : `unverified — ${route.provenance.resolutionNote}`;
}

function describeCancelRefusal(countryCode: string, route: CorrectionRouteFact): string {
  return (
    `Cancelling an invoice locally is not implementable for "${countryCode}" today: its own ` +
    `CANCEL_AND_REPLACE data (status: ${route.status}) says ${describeRouteWords(route)} — see ` +
    'docs/compliance/CORRECTION-ROUTES.yaml and TODO_CORRECTION.md C3 for why this route is declared ' +
    'but not wired to a real local-cancellation mechanism.'
  );
}

/**
 * The per-country cancel decision — see this file's header. `countryCode` is the SELLER country
 * (`country-policy/country-policy.ts#resolveCompanyCountryCode`'s own result), exactly like every
 * other reader of this catalog.
 */
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

  const whitelisted = CANCEL_LOCAL_AVAILABILITY[resolved];
  if (!whitelisted) {
    // Poland, Mexico, Spain, and any 8th country whose file exists but was never reviewed for this
    // specific question — every one of them refused by NAME, quoting the route's own words, never a
    // silent fallback.
    return { allowed: false, reason: describeCancelRefusal(resolved, route) };
  }

  if (route.status !== whitelisted.expectedStatus) {
    // The cross-check this file's header promises: a country file edited without revisiting this
    // whitelist must refuse LOUDLY, never silently keep an assumption the data no longer supports.
    throw new Error(
      `cancel-policy.ts's whitelist for "${resolved}" expected CANCEL_AND_REPLACE status ` +
        `"${whitelisted.expectedStatus}" but data/${resolved.toLowerCase()}.json now says ` +
        `"${route.status}" — review this whitelist (and its own header comment) before trusting it ` +
        'again.',
    );
  }

  return whitelisted.restrictedToStatuses
    ? { allowed: true, restrictedToStatuses: whitelisted.restrictedToStatuses }
    : { allowed: true };
}

/** Every seller country this module currently founds a LOCAL cancel for — `correction-routes.ts` calls
 *  `resolveCancelPolicyForCountry` directly instead of this list (see that file's own `isImplemented`
 *  header for why: the direct call also gets the whitelist's own data-drift cross-check on every
 *  read, not just when someone actually tries to cancel). This export exists for
 *  cancel-policy.spec.ts alone, to enumerate exactly the whitelist this file declares without
 *  duplicating the country codes a second time in the test. */
export function countriesWithLocalCancel(): string[] {
  return Object.keys(CANCEL_LOCAL_AVAILABILITY);
}
