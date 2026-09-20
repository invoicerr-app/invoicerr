/**
 * Erasing the BYTES a company owns, in an order a crash cannot turn into silence.
 *
 * ## The problem this file exists for
 *
 * A company owns objects in exactly two stores:
 *  - the legal archive (`archive/storage.ts`) — one directory/key-prefix per archive, addressed as
 *    `<root>/<documentId>/<contentHash>/`. `companyId` appears NOWHERE in that path; the ONLY thing
 *    that ever tied those bytes to a company was the `DocumentArchive.uri` column;
 *  - the inbound store (`received-invoices/storage.ts`) — received-invoice deposits, expense
 *    attachments and branding logos, all three under one `<root>/<companyId>/` prefix.
 *
 * Deleting the `Company` row cascades `DocumentInstance` → `DocumentArchive` away, `uri` with it. Do
 * that without deleting the bytes first and they become permanently unreachable AND unlistable: still
 * present for a subpoena or a breach, gone for the customer who invoked erasure. That is the worst of
 * both outcomes, and it is why this file governs BOTH stores from one place rather than letting each
 * deletion site improvise its own order — an order nobody wrote down is an order the next person
 * reorders.
 *
 * ## The order, and why it is this one
 *
 * There is no transaction that spans Postgres and object storage, so one of the two sides is always
 * exposed. Three orders were possible:
 *
 *  1. ROWS FIRST, then objects (what "delete company" effectively did — it never deleted objects at
 *     all). A crash after the commit loses every uri: unreachable orphans, forever. Rejected.
 *  2. OBJECTS FIRST, then rows. A crash halfway leaves live `DocumentArchive` rows pointing at bytes
 *     that are gone — and `verifyDocumentArchive` (`persistence.ts`) then reports those archives
 *     `corrupted`. A legal integrity control that lies about intact archives is worse than a delayed
 *     deletion. Rejected.
 *  3. WRITE DOWN THE INVENTORY first, in the SAME transaction as the rows, then delete the objects.
 *     Chosen. The inventory (`PendingStorageErasure`) is durable, it commits atomically with the
 *     deletion — so it can never name a company that is still alive, which a later drain would
 *     happily erase — and the object deletion that follows is fully restartable from it.
 *
 * A crash anywhere after that commit therefore leaves a QUERY, not silence:
 * `SELECT * FROM "PendingStorageErasure" WHERE "erasedAt" IS NULL` — every object still on the
 * volume, which company it belonged to, and (`lastError`) why the last attempt failed.
 *
 * The inventory is read INSIDE the transaction too, never before it: a queued send job committing an
 * archive between a pre-transaction read and the deletion would otherwise produce a brand-new orphan
 * that no journal row names.
 *
 * ## ⚖ Statutory retention versus erasure
 *
 * `archive/retention/` resolves, per archive, how long a statute requires that document kept and what
 * the duration counts from. Those obligations do not lapse because a customer closed their account,
 * and GDPR art. 17(3)(b) says as much: the right to erasure "shall not apply to the extent that
 * processing is necessary … for compliance with a legal obligation which requires processing by Union
 * or Member State law to which the controller is subject".
 *
 * So `drainStorageErasureJournal` ERASES nothing whose `retentionUntil` is still in the future. Such a
 * row stays pending, carrying the date AND the `retentionBasis` citation copied off the archive row
 * before it was cascaded away — which is precisely what makes the bytes findable again once the
 * statute has run, and what stops an "erase everything" pass from quietly destroying records a tax
 * authority can still demand. Everything else — past retention, or a country with no declared rule at
 * all — is erased immediately.
 *
 * What this file does NOT decide, because it is not a code question: whether this product should be
 * holding a departed customer's archived invoices for the six-to-ten years their own national law
 * requires them kept, or should instead refuse the deletion until that window closes (which is what
 * `danger.service.ts#resetCompanyData` does for the much narrower "reset my data" action). Both
 * readings are defensible and they lead to opposite products. This file takes the one position that
 * is safe under either — destroy nothing a statute still requires, orphan nothing, block no exit —
 * and leaves the choice visible in the journal rather than buried in a branch.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { deleteInboundFilesForCompany } from '../received-invoices/storage';
import { deleteArchivedArtifacts } from './storage';

/**
 * The narrow, structurally-typed subset of a Prisma transaction client `journalCompanyStorageObjects`
 * actually uses — same convention `billing/deletion.ts#DeletionPolarClient` holds for its own SDK
 * client, and for the same reason: a caller passes the real `tx`, a test passes three functions.
 */
