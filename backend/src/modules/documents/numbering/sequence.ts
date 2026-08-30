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
 * ## "Never waste a number" (this task's ⚖ note)
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
import { Prisma } from '../../../../prisma/generated/prisma/client';
import prisma from '@/prisma/prisma.service';

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
  pattern: string,
  issuedAt: Date = new Date(),
): Promise<TakenDocumentNumber | undefined> {
  try {
    return await prisma.$transaction(async (tx) => {
      const number = await bumpSequence(tx, companyId, typeId);
      const displayNumber = formatDocumentNumber(pattern, { number, date: issuedAt });

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
