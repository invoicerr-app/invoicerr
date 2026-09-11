import { applyStockOnIssuance, computeStockDecrements } from './apply-stock-on-issuance';

// Mocked wholesale, same discipline `documents.service.*.spec.ts` already holds for `./persistence`/
// `./numbering/take-number` — this is a unit test of the WIRING (which articles get read/written),
// never a proof of real Postgres behavior (that would be a `.live.spec.ts`, per LIVE_TESTING.md, and
// there is no external API here to prove live in the first place).
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    article: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import prisma from '@/prisma/prisma.service';

describe('computeStockDecrements (pure)', () => {
  it('decrements a stock-tracked article by a single line quantity', () => {
    const result = computeStockDecrements(
      [{ articleId: 'article-1', quantity: 3 }],
      [{ id: 'article-1', quantity: 10 }],
    );

    expect(result).toEqual([{ articleId: 'article-1', newQuantity: 7 }]);
  });

  it('ignores a line with no articleId at all — hand-typed lines never touch stock', () => {
    const result = computeStockDecrements(
      [{ description: 'Hand-typed line', quantity: 3 }],
      [{ id: 'article-1', quantity: 10 }],
    );

    expect(result).toEqual([]);
  });

  it('sums MULTIPLE lines referencing the SAME article into ONE result entry', () => {
    const result = computeStockDecrements(
      [
        { articleId: 'article-1', quantity: 2 },
        { articleId: 'article-1', quantity: 5 },
      ],
      [{ id: 'article-1', quantity: 10 }],
    );

    expect(result).toEqual([{ articleId: 'article-1', newQuantity: 3 }]);
  });

  it('leaves an article NOT in trackedArticles untouched — a SERVICE (quantity: null) article never reaches this array', () => {
    // The writer only ever passes STOCK-TRACKED articles in (see applyStockOnIssuance's own query) —
    // an article the caller excluded (not stock-tracked, or belonging to another company) is simply
    // absent from `trackedArticles`, which this function must treat exactly like "no such article".
    const result = computeStockDecrements(
      [{ articleId: 'service-article', quantity: 4 }],
      [{ id: 'a-different-article', quantity: 10 }],
    );

    expect(result).toEqual([]);
  });

  it('does not clamp at 0 — a quantity may legitimately reach exactly 0', () => {
    const result = computeStockDecrements(
      [{ articleId: 'article-1', quantity: 10 }],
      [{ id: 'article-1', quantity: 10 }],
    );

    expect(result).toEqual([{ articleId: 'article-1', newQuantity: 0 }]);
  });

  it('does not clamp at 0 — an oversold article may go NEGATIVE, never clamped', () => {
    const result = computeStockDecrements(
      [{ articleId: 'article-1', quantity: 15 }],
      [{ id: 'article-1', quantity: 10 }],
    );

    expect(result).toEqual([{ articleId: 'article-1', newQuantity: -5 }]);
  });

  it('ignores a line with a non-numeric/missing quantity, even for a tracked article', () => {
    const result = computeStockDecrements(
      [{ articleId: 'article-1', quantity: 'not-a-number' }],
      [{ id: 'article-1', quantity: 10 }],
    );

    expect(result).toEqual([]);
  });

  it('handles several DIFFERENT articles independently in the same document', () => {
    const result = computeStockDecrements(
      [
        { articleId: 'article-1', quantity: 3 },
        { articleId: 'article-2', quantity: 1 },
      ],
      [
        { id: 'article-1', quantity: 10 },
        { id: 'article-2', quantity: 5 },
      ],
    );

    expect(result).toEqual(
      expect.arrayContaining([
        { articleId: 'article-1', newQuantity: 7 },
        { articleId: 'article-2', newQuantity: 4 },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('returns nothing for an empty or malformed `lines` value — never throws', () => {
    expect(computeStockDecrements(undefined, [{ id: 'article-1', quantity: 10 }])).toEqual([]);
    expect(computeStockDecrements(null, [{ id: 'article-1', quantity: 10 }])).toEqual([]);
    expect(computeStockDecrements([], [{ id: 'article-1', quantity: 10 }])).toEqual([]);
    expect(computeStockDecrements('not-an-array', [{ id: 'article-1', quantity: 10 }])).toEqual([]);
  });
});

describe('applyStockOnIssuance (thin Prisma writer)', () => {
  afterEach(() => jest.resetAllMocks());

  it("reads only THIS company's stock-tracked, actually-referenced articles, then issues one UPDATE per article", async () => {
    (prisma.article.findMany as jest.Mock).mockResolvedValue([{ id: 'article-1', quantity: 10 }]);

    await applyStockOnIssuance('company-1', {
      id: 'doc-1',
      data: { lines: [{ articleId: 'article-1', quantity: 4 }] },
    });

    expect(prisma.article.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', id: { in: ['article-1'] }, quantity: { not: null } },
      select: { id: true, quantity: true },
    });
    expect(prisma.article.update).toHaveBeenCalledTimes(1);
    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: 'article-1' },
      data: { quantity: 6 },
    });
  });

  it('never queries or writes at all when no line carries an articleId', async () => {
    await applyStockOnIssuance('company-1', {
      id: 'doc-1',
      data: { lines: [{ description: 'Hand-typed', quantity: 4 }] },
    });

    expect(prisma.article.findMany).not.toHaveBeenCalled();
    expect(prisma.article.update).not.toHaveBeenCalled();
  });

  it('a SERVICE article (excluded by the quantity:not-null query) gets no UPDATE at all', async () => {
    (prisma.article.findMany as jest.Mock).mockResolvedValue([]); // the query itself excludes it

    await applyStockOnIssuance('company-1', {
      id: 'doc-1',
      data: { lines: [{ articleId: 'service-article', quantity: 2 }] },
    });

    expect(prisma.article.update).not.toHaveBeenCalled();
  });

  it('NEVER THROWS when the DB read itself fails — the document must stand regardless', async () => {
    (prisma.article.findMany as jest.Mock).mockRejectedValue(new Error('connection lost'));

    await expect(
      applyStockOnIssuance('company-1', { id: 'doc-1', data: { lines: [{ articleId: 'a', quantity: 1 }] } }),
    ).resolves.toBeUndefined();
  });

  it('NEVER THROWS for a malformed `data` (no `lines` at all)', async () => {
    await expect(applyStockOnIssuance('company-1', { id: 'doc-1', data: null })).resolves.toBeUndefined();
    await expect(applyStockOnIssuance('company-1', { id: 'doc-1', data: {} })).resolves.toBeUndefined();
    expect(prisma.article.findMany).not.toHaveBeenCalled();
  });
});
