/**
 * One-shot catch-up for invitation codes written before only a digest was stored: reads every row
 * that still carries a plaintext `code`, replaces it with its HMAC digest and eight-character
 * preview, and nulls the plaintext.
 *
 * Idempotent and safe on every boot, the same shape `webhooks/webhook-secret-migration.ts` already
 * uses for its own plaintext-to-encrypted catch-up: the `findMany` predicate is what makes a second
 * run a no-op (one query, no rows), and `updateMany` is guarded on `code IS NOT NULL` so two API
 * replicas booting together cannot both write the same row.
 *
 * Not folded into the SQL migration on purpose: the digest is keyed by the deployment's own auth
 * secret, which Postgres does not have. Doing it here keeps the key in the process that already holds
 * it and lets the migration itself stay a schema change.
 */
import { hashInvitationCode, invitationCodePrefix } from '@/lib/invitation-code';

export interface InvitationCodeBackfillSummary {
  /** Rows that still carried a plaintext code when this pass started. */
  scanned: number;
  /** Rows digested by THIS pass. Can be lower than `scanned` when another replica won the race. */
  migrated: number;
}

interface LegacyInvitationCodeRow {
  id: string;
  code: string | null;
}

/** The two Prisma calls this backfill needs — minimal so a unit test can supply a fake. */
export interface InvitationCodeBackfillPrisma {
  invitationCode: {
    findMany(args: {
      where: { code: { not: null } };
      select: { id: true; code: true };
      take: number;
    }): Promise<LegacyInvitationCodeRow[]>;
    updateMany(args: {
      where: { id: string; code: { not: null } };
      data: { code: null; codeHash: string; codePrefix: string };
    }): Promise<{ count: number }>;
  };
}

/** Rows read per round trip: a deployment upgrading from a version that minted codes freely could
 *  hold thousands, and the whole table does not need to be in memory at once. */
const BATCH_SIZE = 500;

export async function digestLegacyInvitationCodes(
  prisma: InvitationCodeBackfillPrisma,
): Promise<InvitationCodeBackfillSummary> {
  const summary: InvitationCodeBackfillSummary = { scanned: 0, migrated: 0 };

  for (;;) {
    const rows = await prisma.invitationCode.findMany({
      where: { code: { not: null } },
      select: { id: true, code: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) return summary;

    let migratedThisPass = 0;
    for (const row of rows) {
      if (!row.code) continue; // an empty string is not a code; nothing to digest
      summary.scanned++;

      const { count } = await prisma.invitationCode.updateMany({
        where: { id: row.id, code: { not: null } },
        data: {
          code: null,
          codeHash: hashInvitationCode(row.code),
          codePrefix: invitationCodePrefix(row.code),
        },
      });
      if (count > 0) {
        summary.migrated++;
        migratedThisPass++;
      }
    }

    // A pass that digested nothing means whatever is left cannot be digested (`code = ''`, or a
    // concurrent replica won every row) — re-reading would return the same batch forever.
    if (migratedThisPass === 0 || rows.length < BATCH_SIZE) return summary;
  }
}
