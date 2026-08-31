import { buildArticleReferenceProvider } from './article-reference.provider';

/**
 * Proves the boundary `prefillFrom` (descriptors/types.ts) actually rests on: `getFields` hands back
 * EXACTLY the Article's own business fields the quote/invoice line descriptors' `map`s name
 * (`name`, `description`, `unitPrice`, `vatRate`) — never the internal `unitPriceMinor` column,
 * never `id`/`companyId`/`isActive`/timestamps. The actual "which row key receives which of these"
 * copy happens in the frontend (field-renderers/array-field.tsx, proven by 14-articles.cy.ts); this
 * is the backend half of "fills what's declared and nothing else" — there is nothing MORE than this
 * shape for a row to ever pick up from, however its own `map` is written.
 */
describe('buildArticleReferenceProvider', () => {
  const article = {
    id: 'article-1',
    companyId: 'company-1',
    name: 'Web Design Day',
    description: 'Full day of web design',
    type: 'DAY',
    unitPrice: 800,
    unitPriceMinor: 80000,
    vatRate: 20,
    isActive: true,
    createdAt: new Date('2026-01-01'),
  };

  function buildFakeArticlesService(found: typeof article | null = article) {
    return {
      findAll: jest.fn().mockResolvedValue(found ? [found] : []),
      findOne: jest.fn().mockResolvedValue(found),
    };
  }

  it('getFields returns exactly the business fields a prefillFrom map can name — nothing else', async () => {
    const provider = buildArticleReferenceProvider(buildFakeArticlesService() as never);

    const fields = await provider.getFields!('company-1', 'article-1');

    expect(fields).toEqual({
      name: 'Web Design Day',
      description: 'Full day of web design',
      unitPrice: 800,
      vatRate: 20,
    });
    // Never the minor-units storage detail, never anything the Article row doesn't itself mean to
    // expose as a business fact.
    expect(fields).not.toHaveProperty('unitPriceMinor');
    expect(fields).not.toHaveProperty('id');
    expect(fields).not.toHaveProperty('companyId');
    expect(fields).not.toHaveProperty('isActive');
  });

  it('getFields resolves to null for an id that does not belong to this company', async () => {
    const provider = buildArticleReferenceProvider(buildFakeArticlesService(null) as never);
    await expect(provider.getFields!('company-1', 'missing')).resolves.toBeNull();
  });

  it('search matches by name, case-insensitively, and resolve labels by name', async () => {
    const provider = buildArticleReferenceProvider(buildFakeArticlesService() as never);

    await expect(provider.search('company-1', 'web')).resolves.toEqual([
      { id: 'article-1', label: 'Web Design Day' },
    ]);
    await expect(provider.search('company-1', 'nonexistent')).resolves.toEqual([]);
    await expect(provider.resolve('company-1', 'article-1')).resolves.toEqual({
      id: 'article-1',
      label: 'Web Design Day',
    });
  });
});
