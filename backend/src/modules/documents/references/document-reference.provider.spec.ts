import { NotFoundException } from '@nestjs/common';

import { buildDocumentReferenceProvider } from './document-reference.provider';
import * as persistence from '../persistence';

jest.mock('../persistence');

/**
 * This provider is what a document type's own reference fields resolve and search through — the
 * invoice's "origin" (invoice.descriptor.ts) and the credit note's "invoice" (credit-note.descriptor.ts)
 * both go through it, each for a different `typeId`. Only the DocumentInstance persistence boundary is
 * mocked, same discipline as documents.service.spec.ts.
 *
 * Generic on purpose: this used to be quote-reference.provider.ts, hard-coded to "quote" — the tests
 * below run the SAME suite against 'quote' and 'invoice' typeIds to prove the factory itself never
 * assumes which one it is, the same way field-kinds.spec.ts proves a plugin-registered kind validates
 * exactly like a core one.
 */
describe.each([
  { typeId: 'quote', typeLabel: 'Quote' },
  { typeId: 'invoice', typeLabel: 'Invoice' },
])('buildDocumentReferenceProvider("$typeId")', ({ typeId, typeLabel }) => {
  afterEach(() => jest.resetAllMocks());

  function document(id: string, data: unknown) {
    return { id, typeId, status: 'draft', data, createdAt: new Date(), updatedAt: new Date() };
  }

  describe('search', () => {
    it('labels each result from its client name and issue date, never a computed total', async () => {
      (persistence.listDocuments as jest.Mock).mockResolvedValue([
        document('d1', { client: 'client-1', issueDate: '2026-01-15', lines: [] }),
      ]);
      const clientsService = { getClientById: jest.fn().mockResolvedValue({ name: 'Acme Corp' }) };

      const provider = buildDocumentReferenceProvider(typeId, typeLabel, clientsService as never);
      const results = await provider.search('company-1', '');

      expect(results).toEqual([{ id: 'd1', label: 'Acme Corp — 2026-01-15' }]);
      expect(clientsService.getClientById).toHaveBeenCalledWith('company-1', 'client-1');
    });

    it('falls back to a labeled id when the document has no client, or the client is gone', async () => {
      (persistence.listDocuments as jest.Mock).mockResolvedValue([document('d1', {})]);
      const clientsService = { getClientById: jest.fn() };

      const provider = buildDocumentReferenceProvider(typeId, typeLabel, clientsService as never);
      const results = await provider.search('company-1', '');

      expect(results).toEqual([{ id: 'd1', label: `${typeLabel} d1` }]);
      expect(clientsService.getClientById).not.toHaveBeenCalled();
    });

    it('filters in memory by the resolved label when a query is given', async () => {
      (persistence.listDocuments as jest.Mock).mockResolvedValue([
        document('d1', { client: 'client-1', issueDate: '2026-01-15' }),
        document('d2', { client: 'client-2', issueDate: '2026-02-01' }),
      ]);
      const clientsService = {
        getClientById: jest
          .fn()
          .mockResolvedValueOnce({ name: 'Acme Corp' })
          .mockResolvedValueOnce({ name: 'Widget Inc' }),
      };

      const provider = buildDocumentReferenceProvider(typeId, typeLabel, clientsService as never);
      const results = await provider.search('company-1', 'acme');

      expect(results).toEqual([{ id: 'd1', label: 'Acme Corp — 2026-01-15' }]);
    });

    it('is scoped to the calling company AND the given type through persistence.listDocuments', async () => {
      (persistence.listDocuments as jest.Mock).mockResolvedValue([]);
      const provider = buildDocumentReferenceProvider(typeId, typeLabel, {
        getClientById: jest.fn(),
      } as never);

      await provider.search('company-1', '');

      expect(persistence.listDocuments).toHaveBeenCalledWith('company-1', typeId);
    });
  });

  describe('resolve', () => {
    it('resolves an existing document to its label', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
        document('d1', { client: 'client-1', issueDate: '2026-01-15' }),
      );
      const clientsService = { getClientById: jest.fn().mockResolvedValue({ name: 'Acme Corp' }) };

      const provider = buildDocumentReferenceProvider(typeId, typeLabel, clientsService as never);
      const result = await provider.resolve('company-1', 'd1');

      expect(result).toEqual({ id: 'd1', label: 'Acme Corp — 2026-01-15' });
      expect(persistence.findOwnedDocument).toHaveBeenCalledWith('company-1', typeId, 'd1');
    });

    it('returns null (not an error) for an id that does not resolve for this company', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(new NotFoundException('nope'));
      const provider = buildDocumentReferenceProvider(typeId, typeLabel, {
        getClientById: jest.fn(),
      } as never);

      await expect(provider.resolve('company-1', 'missing')).resolves.toBeNull();
    });

    it('lets a non-NotFound error propagate instead of swallowing it', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(new Error('db is down'));
      const provider = buildDocumentReferenceProvider(typeId, typeLabel, {
        getClientById: jest.fn(),
      } as never);

      await expect(provider.resolve('company-1', 'd1')).rejects.toThrow('db is down');
    });
  });
});
