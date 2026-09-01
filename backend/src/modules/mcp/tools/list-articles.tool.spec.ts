import { listArticlesTool } from './list-articles.tool';
import { ToolContext } from './types';

// The repère (git tag `avant-refonte-documents`) had no spec for `list_articles` — this one is new,
// same shape as `list-clients.tool.spec.ts`.
describe('listArticlesTool', () => {
  function buildContext(findAll: jest.Mock): ToolContext {
    return {
      companyId: 'company1',
      scopes: ['articles:read'],
      baseUrl: 'http://localhost:4000',
      services: {
        articlesService: { findAll } as any,
        documentsService: {} as any,
        shareLinksService: {} as any,
        clientsService: {} as any,
      },
    };
  }

  it("calls articlesService.findAll with the active company's id", async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const ctx = buildContext(findAll);

    await listArticlesTool.handler(ctx, {});

    expect(findAll).toHaveBeenCalledWith('company1');
  });

  it('maps articles to a compact summary', async () => {
    const findAll = jest
      .fn()
      .mockResolvedValue([
        { id: 'a1', name: 'Widget', description: 'A widget', type: 'PRODUCT', unitPrice: 10, vatRate: 20 },
      ]);
    const ctx = buildContext(findAll);

    const result = await listArticlesTool.handler(ctx, {});

    expect(result.content).toEqual([{ type: 'text', text: '1 article(s) found.' }]);
    expect(result.structuredContent).toEqual({
      articles: [
        { id: 'a1', name: 'Widget', description: 'A widget', type: 'PRODUCT', unitPrice: 10, vatRate: 20 },
      ],
    });
  });
});
