/**
 * The attachment point of legal archiving on the async send — `actions/async-send.ts`'s phase-2
 * (`deliver()` already succeeded, the document already written "sent") calls
 * `archiveDeliveredArtifactsIfAny` right after that write, never before: archiving something that has
 * not been delivered yet would be a lie (an archive claiming to preserve a send that could still
 * fail).
 *
 * ## The guarantee this function holds: it NEVER PROPAGATES AN EXCEPTION
 *
 * "An archiving failure must NOT cancel a send that has already been delivered" — by the time this
 * function is called, the email has already gone out / the deposit has already been accepted, that is
 * an ESTABLISHED FACT, and nothing here may call it back into question. `async-send.ts` therefore
 * calls this AFTER persisting "sent" and without wrapping it in a try/catch of its own — it is THIS
 * function that absorbs everything, down to the failure of its OWN compensating write
 * (`lastArchiveError`).
 *
 * ## "Never silent": `lastArchiveError`, not `lastActionError`
 *
 * See `schema.prisma`'s own comment on `DocumentInstance.lastArchiveError` for the full reasoning. In
 * short: `lastActionError` is reset to null by EVERY ordinary write (`persistence.ts#upsertDocument`)
 * and means "the DECLARED action failed" — a send that was archived unsuccessfully is NOT a send that
 * failed (it succeeded; it is its PRESERVATION that has a problem). A dedicated field, never touched
 * elsewhere, is therefore the only honest way to make this fact queryable without confusing it with
 * an action's failure or letting it disappear on the next "save-draft".
 *
 * ## "Never propagates" is not "never tried again" — the artifacts are KEPT
 *
 * The guarantee above says what this function may not do to the send. It says nothing about giving
 * up, and for a long time it silently did: a failure here was recorded and that was the end of it.
 * Nothing retried — the send job's own BullMQ retry structurally cannot reach this step (a replayed
 * "send" resumes on `deliveryConfirmedAt` and passes `artifacts: undefined`), and "send" is not
 * available from "sent" either — so a document delivered during a ten-minute storage outage stayed
 * unarchived for the six to ten years its country requires it kept (⚖ `retention/`), with a log line
 * and an unread column as the only witnesses.
 *
 * So the failure path now also JOURNALS THE ARTIFACTS (`pending-archive.ts`), which is the only way
 * a retry can exist at all: these bytes are what was actually delivered, they exist exactly once —
 * here, in memory — and no code path re-derives them afterwards. `archive-retry-sweep-runner.ts`
 * drains that journal, and its own header carries the schedule, the escalation and why a row is
 * never abandoned. Journaling is inside the same try/catch as everything else: failing to journal is
 * one more thing that may not reach `async-send.ts`.
 *
 * Once a retry genuinely exists, the LEVEL of what this function logs has to move with it: a failure
 * that is about to be retried automatically is a WARN here, and ERROR is kept for the two shapes that
 * really need a human — artifacts that could not even be journaled (nothing will retry) and, later,
 * retries that have run out of transient explanations (`archive-retry-sweep-runner.ts`). See the
 * `journaled` branch below.
 */
import { logger } from '@/logger/logger.service';
import { runWithCompanyId } from '@/lib/request-context';
import prisma from '@/prisma/prisma.service';

import { ArchivedArtifactInput } from './hashing';
import { clearPendingArchive, journalFailedArchive } from './pending-archive';
import { createDocumentArchive } from './persistence';

export interface ArchiveDeliveredArtifactsInput {
  companyId: string;
  documentId: string;
  /** What `deliver()` actually delivered — see `transports/transport-registry.ts`'s
   *  `DocumentTransportResult.artifacts`'s own header. Absent, or empty, for a delivery that produced
   *  NO archivable artifact at all (the credit-note's "send", `credit-note-actions.ts` — a plain
   *  status transition, with no transport and no email): nothing to archive is not a failure, it is
   *  simply nothing to do. */
  artifacts: ArchivedArtifactInput[] | undefined;
}

/**
 * Never throws — see this file's own header. Called from `actions/async-send.ts` right after the
 * "sent" write, unconditionally for every type/transport (generic, like the rest of `async-send.ts`
 * — nothing here names "invoice" or "pdp").
 */
