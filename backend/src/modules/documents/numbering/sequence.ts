/**
 * The per-(company, type) NUMBER SEQUENCE — the only code in this branch allowed to write to
 * `DocumentNumberSequence` or to set `DocumentInstance.number`/`displayNumber`.
 *
 * ## Atomicity — the choice, and why
 *
 * The task this module was built for offered two options: a `$transaction` at `Serializable`
 * isolation around a locked read-then-increment, or a single `UPDATE ... RETURNING` (or, the same
 * idea, `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`). This picks the second, for a concrete
 * reason: `INSERT ... ON CONFLICT (companyId, typeId) DO UPDATE ... RETURNING` is ALREADY safe under
 * Postgres's default `READ COMMITTED` isolation — the `ON CONFLICT` clause takes a row-level lock on
 * the conflicting unique key exactly like `SELECT ... FOR UPDATE` would, so two concurrent statements
 * targeting the SAME `(companyId, typeId)` are serialized by Postgres itself, never interleaved. A
 * `Serializable` transaction would ALSO be correct, but at the cost of needing an application-level
 * retry loop for the serialization-failure errors Postgres raises under contention at that isolation
 * level — real complexity this counter does not need, since the single-statement upsert already
 * cannot observe a stale value: there is no separate "read" step for another transaction to slip in
 * between.
 *
 * ## "Never waste a number" (⚖ note)
 *
 * A number, once handed out by `bumpSequence`, can never be handed back — the counter only ever
 * moves forward. That makes "never waste one" purely a question of never LETTING `bumpSequence` run
 * unless the write that will actually consume its result also succeeds. `takeDocumentNumber` below
 * is what enforces that: it runs `bumpSequence` and the `DocumentInstance` write inside the SAME
 * Prisma interactive transaction, so if the document write fails for any reason (including the
 * defensive "this document is somehow already numbered" re-check), the WHOLE transaction rolls back
 * — the sequence bump included, as if `bumpSequence` had never run at all. The only way a number is
 * ever durably consumed is a transaction that also, successfully, wrote it onto exactly one
 * previously-unnumbered document.
 *
 * This does NOT promise a legally "gapless" sequence — see `DocumentNumberSequence`'s own schema
 * comment and country-policy/data/fr.json's top-level `notes` for the honest, unverified flag on
 * that separate, legal question.
 */
import { ConflictException } from '@nestjs/common';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import prisma from '@/prisma/prisma.service';

import { DocumentInstanceResult } from '../actions/action-registry';
import { formatDocumentNumber } from './format-number';

type SequenceClient = Prisma.TransactionClient | typeof prisma;

/**
 * Atomically advances the `(companyId, typeId)` counter and returns the number it just handed out —
 * see this file's header for why a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` is safe
 * without an outer `Serializable` transaction. `nextNumber` is stored as "the number this sequence
 * will hand out NEXT": inserting `2` on first use and returning `2 - 1 = 1` keeps that meaning true
 * even for the very first call (there is no row to update yet), and every later call increments the
 * stored value by exactly one, in the same statement it reads it from.
 *
 * `client` is deliberately whatever Prisma client the caller passes in — the bare singleton for a
 * one-off read, or a `Prisma.TransactionClient` when this must share a transaction with another
 * write (see `takeDocumentNumber` below, the ONLY real caller): this function has no opinion of its
 * own about whether it is inside a transaction, which is what lets `takeDocumentNumber` compose it
 * with the document write atomically.
 */
export async function bumpSequence(
  client: SequenceClient,
  companyId: string,
  typeId: string,
): Promise<number> {
  const rows = await client.$queryRaw<{ number: number }[]>`
    INSERT INTO "DocumentNumberSequence" ("companyId", "typeId", "nextNumber")
    VALUES (${companyId}, ${typeId}, 2)
    ON CONFLICT ("companyId", "typeId")
    DO UPDATE SET "nextNumber" = "DocumentNumberSequence"."nextNumber" + 1
    RETURNING "nextNumber" - 1 AS "number"
  `;
  return rows[0].number;
}

/**
 * Issue #496 - the pattern to render with, plus an optional check of the RENDERED number, run inside
 * the numbering transaction right after rendering: a check that throws rolls the whole transaction
 * back, sequence bump included, so a number that would break a country constraint is never issued and
 * never spent (`numbering/company-number-format.ts#assertNumberSatisfies`). A bare string is still
 * accepted, for callers with nothing to check.
 */
export type NumberPattern = string | { pattern: string; check?: (displayNumber: string) => void };

function renderChecked(pattern: NumberPattern, number: number, issuedAt: Date): string {
  const template = typeof pattern === 'string' ? pattern : pattern.pattern;
  const displayNumber = formatDocumentNumber(template, { number, date: issuedAt });
  if (typeof pattern !== 'string') pattern.check?.(displayNumber);
  return displayNumber;
}

