import { BadRequestException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';

import { createManualAcceptanceArchive, ManualAcceptanceManifest } from '../archive/persistence';
import { findOwnedDocument, updateDocumentStatus } from '../persistence';
import { computeQuoteOptionTotals, deriveQuoteOptions, resolveChosenOption } from '../options/quote-options';
import { ActionRegistry } from './action-registry';

/**
 * Issue #421: "accept a quote manually, without the e-signature code". The one accepted, sourced fact
 * this whole feature exists to make impossible to lose: an ISSUER records that a client accepted a
 * sent quote by some OTHER means (a phone call, a reply email, a signed paper scan) - never through
 * the hardened OTP flow (`signatures/signatures.service.ts#markSigned`), which stays entirely
 * untouched by this file.
 *
 * ## Why "accepted" is its own status, never "signed"
 *
 * The whole point of this feature, stated plainly in the issue itself, is that a manual acceptance
 * must NEVER be mistaken for an electronic signature - not in the lifecycle, not in the history, not
 * in the legal archive. Writing "signed" here would make every one of those three lies. "accepted"
 * (quote.descriptor.ts) is a DISTINCT, `clientVisible` status with its own `sent -> accepted`
 * transition, so `checkTransitionResult` (descriptors/lifecycle.ts) would catch this handler on the
 * spot if it ever tried to persist "signed" instead - see this feature's own break-and-restore test.
 *
 * ## What this handler does NOT do
 *
 * It never touches `data` - a pure status write (`updateDocumentStatus`, the exact same "data was
 * already correct, only the status moves" reasoning `signatures.service.ts#markSigned` already holds
 * for e-signing). Keeping the acceptance record OUT of `data` is deliberate: `data` is what the
 * document FORM resubmits on every ordinary "save-draft" (`from: 'always'`, quote.descriptor.ts's own
 * header) - had the note/actor/timestamp lived there, the next unrelated edit-and-save would have
 * silently overwritten it the moment the form round-tripped a `data` object that never knew the key
 * existed. The audit `Log` row and the `DocumentArchive` row below are both WRITE-ONCE, append-only
 * records that no later "save-draft" can ever touch - the only kind of storage this fact deserves.
 *
 * ## The three records ONE call produces
 *
 *  1. The status write itself, compare-and-swap FROM "sent" only (`fromStatuses: ['sent']`) - the
 *     same race-safety `documents/persistence.ts#updateDocumentStatus`'s own header documents for
 *     every other conditional write in this module; a concurrent second call (a double click, a
 *     second tab) loses with a named 409 rather than silently re-recording the same fact twice.
 *  2. An `Log` row (`logger.info`, category "documents") - the AUDIT TRAIL: who, when, what note,
 *     found the same way `grep audit` finds every other audit-adjacent write in this codebase.
 *  3. A `DocumentArchive` row of `kind: ACCEPTANCE` (`archive/persistence.ts#
 *     createManualAcceptanceArchive`) - the LEGAL record: this file's own header states at length why
 *     a THIRD kind was necessary, not merely tidier, and why it can never be confused with a real
 *     DELIVERY or an authority VERDICT. Archiving is best-effort here, deliberately: a preservation
 *     failure must never block the human-facing act of recording an acceptance that genuinely
 *     happened (the exact same "never propagate" discipline `archive/archive-on-send.ts`'s own header
 *     holds for a delivery's own archiving) - logged loudly, never thrown.
 */
const MAX_NOTE_LENGTH = 2000;

export function registerAcceptManuallyAction(registry: ActionRegistry): void {
  registry.register('quote', 'accept-manually', async (ctx) => {
    if (!ctx.documentId) {
      // Unreachable in practice - `availableWhen` already refuses a never-saved record (no status to
      // match "sent") before this handler ever runs - but a handler never trusts that alone, the same
      // discipline `quote-to-invoice.ts`'s own identical guard documents.
      throw new Error('Cannot mark a quote accepted before it has been saved and sent.');
    }
    // `ctx.actor` is undefined only for a caller this action can never actually have (see
    // ActionContext.actor's own header: the async-send worker's replay, which never runs this action
    // at all) - checked anyway, defensively, rather than trusting that this action will never be
    // reached any other way in the future.
    if (!ctx.actor) {
      throw new Error('Cannot mark a quote accepted manually without an authenticated actor to record.');
    }

    const rawNote = ctx.params.note;
    const note = typeof rawNote === 'string' ? rawNote.trim() : '';
    if (!note) {
      throw new BadRequestException(
        'A note describing how the client accepted is required to mark a quote accepted manually.',
      );
    }
    if (note.length > MAX_NOTE_LENGTH) {
      throw new BadRequestException(`The acceptance note must be at most ${MAX_NOTE_LENGTH} characters.`);
    }

    // Issue #373 ("quotes with options") - a quote offering 2+ options must NAME which one was
    // accepted, refused otherwise with a clear message; a quote with fewer than two needs no such
    // param at all (`resolveChosenOption` returns undefined for it - see that function's own header).
    // Read from the QUOTE's own current `data`, never from `ctx.data` (the request body's copy the
    // frontend happens to send alongside - this handler, like the OTP path, treats `data` as
    // authoritative only when it comes from the persisted row itself, the same "never trust the
    // client's own echo of the document" posture `markSigned` already holds).
    const current = await findOwnedDocument(ctx.companyId, 'quote', ctx.documentId);
    const currentData = (current.data ?? {}) as Record<string, unknown>;
    const options = deriveQuoteOptions(currentData);
    const chosenOption = resolveChosenOption(options, ctx.params.option);

    // The compare-and-swap IS the 409 for "already accepted"/"already signed"/"draft"/"refused" -
    // `runAction`'s own `isActionAvailable` gate already refuses every status but "sent" before this
    // handler is even reached (a 409 naming the CURRENT status), and this second, atomic check closes
    // the race the first one cannot: two concurrent calls both reading "sent" before either writes -
    // including a concurrent OTP signature racing this very call (`signatures.service.ts#markSigned`
    // passes the SAME `fromStatuses: ['sent']`, the fix for the loser-overwrites-the-winner bug this
    // pair of calls used to have). `knownUpdatedAt: current.updatedAt` closes the other half of that
    // race: a quote edited (options renamed/removed) between the read of `options` just above and
    // this write stays "sent" but its `updatedAt` moves, so this CAS still refuses rather than
    // accepting a `chosenOption` validated against options that no longer exist. `chosenOption`
    // travels on the SAME write as the status change - see `updateDocumentStatus`'s own header on why
    // this must never be a second, separate write.
    const updated = await updateDocumentStatus(
      ctx.companyId,
      'quote',
      ctx.documentId,
      'accepted',
      null,
      undefined,
      undefined,
      ['sent'],
      chosenOption,
      current.updatedAt,
    );

    const acceptedAt = new Date();
    // The frozen option snapshot (name, lines, total) - see `ManualAcceptanceManifest.option`'s own
    // header on why the ARCHIVE carries a copy rather than merely pointing at `chosenOption`.
    const optionSnapshot = chosenOption
      ? (() => {
          const perOption = computeQuoteOptionTotals(currentData) ?? [];
          const match = perOption.find((entry) => entry.option === chosenOption);
          // Unreachable in practice - `chosenOption` was just proven to be one of `options`, which is
          // exactly what `computeQuoteOptionTotals` groups by - but a handler never trusts its own
          // precondition alone, the same discipline this whole module holds throughout.
          if (!match) {
            throw new Error(`Chosen option "${chosenOption}" could not be matched back to its own totals.`);
          }
          return {
            name: chosenOption,
            lines: match.lines,
            netMinor: match.totals.netMinor,
            vatMinor: match.totals.vatMinor,
            grossMinor: match.totals.grossMinor,
            currency: match.totals.currency,
          };
        })()
      : undefined;
    const manifest: ManualAcceptanceManifest = {
      kind: 'manual-acceptance',
      documentId: ctx.documentId,
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorEmail: ctx.actor.email,
      note,
      acceptedAt: acceptedAt.toISOString(),
      ...(optionSnapshot ? { option: optionSnapshot } : {}),
    };

    // The AUDIT TRAIL - see this file's own header, point 2. Awaited (unlike the archive write right
    // below): a lost audit row is a silent gap in "who did this, and when", never something to risk
    // for a client that isn't waiting on it any longer than the archive write already takes; `logger`
    // itself never throws even on a DB failure (`logger.service.ts`'s own header), so this can never
    // fail the action either.
    await logger.info('Quote marked as accepted manually (not an electronic signature)', {
      category: 'documents',
      userId: ctx.actor.id,
      details: {
        typeId: 'quote',
        documentId: ctx.documentId,
        method: 'manual',
        actorName: ctx.actor.name,
        actorEmail: ctx.actor.email,
        note,
        ...(chosenOption ? { chosenOption } : {}),
      },
    });

    // The LEGAL ARCHIVE - see this file's own header, point 3: best-effort, never blocks this action's
    // own success.
    try {
      await createManualAcceptanceArchive({
        companyId: ctx.companyId,
        documentId: ctx.documentId,
        manifest: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      });
    } catch (error) {
      logger.error('Failed to archive a manual quote acceptance - the acceptance itself still stands', {
        category: 'documents',
        userId: ctx.actor.id,
        details: {
          typeId: 'quote',
          documentId: ctx.documentId,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }

    return {
      document: updated,
      changed: true,
      message: chosenOption
        ? `Quote marked as accepted manually, option "${chosenOption}": "${note}".`
        : `Quote marked as accepted manually: "${note}".`,
    };
  });
}

// Re-exported so this feature's own unit/archive tests can build a manifest by hand without
// re-deriving the shape from the handler's own closure - same convention
// `contributions/quote-contributions.ts`'s own bottom export follows for `quoteGrossTotal`.
export { MAX_NOTE_LENGTH };