export interface StorageErasureTx {
  documentArchive: {
    findMany(args: {
      where: { companyId: string };
      select: { documentId: true; uri: true; retentionUntil: true; retentionBasis: true };
    }): Promise<
      { documentId: string; uri: string; retentionUntil: Date | null; retentionBasis: string | null }[]
    >;
  };
  pendingStorageErasure: {
    createMany(args: {
      data: {
        companyId: string;
        kind: 'ARCHIVE' | 'INBOUND_PREFIX';
        target: string;
        documentId?: string;
        retentionUntil?: Date | null;
        retentionBasis?: string | null;
      }[];
      skipDuplicates: true;
    }): Promise<{ count: number }>;
  };
}

/**
 * Writes down every object this company owns, so the bytes stay nameable once the rows that pointed
 * at them are gone. MUST be called inside the very transaction that deletes those rows, and before
 * the delete statements themselves — see this file's own header for why both halves of that sentence
 * matter.
 *
 * Returns how many journal rows were written, so a caller can log a number it actually observed
 * rather than one it assumed.
 */
export async function journalCompanyStorageObjects(tx: StorageErasureTx, companyId: string): Promise<number> {
  const archives = await tx.documentArchive.findMany({
    where: { companyId },
    select: { documentId: true, uri: true, retentionUntil: true, retentionBasis: true },
  });

  // Several archives legitimately share ONE uri — content-hash addressing makes re-archiving a
  // byte-identical artifact set land back on the same directory (`storage.ts#archiveDir`), and a
  // VERDICT row copies its parent's retention verbatim. Deleting that directory once is the whole
  // job; the FIRST row's retention wins because, for rows sharing a uri, it is the same value.
  const byUri = new Map<string, (typeof archives)[number]>();
  for (const archive of archives) {
    if (!byUri.has(archive.uri)) byUri.set(archive.uri, archive);
  }

  const data: Parameters<StorageErasureTx['pendingStorageErasure']['createMany']>[0]['data'] = [
    ...[...byUri.values()].map((archive) => ({
      companyId,
      kind: 'ARCHIVE' as const,
      target: archive.uri,
      documentId: archive.documentId,
      retentionUntil: archive.retentionUntil,
      retentionBasis: archive.retentionBasis,
    })),
    // ONE row for the whole inbound prefix — that store deletes by company, not by file, and keeps no
    // per-file DB row this could enumerate from (`received-invoices/storage.ts`'s own header). Written
    // unconditionally, even for a company that never uploaded anything: the delete primitive is a
    // no-op on a missing directory/prefix, and a journal that only sometimes mentions the inbound
    // store would leave an operator unable to tell "nothing to erase" from "never looked".
    {
      companyId,
      kind: 'INBOUND_PREFIX' as const,
      target: companyId,
      retentionUntil: null,
      retentionBasis: null,
    },
  ];

  const { count } = await tx.pendingStorageErasure.createMany({ data, skipDuplicates: true });
  return count;
}

export interface StorageErasureDrainResult {
  /** Objects actually deleted from storage on this pass. */
  erased: number;
  /** Rows deliberately left pending because a statute still requires those bytes kept — ⚖ see this
   *  file's own header. Not a failure, and never logged as one. */
  retained: number;
  /** Rows whose deletion threw. They stay pending with `lastError` set, and a later pass retries. */
  failed: number;
}

