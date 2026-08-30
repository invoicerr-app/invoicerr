import { NotFoundException } from '@nestjs/common';

import { buildQuoteReferenceProvider } from './quote-reference.provider';
import * as persistence from '../persistence';

jest.mock('../persistence');

/**
 * This provider is what the invoice's "origin quote" field resolves and searches through
 * (invoice.descriptor.ts) — the first EntityReferenceProvider in this codebase that targets another
 * document TYPE's own instances instead of a business entity from an existing service. Only the
 * DocumentInstance persistence boundary is mocked, same discipline as documents.service.spec.ts.
 */
describe('buildQuoteReferenceProvider', () => {
  afterEach(() => jest.resetAllMocks());

  function quote(id: string, data: unknown) {
    return { id, typeId: 'quote', status: 'draft', data, createdAt: new Date(), updatedAt: new Date() };
  }

  describe('search', () => {
    it('labels each result from its client name and issue date, never a computed total', async () => {
      (persistence.listDocuments as jest.Mock).mockResolvedValue([
        quote('q1', { client: 'client-1', issueDate: '2026-01-15', lines: [] }),
      ]);
      const clientsService = { getClientById: jest.fn().mockResolvedValue({ name: 'Acme Corp' }) };

      const provider = buildQuoteReferenceProvider(clientsService as never);
      const results = await provider.search('company-1', '');

      expect(results).toEqual([{ id: 'q1', label: 'Acme Corp — 2026-01-15' }]);
      expect(clientsService.getClientById).toHaveBeenCalledWith('company-1', 'client-1');
    });

    it('falls back to the bare id when the quote has no client, or the client is gone', async () => {
      (persistence.listDocuments as jest.Mock).mockResolvedValue([quote('q1', {})]);
      const clientsService = { getClientById: jest.fn() };

      const provider = buildQuoteReferenceProvider(clientsService as never);
      const results = await provider.search('company-1', '');

      expect(results).toEqual([{ id: 'q1', label: 'Quote q1' }]);
      expect(clientsService.getClientById).not.toHaveBeenCalled();
    });

    it('filters in memory by the resolved label when a query is given', async () => {
      (persistence.listDocuments as jest.Mock).mockResolvedValue([
        quote('q1', { client: 'client-1', issueDate: '2026-01-15' }),
        quote('q2', { client: 'client-2', issueDate: '2026-02-01' }),
      ]);
      const clientsService = {
        getClientById: jest
          .fn()
          .mockResolvedValueOnce({ name: 'Acme Corp' })
          .mockResolvedValueOnce({ name: 'Widget Inc' }),
      };

      const provider = buildQuoteReferenceProvider(clientsService as never);
      const results = await provider.search('company-1', 'acme');

      expect(results).toEqual([{ id: 'q1', label: 'Acme Corp — 2026-01-15' }]);
    });

    it('is scoped to the calling company through persistence.listDocuments', async () => {
      (persistence.listDocuments as jest.Mock).mockResolvedValue([]);
      const provider = buildQuoteReferenceProvider({ getClientById: jest.fn() } as never);

      await provider.search('company-1', '');

      expect(persistence.listDocuments).toHaveBeenCalledWith('company-1', 'quote');
    });
  });

  describe('resolve', () => {
    it('resolves an existing quote to its label', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
        quote('q1', { client: 'client-1', issueDate: '2026-01-15' }),
      );
      const clientsService = { getClientById: jest.fn().mockResolvedValue({ name: 'Acme Corp' }) };

      const provider = buildQuoteReferenceProvider(clientsService as never);
      const result = await provider.resolve('company-1', 'q1');

      expect(result).toEqual({ id: 'q1', label: 'Acme Corp — 2026-01-15' });
      expect(persistence.findOwnedDocument).toHaveBeenCalledWith('company-1', 'quote', 'q1');
    });

    it('returns null (not an error) for an id that does not resolve for this company', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(new NotFoundException('nope'));
      const provider = buildQuoteReferenceProvider({ getClientById: jest.fn() } as never);

      await expect(provider.resolve('company-1', 'missing')).resolves.toBeNull();
    });

    it('lets a non-NotFound error propagate instead of swallowing it', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(new Error('db is down'));
      const provider = buildQuoteReferenceProvider({ getClientById: jest.fn() } as never);

      await expect(provider.resolve('company-1', 'q1')).rejects.toThrow('db is down');
    });
  });
});
