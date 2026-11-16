/**
 * The hook point of declarative reporting onto `actions/async-send.ts`'s own "sent" write —
 * called last, after BOTH `archiveDeliveredArtifactsIfAny` (which now runs BEFORE the "sent" write
 * itself — see that file's own header, "The delivery guarantee") and the "sent" write have already
 * happened, never before either: the SAME "after the fact is settled, never before" principle that
 * file's own header documents at length, applied to a genuinely DIFFERENT concept.
 *
 * ## Why this is architecturally a COUSIN of archiving, never a transport
 *
 * Hungary (NAV Online Számla) and Greece (AADE myDATA) do not care HOW an invoice reaches the buyer
 * — email, PDP, anything — they require the SELLER to declare the invoice's DATA to the tax
 * authority afterwards, in near-real-time. That is a fact about what happens AT `sent`, exactly like
 * archiving a legally-required copy is a fact about what happens at `sent` — never about delivery
 * itself. This is why the trigger lives here, generic across every document type
 * (`runAsyncSendAction`'s own `deliver()` never has to know a reporting obligation exists), rather
 * than inside `invoice-actions.ts`'s own `deliver()` closure: a country's obligation is keyed on
 * (seller country, document TYPE) — `reporting/data/*.json`'s own `appliesTo` — never on which
 * transport happened to carry the invoice.
 *
 * ## "Never silent" — see `report-job.ts`'s own header for the full failure vocabulary
 *
 * This function itself NEVER throws (mirrors `archiveDeliveredArtifactsIfAny`'s own guarantee) — it
 * only ever ENQUEUES a job; the job itself is what can fail, and it fails LOUD (see
 * `reporting-runner.ts`): `report:blocked` for missing credentials, `report:failed` once every retry
 * is exhausted, both journaled onto the EXISTING `DocumentAuthorityEvent` timeline, never onto
 * `DocumentInstance.lastActionError` (a reporting failure is not a "the send action itself failed"
 * fact — the invoice genuinely left; see `report-job.ts`'s own header on `REPORT_FAILED_STATUS_CODE`).
 *
 * That vocabulary would have a GAP if `enqueueReport` ITSELF threw (a Redis hiccup at the exact moment
 * of enqueueing — rare, but `DocumentQueueModule` requiring Redis at boot does not make it impossible
 * mid-flight): with no job ever created, there would be nothing for `reporting-runner.ts` to fail or
 * retry, and the "Declarations" screen (`list-declarations.ts`, which reads ONLY
 * `DocumentAuthorityEvent`) would show nothing at all — not even a failure, since none was ever
 * journaled. So once an `obligation` is known (this function already resolved country + obligation by
 * that point — see below), an `enqueueReport` failure journals `REPORT_FAILED_STATUS_CODE` itself,
 * reusing the EXACT vocabulary `reporting-runner.ts#recordTerminalFailure` uses for "every retry
 * exhausted" — from the Declarations screen's own point of view, "never got a chance to run" and "ran
 * and exhausted every retry" are the SAME fact (this declaration will never happen on its own, someone
 * must act), so they share the same status code rather than inventing a third one nothing downstream
 * recognizes.
 *
 * ## A country with no AUTO-TRIGGERABLE obligation — "NOTHING changes"
 *
 * A country with no `reporting/data/*.json` file at all (every country except FR and PT today) has
 * no fact, so this function returns immediately, having enqueued nothing: the pre-existing "send"
 * behaviour for every type and every seller without an obligation. A fact that is
 * `dischargedBy: 'transport'` (the PDP already carries the data) or whose `scope`/`applicability`
 * does not cover the operation is classified `out` and enqueues nothing either.
 */
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { defaultReportingObligationCatalogV2, ReportingObligationCatalogV2 } from './obligation-catalog';
import { reportOnDocumentEvent } from './on-document-event';

export interface ReportOnSendInput {
  companyId: string;
  typeId: string;
  documentId: string;
  queueDispatcher: DocumentActionQueueDispatcher;
}

/**
 * Called from `actions/async-send.ts`, unconditionally, for EVERY type/transport, right after the
 * archive call. NEVER throws. The resolution, classification and journaling live in
 * `on-document-event.ts` (issue #768), shared with the "validate" and "record-payment" hooks; a send
 * fires both the `sent` and the `issued` obligations.
 */
export async function reportOnSendIfObligated(
  input: ReportOnSendInput,
  catalog: ReportingObligationCatalogV2 = defaultReportingObligationCatalogV2,
): Promise<void> {
  await reportOnDocumentEvent({ event: 'sent', ...input }, catalog);
}