/**
 * Deletes the bytes named by every pending journal row — the step that runs AFTER the deletion
 * transaction has committed, and the step an operator (or a future sweep) re-runs against whatever a
 * crash left behind. Restartable by construction: a row is marked `erasedAt` only once its own bytes
 * are gone, so re-running is idempotent and never skips work it did not finish.
 *
 * NEVER THROWS. By the time this runs the rows are already gone and the deletion has genuinely
 * succeeded; letting a storage hiccup propagate would make a completed, irreversible deletion report
 * itself as refused — a lie the caller would then repeat to the user ("nothing was deleted"). Every
 * failure is logged AND left in the journal, which is the honest record of what is still on disk —
 * the same best-effort posture `danger.service.ts`'s own post-commit cleanup already held, except
 * that what it swallowed used to vanish with it.
 *
 * `companyId` narrows the pass to one company (what the deletion paths call it with, so one
 * company's stuck storage never delays another's). Omit it to drain everything pending.
 */
export async function drainStorageErasureJournal(options?: {
  companyId?: string;
  now?: Date;
}): Promise<StorageErasureDrainResult> {
  const now = options?.now ?? new Date();
  const result: StorageErasureDrainResult = { erased: 0, retained: 0, failed: 0 };

  let pending: {
    id: string;
    companyId: string;
    kind: string;
    target: string;
    retentionUntil: Date | null;
    retentionBasis: string | null;
  }[];
  try {
    pending = await prisma.pendingStorageErasure.findMany({
      where: {
        erasedAt: null,
        ...(options?.companyId ? { companyId: options.companyId } : {}),
      },
      select: {
        id: true,
        companyId: true,
        kind: true,
        target: true,
        retentionUntil: true,
        retentionBasis: true,
      },
    });
  } catch (error) {
    // Even READING the journal can fail (the database went away between the commit and here). Logged
    // rather than thrown, for the same reason every other failure in this function is — and the rows
    // are still there to be drained by the next pass.
    logger.error('Could not read the storage-erasure journal — nothing was erased on this pass', {
      category: 'danger',
      details: {
        companyId: options?.companyId ?? null,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return result;
  }

  for (const row of pending) {
    // ⚖ A statute still requires these bytes kept — see this file's own header. Left pending ON
    // PURPOSE, with the date and the citation that say why; not an error, not a retry.
    if (row.retentionUntil && row.retentionUntil.getTime() > now.getTime()) {
      result.retained += 1;
      continue;
    }

    try {
      if (row.kind === 'ARCHIVE') {
        await deleteArchivedArtifacts(row.target);
      } else {
        await deleteInboundFilesForCompany(row.target);
      }
      await prisma.pendingStorageErasure.update({ where: { id: row.id }, data: { erasedAt: now } });
      result.erased += 1;
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Could not erase a stored object after its company was deleted — left in the journal', {
        category: 'danger',
        details: { companyId: row.companyId, kind: row.kind, target: row.target, error: message },
      });
      // Best-effort: if even recording WHY failed, the row still stands with `erasedAt` null, which is
      // the fact that actually matters to an operator.
      await prisma.pendingStorageErasure
        .update({ where: { id: row.id }, data: { lastError: message } })
        .catch(() => undefined);
    }
  }

  if (result.retained > 0) {
    logger.warn(
      'Stored objects kept despite an erasure request — a statutory retention period has not elapsed',
      {
        category: 'danger',
        details: {
          companyId: options?.companyId ?? null,
          retained: result.retained,
          // The citation off the longest-held row, so the log line names the statute rather than only
          // a count. Read straight from the journal — never re-derived, the catalog input is gone.
          retentionBasis:
            pending
              .filter((row) => row.retentionUntil && row.retentionUntil.getTime() > now.getTime())
              .sort((a, b) => b.retentionUntil!.getTime() - a.retentionUntil!.getTime())[0]?.retentionBasis ??
            null,
        },
      },
    );
  }

  return result;
}
