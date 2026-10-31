/**
 * Buyer matching for the import pre-fill (issue #758): the same three outcomes the supplier matcher
 * already uses - one match, no match, or an ambiguity named rather than resolved. Prisma is mocked:
 * this spec proves the RULE, while `client-match.ts` itself contains no SQL beyond two bounded reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/prisma/prisma.service', () => ({
  default: {
    partyIdentifier: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
  },
}));

import prisma from '@/prisma/prisma.service';

import { matchBuyerClient } from './client-match';

const partyIdentifier = prisma.partyIdentifier as unknown as { findMany: ReturnType<typeof vi.fn> };
const client = prisma.client as unknown as { findMany: ReturnType<typeof vi.fn> };

describe('import/client-match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    partyIdentifier.findMany.mockResolvedValue([]);
    client.findMany.mockResolvedValue([]);
  });

  it('matches a VAT identifier after normalising spaces and case', async () => {
    partyIdentifier.findMany.mockResolvedValue([{ value: 'de 123 456 789', clientId: 'client-1' }]);

    await expect(matchBuyerClient('company-1', { vatId: 'DE123456789' })).resolves.toEqual({
      outcome: 'matched',
      clientId: 'client-1',
      matchedBy: 'vat',
    });
    expect(client.findMany).not.toHaveBeenCalled();
  });

  it('names an ambiguous VAT match instead of falling through to the weaker name rule', async () => {
    partyIdentifier.findMany.mockResolvedValue([
      { value: 'DE123456789', clientId: 'client-1' },
      { value: 'DE123456789', clientId: 'client-2' },
    ]);

    await expect(matchBuyerClient('company-1', { vatId: 'DE123456789', name: 'Acme' })).resolves.toEqual({
      outcome: 'ambiguous',
      matchedBy: 'vat',
      candidateIds: ['client-1', 'client-2'],
    });
    expect(client.findMany).not.toHaveBeenCalled();
  });

  it('falls back to an exact name when the VAT is a clean miss', async () => {
    partyIdentifier.findMany.mockResolvedValue([{ value: 'FR00000000000', clientId: 'other' }]);
    client.findMany.mockResolvedValue([{ id: 'client-9' }]);

    await expect(matchBuyerClient('company-1', { vatId: 'DE123456789', name: 'Acme GmbH' })).resolves.toEqual(
      {
        outcome: 'matched',
        clientId: 'client-9',
        matchedBy: 'name',
      },
    );
    expect(client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-1', name: 'Acme GmbH' }),
      }),
    );
  });

  it('reports no criteria when the file carries neither a VAT nor a buyer name', async () => {
    await expect(matchBuyerClient('company-1', {})).resolves.toEqual({
      outcome: 'unmatched',
      reason: 'no-criteria',
    });
  });

  it('reports not-found when criteria exist but nothing matches', async () => {
    await expect(matchBuyerClient('company-1', { name: 'Unknown Ltd' })).resolves.toEqual({
      outcome: 'unmatched',
      reason: 'not-found',
    });
  });
});
