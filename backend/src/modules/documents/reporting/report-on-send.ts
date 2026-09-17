/**
 * The hook point of declarative reporting onto `actions/async-send.ts`'s own "sent" write —
 * called right after `archiveDeliveredArtifactsIfAny` (never before it, and never before "sent" is
 * persisted): the SAME "after the fact is settled, never before" principle that file's own header
 * documents at length, applied to a genuinely DIFFERENT concept.
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
 * `ReportingObligationCatalog.obligationFor` returns `undefined` for a country with no
 * `reporting/data/*.json` file at all (every country except FR and PT today) — this function
 * returns immediately, having enqueued nothing, exactly the pre-existing "send" behaviour for every
 * type and every seller without an obligation. It ALSO returns `undefined` for France specifically,
 * despite `reporting/data/fr.json` existing: every FR fact is either `dischargedBy: 'transport'`
 * (nothing for this trigger to do — the PDP already carries the data) or `scope`-restricted (no
 * per-invoice B2B/B2C classifier exists yet to safely auto-fire on) — see `obligationFor`'s own
 * header in `registry.ts` for the full reasoning. Portugal remains the one country this function
 * still actually enqueues a job for.
 */
import { logger } from '@/logger/logger.service';

import { journalSyntheticEvent } from '../conformity/authority-events.persistence';
import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { REPORT_FAILED_STATUS_CODE } from './report-job';
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

  let obligation: ReturnType<ReportingObligationCatalog['obligationFor']>;
  try {
    const countryCode = await resolveCompanyCountryCode(companyId);
    if (!countryCode) return;
    obligation = catalog.obligationFor(countryCode, typeId);
  } catch (error) {
    // Resolving WHETHER an obligation even exists failed — before this function ever learns a
    // `providerId` to journal a lost declaration against, so (unlike the enqueue failure below) there
    // is nothing yet worth recording on the document's own timeline; NEVER propagate either way (this
    // file's own header).
    logger.error('Failed to resolve a reporting obligation after a successful send', {
      category: 'documents',
      details: {
        companyId,
        typeId,
        documentId,
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return;
  }
  if (!obligation) return; // "a country with no obligation: NOTHING changes" — the governing rule.

  try {
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
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to enqueue a declarative report after a successful send', {
      category: 'documents',
      details: { companyId, typeId, documentId, providerId: obligation.providerId, message },
    });

    // "Never silent" (this file's own header, updated) — journaled with the obligation's OWN
    // `providerId` (never a made-up one): `list-declarations.ts` only surfaces events whose
    // `providerId` a country's `reporting/data/*.json` file actually names, so journaling under
    // anything else would make this failure invisible on the exact screen it exists to inform.
    try {
      const journaled = await journalSyntheticEvent(
        companyId,
        documentId,
        obligation.providerId,
        REPORT_FAILED_STATUS_CODE,
        `Could not enqueue the declaration job: ${message}`,
      );
      if (journaled === 0) {
        // A dedup no-op (`DocumentAuthorityEvent`'s own `@@unique`) — some EARLIER attempt for this
        // exact document already journaled this same terminal code; nothing new to say.
        logger.info(
          `report:failed for document ${documentId} ("${obligation.providerId}") was already ` +
            'journaled by an earlier attempt — this enqueue failure adds no new row.',
          { category: 'documents' },
        );
      }
    } catch (journalError) {
      // BELT AND SUSPENDERS — the same posture `conformity-sweep-runner.ts#runPoll`'s own compensating
      // 'poll:blocked' write and `reporting-runner.ts#recordTerminalFailure` both hold: never trust
      // the FALLBACK write itself not to fail either, and never let it crash this function.
      logger.error(
        `Could not even journal report:failed for document ${documentId} ("${obligation.providerId}") ` +
          'after an enqueue failure',
        {
          category: 'documents',
          details: {
            companyId,
            typeId,
            documentId,
            providerId: obligation.providerId,
            originalMessage: message,
            journalMessage: journalError instanceof Error ? journalError.message : String(journalError),
          },
        },
      );
    }
  }
}
