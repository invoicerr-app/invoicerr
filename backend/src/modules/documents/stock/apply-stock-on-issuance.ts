/**
 * Basic stock management ("gestion de stock basique") — the stock effect of ISSUING a document.
 * Called once, type-agnostically, from `documents.service.ts#runAction` — see that call site's own
 * comment for exactly where and why. Never named "invoice" anywhere in this file: it only ever reads
 * "lines that reference a stock-tracked article", which is what lets any current or future
 * article-referencing document type get the exact same bookkeeping for free (this repo's "a document
 * type is just data" thesis).
 *
 * Split, like `reminders/reminder-sweep.ts` + `reminder-sweep-runner.ts`, into a PURE computation
 * (`computeStockDecrements` — "which article loses how much", unit-testable with no DB) and a thin
 * Prisma writer (`applyStockOnIssuance`) that only ever reads THIS company's own, ACTUALLY-referenced,
 * stock-tracked articles and issues one ATOMIC UPDATE per article that changed.
 *
 * ATOMIC across concurrent issuances of the SAME article — `computeStockDecrements` deliberately
 * computes a per-article DELTA ("how much does this document consume"), never an absolute target
 * quantity: the writer applies it with Prisma's `{ decrement }`, which Postgres translates to
 * `quantity = quantity - $1` in a single statement. Two documents issued in parallel, each
 * referencing the same article, therefore each subtract their own delta from whatever the row's TRUE
 * quantity is AT WRITE TIME — never from a JS-side snapshot read moments earlier — so neither
 * decrement is lost to the other, with no lock and no read-modify-write race window at all. This used
 * to read a quantity, compute an absolute `newQuantity` in memory, then `update({ data: { quantity:
 * newQuantity } })`: two concurrent issuances of the SAME article both read the SAME stale quantity,
 * and the SECOND write silently clobbered the first's — a genuine, cumulative inventory drift, not a
 * theoretical one (the normal shape once `WORKER_INLINE=false` runs more than one worker replica).
 * Still never clamped at 0 — an oversold article legitimately goes NEGATIVE (see this file's own
 * `computeStockDecrements` header) — the atomic decrement carries no WHERE-side quantity floor,
 * because only the arithmetic has to be race-free, never the accept/reject decision.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

/** A company's own Article, narrowed to what this module needs. Always STOCK-TRACKED
 *  (`quantity !== null`) by construction — see `applyStockOnIssuance`'s own query, the only caller
 *  that ever builds one of these: a SERVICE/never-tracked article (`Article.quantity: null`) simply
 *  never appears here at all, so `computeStockDecrements` never needs its own "not tracked" branch.
 *  No `quantity` field: since the writer applies a DELTA (`{ decrement }`), never an absolute target
 *  (see this file's own header), the only fact this pure function needs about an article is that it
 *  IS one of this company's own stock-tracked, actually-referenced ones — its current quantity is read
 *  by Postgres itself, atomically, at write time. */
export interface StockTrackedArticle {
  id: string;
}

/** One article's stock delta, ready to persist atomically. */
export interface StockDecrementResult {
  articleId: string;
  /** How much to SUBTRACT — summed across every line referencing this article. Applied via an atomic
   *  `{ decrement }` UPDATE (see `applyStockOnIssuance`), never an absolute value: this is the one
   *  change that makes concurrent issuances of the SAME article race-free (this file's own header). A
   *  negative RESULTING quantity is still possible (an oversold article) — that is a fact about what
   *  Postgres computes from the row's TRUE quantity, never something this pure function decides or
   *  clamps; see the low-stock alert (`isLowStock`, articles.service.ts), which surfaces it either way. */
  consumed: number;
}

/** One line's raw shape, as far as this module cares — never a fixed interface for "an invoice line"
 *  (a line's shape is descriptor data, see invoice.descriptor.ts, not a type this generic engine
 *  owns). Both fields are read defensively below: a line that never went through a descriptor's own
 *  validation (a stale draft, a hand-crafted fixture) must never throw this out of issuance. */
interface RawStockLine {
  articleId?: unknown;
  quantity?: unknown;
}

