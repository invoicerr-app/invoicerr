import { vi, type Mock } from 'vitest';

import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildExpenseDescriptor } from '../descriptors/expense.descriptor';
import { buildGoodsReceiptDescriptor } from '../descriptors/goods-receipt.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { buildPurchaseOrderDescriptor } from '../descriptors/purchase-order.descriptor';
import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { buildReceivedInvoiceDescriptor } from '../descriptors/received-invoice.descriptor';
import {
  applyStockOnIssuance,
  computeStockDecrements,
  decrementsStockOnIssuance,
} from './apply-stock-on-issuance';

// Mocked wholesale, same discipline `documents.service.*.spec.ts` already holds for `./persistence`/
// `./numbering/take-number` — this is a unit test of the WIRING (which articles get read/written),
// never a proof of real Postgres behavior (that would be a `.live.spec.ts`, per documentation/docs/developer-guide/live-testing.md, and
// there is no external API here to prove live in the first place).
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    article: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import prisma from '@/prisma/prisma.service';

describe('computeStockDecrements (pure)', () => {
  it('decrements a stock-tracked article by a single line quantity', () => {
    const result = computeStockDecrements([{ articleId: 'article-1', quantity: 3 }], [{ id: 'article-1' }]);

    expect(result).toEqual([{ articleId: 'article-1', consumed: 3 }]);
  });

  it('ignores a line with no articleId at all — hand-typed lines never touch stock', () => {
    const result = computeStockDecrements(
      [{ description: 'Hand-typed line', quantity: 3 }],
      [{ id: 'article-1' }],
    );

    expect(result).toEqual([]);
  });

  it('sums MULTIPLE lines referencing the SAME article into ONE result entry', () => {
    const result = computeStockDecrements(
      [
        { articleId: 'article-1', quantity: 2 },
        { articleId: 'article-1', quantity: 5 },
      ],
      [{ id: 'article-1' }],
    );

    expect(result).toEqual([{ articleId: 'article-1', consumed: 7 }]);
  });

  it('leaves an article NOT in trackedArticles untouched — a SERVICE (quantity: null) article never reaches this array', () => {
    // The writer only ever passes STOCK-TRACKED articles in (see applyStockOnIssuance's own query) —
    // an article the caller excluded (not stock-tracked, or belonging to another company) is simply
    // absent from `trackedArticles`, which this function must treat exactly like "no such article".
    const result = computeStockDecrements(
      [{ articleId: 'service-article', quantity: 4 }],
      [{ id: 'a-different-article' }],
    );

    expect(result).toEqual([]);
  });

  it('a line quantity of exactly the tracked total is still a real, non-zero delta to persist', () => {
    const result = computeStockDecrements([{ articleId: 'article-1', quantity: 10 }], [{ id: 'article-1' }]);

    expect(result).toEqual([{ articleId: 'article-1', consumed: 10 }]);
  });

  it('ignores a line with a non-numeric/missing quantity, even for a tracked article', () => {
    const result = computeStockDecrements(
      [{ articleId: 'article-1', quantity: 'not-a-number' }],
      [{ id: 'article-1' }],
    );

    expect(result).toEqual([]);
  });

  it('handles several DIFFERENT articles independently in the same document', () => {
    const result = computeStockDecrements(
      [
        { articleId: 'article-1', quantity: 3 },
        { articleId: 'article-2', quantity: 1 },
      ],
      [{ id: 'article-1' }, { id: 'article-2' }],
    );

    expect(result).toEqual(
      expect.arrayContaining([
        { articleId: 'article-1', consumed: 3 },
        { articleId: 'article-2', consumed: 1 },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('returns nothing for an empty or malformed `lines` value — never throws', () => {
    expect(computeStockDecrements(undefined, [{ id: 'article-1' }])).toEqual([]);
    expect(computeStockDecrements(null, [{ id: 'article-1' }])).toEqual([]);
    expect(computeStockDecrements([], [{ id: 'article-1' }])).toEqual([]);
    expect(computeStockDecrements('not-an-array', [{ id: 'article-1' }])).toEqual([]);
  });
});

/**
 * Issue #579: `decrementsStockOnIssuance` is the ONE gate every `applyStockOnIssuance` call site
 * (`documents.service.ts#runAction`, both of `actions/async-send.ts`'s sites,
 * `actions/send-document-email.ts`) now checks, proven here against EVERY document type actually
 * REGISTERED in this product (documents-core.module.ts), never a synthetic stand-in, so a future type
 * that forgets to opt out (or a typo that makes it opt in) is caught by this test changing, not by a
 * customer's stock quietly drifting. Only the invoice may ever return `true`: it is the one type that
 * actually delivers goods. The quote is the load-bearing case: its own `lines` declares the exact
 * same `articleId` field the invoice's does (`declaresArticleReference` is `true` for both), which is
 * precisely the shape that used to make a quote SEND decrement stock before this fix.
 */
describe('decrementsStockOnIssuance - the gate for every registered document type (issue #579)', () => {
  it('is true for the invoice and false for every other registered type', () => {
    expect(decrementsStockOnIssuance(buildInvoiceDescriptor())).toBe(true);

    expect(decrementsStockOnIssuance(buildQuoteDescriptor())).toBe(false);
    expect(decrementsStockOnIssuance(buildCreditNoteDescriptor())).toBe(false);
    expect(decrementsStockOnIssuance(buildExpenseDescriptor())).toBe(false);
    expect(decrementsStockOnIssuance(buildPurchaseOrderDescriptor())).toBe(false);
    expect(decrementsStockOnIssuance(buildGoodsReceiptDescriptor())).toBe(false);
    expect(decrementsStockOnIssuance(buildReceivedInvoiceDescriptor())).toBe(false);
  });

  it("never decrements for a type whose lines declare the SAME article-reference field the invoice's do (the quote's own shape), `declaresArticleReference` alone must never be enough", () => {
    const quote = buildQuoteDescriptor();
    const invoice = buildInvoiceDescriptor();

    // Both descriptors structurally let a line reference an article (the catalog-prefill picker),
    // proving the regression this issue fixed is not "the quote's lines look different", it is that
    // `stockEffect` is the explicit fact that now tells them apart, never field shape alone.
    expect(quote.fields.some((f) => f.kind === 'array')).toBe(true);
    expect(invoice.fields.some((f) => f.kind === 'array')).toBe(true);

    expect(decrementsStockOnIssuance(quote)).toBe(false);
    expect(decrementsStockOnIssuance(invoice)).toBe(true);
  });
});

describe('applyStockOnIssuance (thin Prisma writer)', () => {
  afterEach(() => vi.resetAllMocks());

  it("reads only THIS company's stock-tracked, actually-referenced articles, then issues one ATOMIC updateMany per article", async () => {
    (prisma.article.findMany as Mock).mockResolvedValue([{ id: 'article-1' }]);

    await applyStockOnIssuance('company-1', {
      id: 'doc-1',
      data: { lines: [{ articleId: 'article-1', quantity: 4 }] },
    });

    expect(prisma.article.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', id: { in: ['article-1'] }, quantity: { not: null } },
      select: { id: true },
    });
    expect(prisma.article.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.article.updateMany).toHaveBeenCalledWith({
      where: { id: 'article-1', companyId: 'company-1' },
      data: { quantity: { decrement: 4 } },
    });
  });

  it('never queries or writes at all when no line carries an articleId', async () => {
    await applyStockOnIssuance('company-1', {
      id: 'doc-1',
      data: { lines: [{ description: 'Hand-typed', quantity: 4 }] },
    });

    expect(prisma.article.findMany).not.toHaveBeenCalled();
    expect(prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('a SERVICE article (excluded by the quantity:not-null query) gets no UPDATE at all', async () => {
    (prisma.article.findMany as Mock).mockResolvedValue([]); // the query itself excludes it

    await applyStockOnIssuance('company-1', {
      id: 'doc-1',
      data: { lines: [{ articleId: 'service-article', quantity: 2 }] },
    });

    expect(prisma.article.updateMany).not.toHaveBeenCalled();
  });

  // The `hiddenReference` gap ("hiddenReference is not covered"): a line's `articleId` is a
  // 'hiddenReference', never scoped by `validate-references.ts` (nested rows are out of that pass's
  // scope — see that file's own header). This proves the READ side closes the gap anyway, at the ONE
  // consumer that would actually cost something if it didn't: even a REAL, stock-tracked article
  // belonging to a DIFFERENT company is excluded by the `companyId`-scoped `where` clause, exactly like
  // a never-existed id — this company's `send` never reaches, let alone decrements, another tenant's
  // stock. The mock's own `where.companyId` check is what makes this a real proof rather than the
  // "mock ignores its arguments" trap 86e331c5's own commit message calls out: it actually behaves
  // like Postgres would for this query, filtering by the id it's given.
  it('a stock-tracked article belonging to a DIFFERENT company is excluded by the companyId scope — cross-tenant stock is never touched', async () => {
    (prisma.article.findMany as Mock).mockImplementation(({ where }: { where: { companyId: string } }) =>
      Promise.resolve(where.companyId === 'company-1' ? [] : [{ id: 'other-companys-article' }]),
    );

    await applyStockOnIssuance('company-1', {
      id: 'doc-1',
      data: { lines: [{ articleId: 'other-companys-article', quantity: 50 }] },
    });

    expect(prisma.article.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', id: { in: ['other-companys-article'] }, quantity: { not: null } },
      select: { id: true },
    });
    expect(prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('NEVER THROWS when the DB read itself fails — the document must stand regardless', async () => {
    (prisma.article.findMany as Mock).mockRejectedValue(new Error('connection lost'));

    await expect(
      applyStockOnIssuance('company-1', { id: 'doc-1', data: { lines: [{ articleId: 'a', quantity: 1 }] } }),
    ).resolves.toBeUndefined();
  });

  it('NEVER THROWS for a malformed `data` (no `lines` at all)', async () => {
    await expect(applyStockOnIssuance('company-1', { id: 'doc-1', data: null })).resolves.toBeUndefined();
    await expect(applyStockOnIssuance('company-1', { id: 'doc-1', data: {} })).resolves.toBeUndefined();
    expect(prisma.article.findMany).not.toHaveBeenCalled();
  });

  /**
   * THE MUTATION TARGET: two invoices issued "in parallel" (`Promise.all`), each referencing the SAME
   * article, must both actually apply their own decrement — never one silently overwriting the other's
   * read. The mock below models what the OLD read-modify-write code could not: a shared, mutable
   * counter that PostgreSQL itself would maintain server-side, decremented by whatever delta each call
   * asks for, regardless of interleaving. This is what proves `applyStockOnIssuance` never reads a
   * quantity to compute a target any more — it only ever hands Prisma a relative `{ decrement }`, the
   * one shape that stays correct under this kind of race by construction, not by lucky ordering.
   */
  it('two concurrent issuances of the SAME article both apply — no lost update', async () => {
    let serverSideQuantity = 10;
    (prisma.article.findMany as Mock).mockResolvedValue([{ id: 'article-1' }]);
    (prisma.article.updateMany as Mock).mockImplementation(
      ({ data }: { data: { quantity: { decrement: number } } }) => {
        serverSideQuantity -= data.quantity.decrement; // exactly what `quantity = quantity - $1` does
        return Promise.resolve({ count: 1 });
      },
    );

    await Promise.all([
      applyStockOnIssuance('company-1', {
        id: 'doc-1',
        data: { lines: [{ articleId: 'article-1', quantity: 3 }] },
      }),
      applyStockOnIssuance('company-1', {
        id: 'doc-2',
        data: { lines: [{ articleId: 'article-1', quantity: 2 }] },
      }),
    ]);

    expect(serverSideQuantity).toBe(5); // 10 - 3 - 2, never 7 or 8 (a lost update)
    expect(prisma.article.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.article.updateMany).toHaveBeenCalledWith({
      where: { id: 'article-1', companyId: 'company-1' },
      data: { quantity: { decrement: 3 } },
    });
    expect(prisma.article.updateMany).toHaveBeenCalledWith({
      where: { id: 'article-1', companyId: 'company-1' },
      data: { quantity: { decrement: 2 } },
    });
  });
});
