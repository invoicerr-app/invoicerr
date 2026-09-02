/**
 * The point of accroche of declarative reporting onto `actions/async-send.ts`'s own "sent" write —
 * called right after `archiveDeliveredArtifactsIfAny` (never before it, and never before "sent" is
 * persisted): the SAME "après le fait acquis, jamais avant" principle that file's own header
 * documents at length, applied to a genuinely DIFFERENT concept.
 *
 * ## Why this is architecturally a COUSIN of archiving, never a transport
 *
 * Hungary (NAV Online Számla) and Greece (AADE myDATA) do not care HOW an invoice reaches the buyer
 * — email, Peppol, anything — they require the SELLER to declare the invoice's DATA to the tax
 * authority afterwards, in near-real-time. That is a fact about what happens AT `sent`, exactly like
 * archiving a legally-required copy is a fact about what happens at `sent` — never about delivery
 * itself. This is why the trigger lives here, generic across every document type
 * (`runAsyncSendAction`'s own `deliver()` never has to know a reporting obligation exists), rather
 * than inside `invoice-actions.ts`'s own `deliver()` closure: a country's obligation is keyed on
 * (seller country, document TYPE) — `reporting/data/*.json`'s own `appliesTo` — never on which
 * transport happened to carry the invoice.
 *
 * ## "Jamais silencieux" — see `report-job.ts`'s own header for the full failure vocabulary
 *
 * This function itself NEVER throws (mirrors `archiveDeliveredArtifactsIfAny`'s own guarantee) — it
 * only ever ENQUEUES a job; the job itself is what can fail, and it fails LOUD (see
 * `reporting-runner.ts`): `report:blocked` for missing credentials, `report:failed` once every retry
 * is exhausted, both journaled onto the EXISTING `DocumentAuthorityEvent` timeline, never onto
 * `DocumentInstance.lastActionError` (a reporting failure is not a "the send action itself failed"
 * fact — the invoice genuinely left; see `report-job.ts`'s own header on `REPORT_FAILED_STATUS_CODE`).
 *
 * ## A country with no obligation — "RIEN ne change"
 *
 * `ReportingObligationCatalog.obligationFor` returns `undefined` for every country with no
 * `reporting/data/*.json` file (which is every country except HU and GR today) — this function
 * returns immediately, having enqueued nothing, exactly the pre-existing "send" behaviour for every
 * type and every seller this task did not touch.
 */
import { logger } from '@/logger/logger.service';

import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { defaultReportingObligationCatalog, ReportingObligationCatalog } from './registry';

export interface ReportOnSendInput {
  companyId: string;
  typeId: string;
  documentId: string;
  queueDispatcher: DocumentActionQueueDispatcher;
}

/**
 * Called from `actions/async-send.ts`, unconditionally, for EVERY type/transport, right after the
 * archive call. NEVER throws.
 */
export async function reportOnSendIfObligated(
  input: ReportOnSendInput,
  catalog: ReportingObligationCatalog = defaultReportingObligationCatalog,
): Promise<void> {
  const { companyId, typeId, documentId, queueDispatcher } = input;

  // A dispatcher with no `enqueueReport` at all (every EXISTING bare-mock jest fixture across
  // quote/invoice/credit-note actions — see `queue/queue.constants.ts`'s own header) simply cannot
  // report — "no capability, no effect", never a crash.
  if (!queueDispatcher.enqueueReport) return;

  try {
    const countryCode = await resolveCompanyCountryCode(companyId);
    if (!countryCode) return;

    const obligation = catalog.obligationFor(countryCode, typeId);
    if (!obligation) return; // "pays sans obligation : RIEN ne change" — this task's own rule.

    await queueDispatcher.enqueueReport({
      companyId,
      documentId,
      typeId,
      providerId: obligation.providerId,
    });
  } catch (error) {
    // NEVER propagate — see this file's own header. The delivery already succeeded; a failure to
    // even ENQUEUE the declaration (a Redis hiccup — extremely rare, `DocumentQueueModule` requires
    // Redis at boot) must not be allowed to look like the send itself failed.
    logger.error('Failed to enqueue a declarative report after a successful send', {
      category: 'documents',
      details: {
        companyId,
        typeId,
        documentId,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