/**
 * Pure: "which article loses how much". Reads `lines` (a document's own `data.lines` — untyped,
 * see `RawStockLine` above) and `trackedArticles` (this company's OWN stock-tracked articles among
 * the ones these lines actually reference, already fetched by the caller — see this file's own
 * header for why that fetch stays OUTSIDE this function). A line contributes nothing when:
 *  - it carries no `articleId` at all (never picked from the catalog, or the catalog article since
 *    deleted — see `trackedArticles` not containing it either way for the deleted case);
 *  - its `articleId` isn't in `trackedArticles` — no such article for THIS company, or one that
 *    exists but isn't stock-tracked (`Article.quantity: null`, a SERVICE item) — the writer already
 *    excluded it from what it fetched, so from here it is simply absent, untouched;
 *  - its own `quantity` isn't a finite number (missing, a stale draft, a corrupt fixture).
 * Several lines referencing the SAME article are summed into ONE result entry, so the writer below
 * issues exactly one UPDATE per article, never one per line.
 */
export function computeStockDecrements(
  lines: unknown,
  trackedArticles: StockTrackedArticle[],
): StockDecrementResult[] {
  if (!Array.isArray(lines) || trackedArticles.length === 0) return [];

  const trackedIds = new Set(trackedArticles.map((article) => article.id));
  const consumedByArticle = new Map<string, number>();

  for (const line of lines) {
    if (line === null || typeof line !== 'object') continue;
    const { articleId, quantity } = line as RawStockLine;
    if (typeof articleId !== 'string' || articleId.length === 0) continue;
    if (!trackedIds.has(articleId)) continue; // no such article for this company, or not tracked
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) continue;

    consumedByArticle.set(articleId, (consumedByArticle.get(articleId) ?? 0) + quantity);
  }

  return Array.from(consumedByArticle.entries()).map(([articleId, consumed]) => ({ articleId, consumed }));
}

/**
 * The Prisma-touching half. Called from `documents.service.ts#runAction` at the exact once-only
 * "entering `numbering.onEnterStatus` for the first time" gate — see that call site's own comment for
 * why that gate already means "fires exactly once per document" without this function needing any
 * idempotency logic of its own.
 *
 * NEVER THROWS: a stock-bookkeeping hiccup (a bad DB connection, a malformed `data.lines`) must never
 * block an otherwise legally-issued document — the same "the document itself still stands" posture
 * `reminders/reminder-sweep-runner.ts`'s own header documents for its per-invoice failures, applied
 * here to the single document this call is about.
 */
export async function applyStockOnIssuance(
  companyId: string,
  document: { id: string; data: unknown },
): Promise<void> {
  try {
    const lines = (document.data as { lines?: unknown } | null | undefined)?.lines;
    if (!Array.isArray(lines) || lines.length === 0) return;

    const articleIds = Array.from(
      new Set(
        lines
          .filter((line): line is Record<string, unknown> => line !== null && typeof line === 'object')
          .map((line) => line.articleId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    if (articleIds.length === 0) return;

    // Company-scoped (multi-tenancy — CLAUDE.md's own "every service method scopes by companyId")
    // AND stock-tracked only (`quantity: { not: null }`) — a SERVICE article, one belonging to a
    // different company, or one already deleted is excluded right here, never inside the pure
    // computation above (see its own header on why that stays DB-free). Selects only `id`: unlike
    // before, the writer never reads a quantity to compute anything — see this file's own header.
    const trackedArticles = await prisma.article.findMany({
      where: { companyId, id: { in: articleIds }, quantity: { not: null } },
      select: { id: true },
    });

    const decrements = computeStockDecrements(lines, trackedArticles);

    for (const { articleId, consumed } of decrements) {
      if (consumed === 0) continue; // nothing to persist — never a no-op write
      // ATOMIC decrement — see this file's own header for why this, and not a read-modify-write, is
      // what makes two concurrent issuances of the SAME article race-free. Scoped by `companyId` too,
      // even though `articleId` alone is already unique: belt-and-suspenders against ever writing a
      // row `trackedArticles` above did not actually select for this company.
      await prisma.article.updateMany({
        where: { id: articleId, companyId },
        data: { quantity: { decrement: consumed } },
      });
    }
  } catch (error) {
    logger.error('Stock decrement failed on document issuance — the document itself still stands', {
      category: 'documents',
      details: {
        companyId,
        documentId: document.id,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
