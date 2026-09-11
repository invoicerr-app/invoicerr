/**
 * The point of accroche of VERDICT archiving on the conformity poller — decided
 * 2026-09-06 ("le poller de conformité PDP/KSeF n'archive PAS le VERDICT, seulement
 * le DÉPÔT"; see `DocumentArchive`'s own schema comment and `verdict-artifact.ts`'s header for the
 * content itself). `conformity/conformity-sweep-runner.ts#runPoll` calls
 * `archiveTerminalAuthorityVerdictIfAny` for every event a poll observed that its own poller
 * classifies `isTerminal` — never for an intermediate one (PDP's fr:200/fr:201, any KSeF non-terminal
 * code): a PENDING status is not yet a verdict, there is nothing probative to archive about it.
 *
 * ## The exact same "never propagate" guarantee `archive-on-send.ts` already holds, and why
 *
 * `runPoll`'s own header states this codebase's rule plainly: "un handler d'événement ne tue jamais
 * le processus". By the time this function runs, `createAuthorityEvents` has ALREADY durably
 * journaled the verdict in `DocumentAuthorityEvent` — that operational fact is real and must stay
 * real regardless of what happens next. Archiving it a SECOND time, probatively, is an ADDITION (see
 * `DocumentArchive`'s own schema comment: "elle s'y AJOUTE, elle ne le remplace pas") — a failure
 * here must never retract, or even appear to threaten, the journal entry that already landed. This
 * function therefore follows `archiveDeliveredArtifactsIfAny`'s own pattern exactly: it never throws,
 * it logs loud (`logger.error`, category 'documents') on genuine failure, and the caller wraps
 * nothing of its own around it.
 *
 * ## Why `'duplicate'` and `'no-deposit-archive'` are treated differently
 *
 * `createAuthorityVerdictArchive`'s own two failure-shaped outcomes are NOT symmetric:
 *  - `'duplicate'` is the ordinary, expected steady state for every poll after the first one that
 *    observed a given terminal status (`verdictKey`'s own dedup) — logging this as an error on every
 *    subsequent poll would be pure noise, so it isn't logged at all.
 *  - `'no-deposit-archive'` means the deposit itself was never successfully archived (a real,
 *    if rare, prior failure — see `archive-on-send.ts`'s own `lastArchiveError`) — this IS worth a
 *    loud log: a verdict genuinely could not be linked to anything, and nothing else in this codebase
 *    would otherwise surface that fact.
 */
import { logger } from '@/logger/logger.service';

import { createAuthorityVerdictArchive, TerminalVerdictInput } from './persistence';

/**
 * Archives one terminal authority verdict — NEVER throws. Returns nothing: the caller
 * (`conformity-sweep-runner.ts#runPoll`) already returns `{ journaled }` from the operational journal
 * write that happened first: this function's own success or failure is deliberately invisible to
 * that return value, the same way a deposit's own archiving failure never turns `deliver()`'s own
 * successful result into a failure (`archive-on-send.ts`'s own header).
 */
export async function archiveTerminalAuthorityVerdictIfAny(input: TerminalVerdictInput): Promise<void> {
  try {
    const outcome = await createAuthorityVerdictArchive(input);
    if (!outcome.archived && outcome.reason === 'no-deposit-archive') {
      logger.error(
        'Cannot archive an authority verdict: this document has no deposit archive to link it to',
        {
          category: 'documents',
          details: {
            companyId: input.companyId,
            documentId: input.documentId,
            providerId: input.providerId,
            statusCode: input.statusCode,
          },
        },
      );
    }
    // `outcome.reason === 'duplicate'` is the expected steady state — see this file's own header.
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Archiving a terminal authority verdict failed', {
      category: 'documents',
      details: {
        companyId: input.companyId,
        documentId: input.documentId,
        providerId: input.providerId,
        statusCode: input.statusCode,
        message,
      },
    });
  }
}