export interface TakenDocumentNumber {
  number: number;
  displayNumber: string;
}

/** Thrown, and caught, ONLY inside `takeDocumentNumber` below — never escapes it. Its entire purpose
 *  is to make the transaction callback throw (forcing Prisma to roll back the `bumpSequence` write
 *  alongside it) without that rollback surfacing as a real error to `takeDocumentNumber`'s own
 *  caller, for whom "someone already numbered this document" is not a failure at all — see that
 *  function's own header. */
class AlreadyNumberedError extends Error {}

/**
 * The ONE place a document actually receives its number. Bumps the sequence AND writes
 * `number`/`displayNumber` onto `documentId` inside a SINGLE Prisma transaction — see this file's
 * header ("never waste a number") for why sharing one transaction, not two sequential calls, is the
 * point: if the `DocumentInstance` write below does not land, the sequence bump is undone with it.
 *
 * Returns `undefined`, having done nothing at all (including no sequence bump — rolled back), if
 * `documentId` already carries a number. This is a DEFENSIVE, database-level re-check of what the
 * only real caller (documents.service.ts's `runAction`, via `numbering/take-number.ts`) already
 * checked in memory before ever calling this: two concurrent requests acting on the very same
 * document could both observe `number: null` before either commits, and this guard — not the
 * in-memory check — is what actually stops the second one from also taking (and, without this,
 * wasting) a number. Scoped by `companyId`/`typeId` too, the same tenant-safety `persistence.ts`'s
 * `findOwnedDocument` already holds for every other single-document write in this module.
 */
export async function takeDocumentNumber(
  companyId: string,
  typeId: string,
  documentId: string,
  pattern: NumberPattern,
  issuedAt: Date = new Date(),
): Promise<TakenDocumentNumber | undefined> {
  try {
    return await prisma.$transaction(async (tx) => {
      const number = await bumpSequence(tx, companyId, typeId);
      const displayNumber = renderChecked(pattern, number, issuedAt);

      const written = await tx.documentInstance.updateMany({
        where: { id: documentId, companyId, typeId, number: null },
        data: { number, displayNumber },
      });
      if (written.count === 0) {
        throw new AlreadyNumberedError(documentId);
      }

      return { number, displayNumber };
    });
  } catch (error) {
    if (error instanceof AlreadyNumberedError) return undefined;
    throw error;
  }
}

