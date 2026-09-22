import { vi, type Mock } from 'vitest';

import { listDocumentsTool } from './list-documents.tool';
import { ToolContext } from './types';

describe('listDocumentsTool', () => {
  function buildContext(listDocuments: Mock, scopes: string[] | null = ['quotes:read']): ToolContext {
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
    const listDocuments = vi.fn();
    const ctx = buildContext(listDocuments, ['clients:read']); // no quotes:*

    await expect(listDocumentsTool.handler(ctx, { typeId: 'quote' })).rejects.toThrow(/quotes:read/);
    expect(listDocuments).not.toHaveBeenCalled();
  });

  it('lists documents of the requested type for the active company, one page sized to the default limit (20)', async () => {
    const listDocuments = vi
      .fn()
      .mockResolvedValue({ items: [doc('d1'), doc('d2', 'sent')], total: 2, page: 1, pageSize: 20 });
    const ctx = buildContext(listDocuments);

    const result = await listDocumentsTool.handler(ctx, { typeId: 'quote' });

    expect(listDocuments).toHaveBeenCalledWith('company1', 'quote', {
      page: 1,
      pageSize: 20,
      sort: 'updatedAt',
      order: 'desc',
    });
    expect((result.structuredContent as any).documents).toEqual([
      expect.objectContaining({ id: 'd1', status: 'draft' }),
      expect.objectContaining({ id: 'd2', status: 'sent' }),
    ]);
  });

  it('asks DocumentsService for exactly the caller-chosen limit as its own pageSize, never a separate client-side slice', async () => {
    const listDocuments = vi
      .fn()
      .mockResolvedValue({ items: [doc('d1'), doc('d2')], total: 9, page: 1, pageSize: 2 });
    const ctx = buildContext(listDocuments);

    const result = await listDocumentsTool.handler(ctx, { typeId: 'quote', limit: 2 });

    expect(listDocuments).toHaveBeenCalledWith('company1', 'quote', expect.objectContaining({ pageSize: 2 }));
    expect((result.structuredContent as any).documents).toHaveLength(2);
  });

  it('defaults pageSize to 20 when no limit is given', async () => {
    const items = Array.from({ length: 20 }, (_, i) => doc(`d${i}`));
    const listDocuments = vi.fn().mockResolvedValue({ items, total: 30, page: 1, pageSize: 20 });
    const ctx = buildContext(listDocuments);

    const result = await listDocumentsTool.handler(ctx, { typeId: 'quote' });

    expect(listDocuments).toHaveBeenCalledWith(
      'company1',
      'quote',
      expect.objectContaining({ pageSize: 20 }),
    );
    expect((result.structuredContent as any).documents).toHaveLength(20);
  });
});
