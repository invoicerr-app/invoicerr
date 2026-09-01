import { getDocumentTool } from './get-document.tool';
import { ToolContext } from './types';

describe('getDocumentTool', () => {
  function buildContext(
    overrides: Partial<{ getDocument: jest.Mock; computeTotals: jest.Mock; getSettlement: jest.Mock }> = {},
    scopes: string[] | null = ['invoices:read'],
  ): ToolContext {
    return {
      companyId: 'company1',
      scopes,
      baseUrl: 'http://localhost:4000',
      services: {
        documentsService: {
          getDocument: jest.fn().mockResolvedValue({ id: 'd1', typeId: 'invoice', status: 'sent', data: {} }),
          computeTotals: jest.fn().mockResolvedValue({ netMinor: 1000, vatMinor: 200, grossMinor: 1200 }),
          getSettlement: jest.fn().mockResolvedValue({ totals: {}, payments: [], credits: [], warnings: [] }),
          ...overrides,
        } as any,
        shareLinksService: {} as any,
        clientsService: {} as any,
        articlesService: {} as any,
      },
    };
  }

  it('refuses a typeId this key holds no scope for, without ever calling DocumentsService', async () => {
    const getDocument = jest.fn();
    const ctx = buildContext({ getDocument }, ['clients:read']); // no invoices:*

    await expect(getDocumentTool.handler(ctx, { typeId: 'invoice', documentId: 'd1' })).rejects.toThrow(
      /invoices:read/,
    );
    expect(getDocument).not.toHaveBeenCalled();
  });

  it('fetches the document and its totals for a non-invoice type, WITHOUT ever fetching a settlement', async () => {
    const getSettlement = jest.fn();
    const ctx = buildContext({ getSettlement }, ['quotes:read']);

    const result = await getDocumentTool.handler(ctx, { typeId: 'quote', documentId: 'd1' });

    expect(getSettlement).not.toHaveBeenCalled();
    expect((result.structuredContent as any).settlement).toBeNull();
  });

  it('fetches the settlement TOO for an invoice', async () => {
    const getSettlement = jest
      .fn()
      .mockResolvedValue({ totals: {}, payments: [], credits: [], warnings: [] });
    const ctx = buildContext({ getSettlement });

    const result = await getDocumentTool.handler(ctx, { typeId: 'invoice', documentId: 'd1' });

    expect(getSettlement).toHaveBeenCalledWith('company1', 'invoice', 'd1');
    expect((result.structuredContent as any).settlement).not.toBeNull();
  });
});
