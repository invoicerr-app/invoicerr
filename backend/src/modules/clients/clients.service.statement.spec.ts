/**
 * TODO_FEATURES.md rank 6 ("relevé de compte client") — `ClientsService.getStatement`'s own
 * tenant-isolation guard. Prisma MOCKED here (unlike `clients.vat-validation.spec.ts`/
 * `clients.supplier-role.spec.ts`, which use a real database): this file tests exactly ONE thing —
 * that a client id belonging to a DIFFERENT company is refused BEFORE `resolveClientStatement` ever
 * runs, never a real aggregation, so it has no business paying for a database round-trip (same
 * discipline archive/persistence.spec.ts already holds for its own Prisma-facing tests).
 */
jest.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: jest.fn(),
}));
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    client: { findFirst: jest.fn() },
  },
}));
jest.mock('../documents/settlement/client-statement', () => ({
  resolveClientStatement: jest.fn(),
}));

import { NotFoundException } from '@nestjs/common';
import prisma from '@/prisma/prisma.service';

import { ClientsService } from './clients.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { VatValidationPort } from '../documents/tax/vat-validation';
import { resolveClientStatement } from '../documents/settlement/client-statement';

const findFirstClient = prisma.client.findFirst as jest.Mock;
const resolveStatement = resolveClientStatement as jest.Mock;

const fakeWebhookDispatcher = {
  dispatch: jest.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

const fakeVatValidator: VatValidationPort = {
  validate: jest.fn(),
};

describe('ClientsService.getStatement — tenant isolation', () => {
  let service: ClientsService;

  beforeEach(() => {
    findFirstClient.mockReset();
    resolveStatement.mockReset();
    service = new ClientsService(fakeWebhookDispatcher, fakeVatValidator);
  });

  it('404s for a client id that does not belong to the active company — never reaches resolveClientStatement', async () => {
    // Simulates the exact attack this guard exists for: a client that IS real, but belongs to
    // ANOTHER company — `prisma.client.findFirst` is scoped by BOTH `id` AND `companyId`
    // (clients.service.ts's own `getStatement`), so it resolves null here exactly as it would for a
    // company that owns no such client at all — the two cases are indistinguishable from outside,
    // which is the point (same discipline persistence.ts's own `findOwnedDocument` documents).
    findFirstClient.mockResolvedValue(null);

    await expect(service.getStatement('company-mine', 'client-someone-elses')).rejects.toThrow(
      NotFoundException,
    );

    expect(findFirstClient).toHaveBeenCalledWith({
      where: { id: 'client-someone-elses', companyId: 'company-mine' },
    });
    // The whole point: a company-scoped miss must short-circuit before any invoice is ever read —
    // a mutation removing this guard would let resolveClientStatement run regardless and fail this.
    expect(resolveStatement).not.toHaveBeenCalled();
  });

  it('delegates to resolveClientStatement once the client is confirmed to belong to this company', async () => {
    findFirstClient.mockResolvedValue({ id: 'client-1', companyId: 'company-mine' });
    const fakeStatement = { clientId: 'client-1', documents: [], totals: [] };
    resolveStatement.mockResolvedValue(fakeStatement);

    const result = await service.getStatement('company-mine', 'client-1');

    expect(resolveStatement).toHaveBeenCalledWith('company-mine', 'client-1');
    expect(result).toBe(fakeStatement);
  });
});