/**
 * Followup to issue #471 (PR #473, review point 1): a credit note (or any other numbered type) could
 * reach "sending" numberless and STAY that way forever, because `actions/async-send.ts` used to write
 * "sending" first, publish an SSE event second, and only THEN - a third, separate statement - take
 * the number. Anything throwing between the first write and the third (a DB hiccup on the publish, an
 * invalid stored number-format pattern `resolveNumberFormat` rejects, the SSE bus itself) left the
 * record durably "sending" with `number: null`, and `numbering.onlyFrom: ['draft']`
 * (credit-note.descriptor.ts) then refused a number on every later retry, because the record's
 * PREVIOUS status is never "draft" again - the exact permanently-unnumbered outcome issue #471 exists
 * to prevent, just moved one call later.
 *
 * The fix: fold the "draft"/"send_failed" -> "sending" status write and the numbering write into ONE
 * Prisma transaction, the same "never waste a number, never half-do a numbering" discipline
 * `takeDocumentNumber` above already holds for its own two writes. Either both land - the record
 * leaves its old status ALREADY carrying its number, nothing else in this file's own call chain can
 * observe it any other way - or neither does, and the record stays exactly where it was ("draft" or
 * "send_failed"), free to retry. `events.publish` (the SSE nudge) and the queue enqueue that
 * `async-send.ts` still runs AFTER this call can now throw all they like: the number is already a
 * committed fact by the time either of them ever executes, so a failure there can strand a "sending"
 * record without DELIVERING it, but never without NUMBERING it - the specific, legally-relevant gap
 * this function closes. See `actions/async-send.ts`'s own call site for the belt-and-braces guard
 * this pairs with: a type that declares no `numbering.onlyFrom` (quote, invoice) must NEVER show a
 * null number on a "sending" record at all once this function is the only way it gets there, so
 * phase 2 refuses to deliver one that somehow does rather than trust it silently.
 *
 * `fromStatuses`/`toStatus` mirror `persistence.ts#upsertDocument`'s own compare-and-swap - this
 * function does not call that one (it needs its OWN transaction, and `upsertDocument` opens none), so
 * it re-implements the identical conditional `updateMany` here rather than share a helper across two
 * modules that otherwise have no reason to depend on each other.
 *
 * PR #473 review point 2 (round 2): the caller's own "is this record eligible for numbering at all"
 * check (`async-send.ts`'s `eligibleForAtomicNumbering`) reads `existing.number == null` from a
 * SNAPSHOT taken BEFORE this transaction ever starts - a `findOwnedDocument` read that can go stale
 * the instant another request wins the race first. Two "send" calls on the SAME "send_failed" draft
 * (a double click, two tabs) can both observe `number: null` in memory: the loser's transaction below
 * still passes the `status: { in: fromStatuses } }` guard (its `where` never checked `number` at all -
 * "send_failed" is itself one of the ALLOWED `fromStatuses`, precisely to let a genuine retry through),
 * then used to bump the sequence and overwrite `number`/`displayNumber` unconditionally - RENUMBERING
 * a document the winner had already numbered and delivered, opening a gap in a series that must stay
 * continuous, and re-running `onNumbered` (ATCUD) a second time on a number that changed under it.
 *
 * The guard restored here does NOT re-check `number: null` on the status `updateMany` itself - unlike
 * `takeDocumentNumber` above, the status move must still land even for a legitimate "send_failed
 * retry of an already-numbered record" (the very case `async-send.spec.ts`'s "never re-numbers a
 * record that already carries one" test protects, at the ORCHESTRATION layer - in-memory
 * `eligibleForAtomicNumbering` skips this whole function for that case, calling `upsertDocument`
 * instead; this function's own guard is what protects the DATABASE layer against the caller's snapshot
 * being stale, a race no in-memory check can ever close). Instead: the status `updateMany` runs
 * first (unconditionally on status, taking Postgres's own row-level lock on this document for the rest
 * of the transaction - no other transaction can concurrently touch this row until this one commits or
 * rolls back), and ONLY THEN does this function read the row's CURRENT `number` back, under that same
 * lock. If it is already non-null - a concurrent winner beat this transaction to the sequence bump
 * (or, more directly, an in-memory `eligibleForAtomicNumbering` computed against a stale read) - the
 * status move is kept (a legitimate retry must still proceed to "sending") but the sequence is NEVER
 * bumped and `number`/`displayNumber` are NEVER overwritten: `numbered` comes back `undefined`, which
 * is exactly the "no number was taken on THIS call" signal `async-send.ts` already reads (via the
 * shared `if (numbered) { ... }` guard) to skip the stock effect and `onNumbered` (ATCUD) for a race's
 * loser - see that call site's own comment. This is the "keep the number, skip the bump" choice named
 * in this function's own module header rather than a 409: refusing the whole "sending" transition here
 * would leave a legitimately re-tried "send_failed" record permanently stuck outside "sending", the
 * one outcome issue #471 itself exists to prevent.
 */
export async function takeDocumentNumberWithStatusTransition(
  companyId: string,
  typeId: string,
  documentId: string,
  fromStatuses: string[],
  toStatus: string,
  data: Record<string, unknown>,
  pattern: NumberPattern,
  issuedAt: Date = new Date(),
): Promise<{ document: DocumentInstanceResult; numbered: TakenDocumentNumber | undefined }> {
  const jsonData = data as Prisma.InputJsonValue;

  return prisma.$transaction(async (tx) => {
    const written = await tx.documentInstance.updateMany({
      where: { id: documentId, companyId, typeId, status: { in: fromStatuses } },
      data: { status: toStatus, data: jsonData, lastActionError: null },
    });
    if (written.count === 0) {
      // Same named refusal `upsertDocument` itself throws for the identical race (a concurrent caller
      // already moved the record on) - a caller of THIS function replaces its own `upsertDocument`
      // call with this one, so it must fail exactly the same way for the same condition.
      throw new ConflictException(
        `Document "${documentId}" is no longer in one of the expected statuses ` +
          `(${fromStatuses.join(', ')}) - another request already changed it concurrently.`,
      );
    }

    // THE RE-CHECK, under the row lock the `updateMany` above already holds (see this function's own
    // header) - never trust the caller's own pre-transaction snapshot for whether a number is still
    // needed; ask the database again, now that nothing else can be mutating this exact row.
    const current = await tx.documentInstance.findUniqueOrThrow({
      where: { id: documentId },
      select: { number: true },
    });
    if (current.number != null) {
      const document = await tx.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
      return { document, numbered: undefined };
    }

    const number = await bumpSequence(tx, companyId, typeId);
    const displayNumber = renderChecked(pattern, number, issuedAt);

    const document = await tx.documentInstance.update({
      where: { id: documentId },
      data: { number, displayNumber },
    });

    return { document, numbered: { number, displayNumber } };
  });
}