export async function archiveDeliveredArtifactsIfAny(input: ArchiveDeliveredArtifactsInput): Promise<void> {
  const { companyId, documentId, artifacts } = input;
  if (!artifacts || artifacts.length === 0) return;

  // Wrapped in `runWithCompanyId` — this runs from `async-send.ts`, itself reached either in-request
  // (already scoped) or from `document-action.processor.ts`'s worker (no request of its own to carry
  // one) — self-scoping here means this function's own `Log` writes are correct regardless of which.
  return runWithCompanyId(companyId, async () => {
    // Distinguishes "archiving itself failed" from "archiving succeeded and the bookkeeping after it
    // failed" inside the single catch below. Without it, a `lastArchiveError`-clearing write that
    // throws would send an ALREADY ARCHIVED document's artifacts to the retry journal, and the next
    // sweep pass would dutifully archive them a second time.
    let archived = false;
    try {
      await createDocumentArchive({ companyId, documentId, artifacts });
      archived = true;
      // Whatever this document still owed the archive is paid: drop the journal row (a no-op for the
      // ordinary first-attempt success, which never journaled anything) BEFORE clearing the error, so
      // a failure of the write just below can never leave work queued for a document that is
      // preserved.
      await clearPendingArchive(documentId);
      // Clears a PREVIOUS archiving failure — a re-send that archives successfully this time no longer
      // needs to keep the trace of the earlier attempt's failure next to a document that is now
      // actually preserved.
      await prisma.documentInstance.update({ where: { id: documentId }, data: { lastArchiveError: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (archived) {
        // The archive EXISTS; only the tidying after it did not. Never journal here — see the
        // `archived` flag's own comment above — and never leave a stale `lastArchiveError` unnoticed:
        // this log line is the trace, and the next successful send (or retry pass) clears the column.
        logger.error('Document archived, but the bookkeeping right after it failed', {
          category: 'documents',
          details: { companyId, documentId, message },
        });
        return;
      }
      // THE RETRY'S ONLY CHANCE — see this file's own header. Attempted BEFORE the document's own
      // column so that, if only one of the two writes survives a failing database, it is the one
      // holding the bytes: `lastArchiveError` says a gap exists, the journal is what can still
      // close it.
      let journaled = false;
      try {
        await journalFailedArchive({ companyId, documentId, artifacts, error: message });
        journaled = true;
      } catch (journalError) {
        logger.error(
          'Document archiving failed AND its artifacts could not be journaled — nothing will retry',
          {
            category: 'documents',
            details: {
              companyId,
              documentId,
              message,
              journalError: journalError instanceof Error ? journalError.message : String(journalError),
            },
          },
        );
      }

      if (journaled) {
        // WARN, not ERROR, and the gradation is the whole point. At this instant the failure is
        // indistinguishable from a bucket answering 503 for ten minutes, and it now has a retry
        // schedule of its own (`archive-retry-sweep.ts`) that will most often close it with nobody
        // ever looking. Raising an alert here for something the system is about to fix is how people
        // learn to stop reading alerts; ERROR is reserved for the two cases that genuinely need a
        // human — no retry is possible at all (just above), or the retries have run and the document
        // is still unarchived (`archive-retry-sweep-runner.ts`'s own escalation). The row is
        // persisted either way, and the document carries the error below.
        logger.warn('Document archiving failed after a successful delivery — artifacts kept for retry', {
          category: 'documents',
          details: { companyId, documentId, message },
        });
      }

      try {
        await prisma.documentInstance.update({
          where: { id: documentId },
          data: { lastArchiveError: message },
        });
      } catch (writeError) {
        // If EVEN this compensating write fails (database unavailable…), the failure is already logged
        // above — the delivery itself has already genuinely succeeded and must stay that way: nothing
        // here may ever propagate up to `async-send.ts`.
        logger.error('Could not even record the archiving failure on the document itself', {
          category: 'documents',
          details: {
            companyId,
            documentId,
            message: writeError instanceof Error ? writeError.message : String(writeError),
          },
        });
      }
    }
  });
}
