import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';

import { MAX_ATTACHMENT_BYTES } from '../attachments/attachments.service';
import { computeArtifactHash } from '../archive/hashing';
import {
  createManualAcceptanceArchive,
  findCurrentDeliveredVersion,
  ManualAcceptanceAttachmentMeta,
  ManualAcceptanceManifest,
} from '../archive/persistence';
import { readInboundFile } from '../received-invoices/storage';
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
 *  2. An `Log` row (`logger.audit`, category "documents") - the AUDIT TRAIL: who, when, what note,
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

/**
 * Issue #364 - what a proof of acceptance may be: a scan or a photo of the signed paper. Narrower than
 * `ALLOWED_ATTACHMENT_MIMES`, which also admits XML for imported originals.
 */
const ACCEPTANCE_ATTACHMENT_MIMES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const MAX_ATTACHMENT_FILE_NAME_LENGTH = 255;
const SHA256_HEX = /^[0-9a-f]{64}$/;

interface ResolvedAttachment {
  meta: ManualAcceptanceAttachmentMeta;
  bytes: Buffer;
}

/**
 * Issue #364 - re-reads the uploaded file by its reference and re-checks it (mime, size, hash) rather
 * than trusting the reference the frontend echoes back. Runs BEFORE the status write, so a bad file
 * refuses the whole action instead of leaving an accepted quote whose proof was silently dropped.
 */
async function resolveAttachment(companyId: string, raw: unknown): Promise<ResolvedAttachment | undefined> {
  if (raw === undefined || raw === null) return undefined;
  const { fileRef, fileName, mime } = (typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof fileRef !== 'string' || !SHA256_HEX.test(fileRef)) {
    throw new BadRequestException('The attachment must be a file reference returned by the upload endpoint.');
  }
  if (typeof mime !== 'string' || !ACCEPTANCE_ATTACHMENT_MIMES.includes(mime)) {
    throw new BadRequestException(
      `Unsupported attachment type "${String(mime)}" - allowed: ${ACCEPTANCE_ATTACHMENT_MIMES.join(', ')}.`,
    );
  }
  const name = typeof fileName === 'string' ? fileName.trim() : '';
  if (!name || name.length > MAX_ATTACHMENT_FILE_NAME_LENGTH) {
    throw new BadRequestException(
      `The attachment needs a file name of at most ${MAX_ATTACHMENT_FILE_NAME_LENGTH} characters.`,
    );
  }
  const bytes = await readInboundFile(companyId, fileRef, mime);
  if (!bytes) {
    throw new BadRequestException('The attached file was not found for this company - upload it again.');
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new PayloadTooLargeException(
      `The attached file is ${bytes.length} bytes, over the ${MAX_ATTACHMENT_BYTES}-byte limit.`,
    );
  }
  const sha256 = computeArtifactHash(bytes);
  if (sha256 !== fileRef) {
    throw new BadRequestException('The attached file no longer matches its reference - upload it again.');
  }
  return { meta: { fileName: name, mime, byteLength: bytes.length, sha256 }, bytes };
}

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
    const attachment = await resolveAttachment(ctx.companyId, ctx.params.attachment);

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
    const updated = await updateDocumentStatus(ctx.companyId, 'quote', ctx.documentId, 'accepted', {
      fromStatuses: ['sent'],
      acceptedOption: chosenOption,
      knownUpdatedAt: current.updatedAt,
    });

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
      // Issue #477 - which delivered PDF this acceptance refers to. Manual acceptance has no
      // client-facing page and no link that could go stale: the issuer records, for the quote as it
      // stands now, a fact they observed elsewhere, and any edit of a "sent" quote moves it back to
      // "draft", where this action is not available. So nothing is REFUSED here (the #421 rule that
      // a preservation concern never blocks a manual acceptance still holds); the manifest only NAMES
      // the version, or says it could not (`null`).
      deliveredVersion: await findCurrentDeliveredVersion(
        ctx.companyId,
        ctx.documentId,
        current.deliveryConfirmedAt ?? null,
      ),
      ...(attachment ? { attachment: attachment.meta } : {}),
    };

    // The AUDIT TRAIL - see this file's own header, point 2.
    await logger.audit('Quote marked as accepted manually (not an electronic signature)', {
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
        ...(attachment ? { attachment: attachment.meta } : {}),
      },
    });

    // The LEGAL ARCHIVE - see this file's own header, point 3: best-effort, never blocks this action's
    // own success.
    try {
      await createManualAcceptanceArchive({
        companyId: ctx.companyId,
        documentId: ctx.documentId,
        manifest: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
        ...(attachment ? { attachment: { mime: attachment.meta.mime, bytes: attachment.bytes } } : {}),
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
export { ACCEPTANCE_ATTACHMENT_MIMES, MAX_NOTE_LENGTH };
