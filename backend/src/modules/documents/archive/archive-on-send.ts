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
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { ArchivedArtifactInput } from './hashing';
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

  try {
    await createDocumentArchive({ companyId, documentId, artifacts });
    // Clears a PREVIOUS archiving failure — a re-send that archives successfully this time no longer
    // needs to keep the trace of the earlier attempt's failure next to a document that is now
    // actually preserved.
    await prisma.documentInstance.update({ where: { id: documentId }, data: { lastArchiveError: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Document archiving failed after a successful delivery', {
      category: 'documents',
      details: { companyId, documentId, message },
    });
    try {
      await prisma.documentInstance.update({
        where: { id: documentId },
        data: { lastArchiveError: message },
      });
    } catch (writeError) {
      // If EVEN this compensating write fails (database unavailable…), the failure is already logged
      // at error level above — the delivery itself has already genuinely succeeded and must stay
      // that way: nothing here may ever propagate up to `async-send.ts`.
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
}
