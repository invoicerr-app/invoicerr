import { listDocumentsTool } from './list-documents.tool';
import { ToolContext } from './types';

describe('listDocumentsTool', () => {
  function buildContext(listDocuments: jest.Mock, scopes: string[] | null = ['quotes:read']): ToolContext {
    return {
      companyId: 'company1',
      scopes,
      baseUrl: 'http://localhost:4000',
      services: {
        documentsService: { listDocuments } as any,
        shareLinksService: {} as any,
        clientsService: {} as any,
        articlesService: {} as any,
      },
    };
  }

  const doc = (id: string, status = 'draft') => ({
    id,
    typeId: 'quote',
    status,
    number: null,
    displayNumber: null,
    data: { client: 'client-1' },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  });

  it('refuses a typeId this key holds no scope for, without ever calling DocumentsService', async () => {
    const listDocuments = jest.fn();
    const ctx = buildContext(listDocuments, ['clients:read']); // no quotes:*

    await expect(listDocumentsTool.handler(ctx, { typeId: 'quote' })).rejects.toThrow(/quotes:read/);
    expect(listDocuments).not.toHaveBeenCalled();
  });

  it('lists documents of the requested type for the active company', async () => {
    const listDocuments = jest.fn().mockResolvedValue([doc('d1'), doc('d2', 'sent')]);
    const ctx = buildContext(listDocuments);

    const result = await listDocumentsTool.handler(ctx, { typeId: 'quote' });

    expect(listDocuments).toHaveBeenCalledWith('company1', 'quote');
    expect((result.structuredContent as any).documents).toEqual([
      expect.objectContaining({ id: 'd1', status: 'draft' }),
      expect.objectContaining({ id: 'd2', status: 'sent' }),
    ]);
  });

  it('applies the caller-chosen limit on top of whatever DocumentsService returned', async () => {
    const listDocuments = jest.fn().mockResolvedValue([doc('d1'), doc('d2'), doc('d3')]);
    const ctx = buildContext(listDocuments);

    const result = await listDocumentsTool.handler(ctx, { typeId: 'quote', limit: 2 });

    expect((result.structuredContent as any).documents).toHaveLength(2);
  });

  it('defaults to 20 when no limit is given', async () => {
    const documents = Array.from({ length: 30 }, (_, i) => doc(`d${i}`));
    const listDocuments = jest.fn().mockResolvedValue(documents);
    const ctx = buildContext(listDocuments);

    const result = await listDocumentsTool.handler(ctx, { typeId: 'quote' });

    expect((result.structuredContent as any).documents).toHaveLength(20);
  });
});
