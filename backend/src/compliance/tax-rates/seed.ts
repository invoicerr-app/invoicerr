/**
 * Makes the `VatRate` table match the catalog files exactly — see `schema.ts`'s module docstring
 * for why this catalog exists and how it relates to `tax-engine.ts`.
 *
 * Idempotent by construction: each row's identity is (countryCode, sourceId, validFrom) — the same
 * triple every time the files are unchanged — so re-running upserts the same rows (no duplicates)
 * and deletes nothing. Editing a rate's value/label/source in the file and reseeding updates the
 * row in place. Adding a new temporal entry (a new id, or an existing id with a new validFrom —
 * i.e. a rate change) makes a new row appear. Removing an entry from the file makes its row
 * disappear on the next reseed — the file is the ongoing source of truth, not a one-time fixture,
 * which is the whole point of "ajouter un taux dans le fichier suffit à le faire apparaître".
 *
 * Historical windows are seeded too (not just what's in force today) — the API only reads
 * `VatRateCatalog.ratesAt(now)`-equivalent rows via a validFrom/validTo filter, but the table keeps
 * the full history so a future "what rate applied on this document's issue date" read never needs a
 * second seed pass.
 *
 * Deliberately loosely typed (`PrismaVatRateClient` below, not the generated Prisma Client type):
 * this is an internal seeding utility, not a public API, and the loose shape makes it trivial to
 * drive with a hand-rolled fake in tests — the same style already used by `InvitationsService.spec`
 * — without depending on `prisma/generated/prisma` in the type signature.
 */
import { defaultVatRateCatalog, VatRateCatalog } from './registry';

export interface VatRateRow {
  countryCode: string;
  sourceId: string;
  rate: number;
  label: string;
  category: string;
  validFrom: Date;
  validTo: Date | null;
  confidence: string;
  source: string;
  sourceCheckedAt: Date;
  notes: string | null;
}

export interface PrismaVatRateClient {
  vatRate: {
    upsert: (args: {
      where: { countryCode_sourceId_validFrom: { countryCode: string; sourceId: string; validFrom: Date } };
      create: VatRateRow;
      update: Omit<VatRateRow, 'countryCode' | 'sourceId' | 'validFrom'>;
    }) => Promise<unknown>;
    findMany: (args: {
      where: { countryCode: string };
      select: { id: true; sourceId: true; validFrom: true };
    }) => Promise<{ id: string; sourceId: string; validFrom: Date }[]>;
    deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown>;
  };
  $transaction: <T>(fn: (tx: PrismaVatRateClient) => Promise<T>) => Promise<T>;
}

export interface VatRateSeedSummary {
  /** Rows created or updated (upsert doesn't distinguish the two without an extra read, and the
   *  distinction isn't useful here — both mean "this row now matches the file"). */
  upserted: number;
  /** Rows removed because their (sourceId, validFrom) is no longer in the file. */
  deleted: number;
}

/** Same-day comparison key for a Date — avoids depending on exact Date object identity between what
 *  the file declares and what Postgres round-trips back. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function seedVatRates(
  prisma: PrismaVatRateClient,
  catalog: VatRateCatalog = defaultVatRateCatalog,
): Promise<VatRateSeedSummary> {
  let upserted = 0;
  let deleted = 0;

  for (const countryCode of catalog.countries()) {
    const windows = catalog.allWindows(countryCode);
    const keepKeys = new Set(windows.map((w) => `${w.value.id}@${w.validFrom}`));

    await prisma.$transaction(async (tx) => {
      for (const w of windows) {
        const validFrom = new Date(w.validFrom);
        await tx.vatRate.upsert({
          where: { countryCode_sourceId_validFrom: { countryCode, sourceId: w.value.id, validFrom } },
          create: {
            countryCode,
            sourceId: w.value.id,
            rate: w.value.rate,
            label: w.value.label,
            category: w.value.category,
            validFrom,
            validTo: w.validTo ? new Date(w.validTo) : null,
            confidence: w.value.confidence,
            source: w.value.source,
            sourceCheckedAt: new Date(w.value.sourceCheckedAt),
            notes: w.value.notes ?? null,
          },
          update: {
            rate: w.value.rate,
            label: w.value.label,
            category: w.value.category,
            validTo: w.validTo ? new Date(w.validTo) : null,
            confidence: w.value.confidence,
            source: w.value.source,
            sourceCheckedAt: new Date(w.value.sourceCheckedAt),
            notes: w.value.notes ?? null,
          },
        });
        upserted++;
      }

      const existing = await tx.vatRate.findMany({
        where: { countryCode },
        select: { id: true, sourceId: true, validFrom: true },
      });
      const stale = existing.filter((row) => !keepKeys.has(`${row.sourceId}@${dayKey(row.validFrom)}`));
      if (stale.length > 0) {
        await tx.vatRate.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
        deleted += stale.length;
      }
    });
  }

  return { upserted, deleted };
}
