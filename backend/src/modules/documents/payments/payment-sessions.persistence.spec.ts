import { vi, type Mock } from 'vitest';
import prisma from '@/prisma/prisma.service';

import { PaymentCheckoutSessionStatus } from '../../../../prisma/generated/prisma/client';
import {
  attachSessionPayment,
  claimSessionForCompletion,
  createCheckoutSession,
  findOwnedSession,
  findPendingSessionForDocument,
  findSessionByProviderRef,
  markSessionFailed,
  releaseSessionClaim,
} from './payment-sessions.persistence';

/** Same manual-mock discipline as `bank-reconciliation/persistence.spec.ts` — a narrow, hand-rolled
 *  stand-in for exactly the Prisma delegate methods this file's own functions call, no more. */
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    paymentCheckoutSession: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

const create = prisma.paymentCheckoutSession.create as Mock;
const findFirst = prisma.paymentCheckoutSession.findFirst as Mock;
const findUnique = prisma.paymentCheckoutSession.findUnique as Mock;
const update = prisma.paymentCheckoutSession.update as Mock;
const updateMany = prisma.paymentCheckoutSession.updateMany as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createCheckoutSession', () => {
  it('creates the row verbatim from its input', async () => {
    const input = {
      companyId: 'company-1',
      documentId: 'doc-1',
      providerId: 'stripe',
      providerSessionId: 'cs_1',
      amountMinor: 12000,
      currency: 'EUR',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_1',
    };
    create.mockResolvedValue({ id: 'session-1', ...input, status: 'PENDING', paymentId: null });

    const result = await createCheckoutSession(input);

    expect(create).toHaveBeenCalledWith({ data: input });
    expect(result.id).toBe('session-1');
  });
});

describe('findPendingSessionForDocument', () => {
  it('scopes by company/document/provider and only ever asks for PENDING, most recent first', async () => {
    findFirst.mockResolvedValue(null);
    await findPendingSessionForDocument('company-1', 'doc-1', 'stripe');

    expect(findFirst).toHaveBeenCalledWith({
      where: { companyId: 'company-1', documentId: 'doc-1', providerId: 'stripe', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('findOwnedSession', () => {
  it('404s (rather than returning null) for a session unknown to this company', async () => {
    findFirst.mockResolvedValue(null);
    await expect(findOwnedSession('company-1', 'missing')).rejects.toThrow('not found');
  });

  it('returns the row when it belongs to this company', async () => {
    findFirst.mockResolvedValue({ id: 'session-1', companyId: 'company-1' });
    const result = await findOwnedSession('company-1', 'session-1');
    expect(result.id).toBe('session-1');
  });
});

describe('findSessionByProviderRef', () => {
  it('looks up by the composite (providerId, providerSessionId) key AND the company whose secret verified the event', async () => {
    findUnique.mockResolvedValue(null);
    await findSessionByProviderRef('company-1', 'stripe', 'cs_1');

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        providerId_providerSessionId: { providerId: 'stripe', providerSessionId: 'cs_1' },
      },
    });
  });
});

describe('claimSessionForCompletion', () => {
  it('wins the claim (count === 1) and returns the now-COMPLETED row', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue({ id: 'session-1', status: PaymentCheckoutSessionStatus.COMPLETED });

    const result = await claimSessionForCompletion('company-1', 'stripe', 'cs_1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', providerId: 'stripe', providerSessionId: 'cs_1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        providerId_providerSessionId: { providerId: 'stripe', providerSessionId: 'cs_1' },
      },
    });
    expect(result?.id).toBe('session-1');
  });

  it('loses the claim (count === 0, a replay or an unknown session) and returns null WITHOUT reading the row', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    const result = await claimSessionForCompletion('company-1', 'stripe', 'cs_1');

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('claims NOTHING when the session id belongs to another company — companyId is in the atomic WHERE, not a check after it', async () => {
    // Company A's secret signed the event, but `cs_B` is company B's session: the conditional UPDATE is
    // scoped by companyId, so it matches zero rows (the DB, not a later comparison, is what refuses).
    updateMany.mockResolvedValue({ count: 0 });

    const result = await claimSessionForCompletion('company-A', 'stripe', 'cs_B');

    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company-A', providerId: 'stripe', providerSessionId: 'cs_B', status: 'PENDING' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('attachSessionPayment', () => {
  it("sets paymentId by this row's own id", async () => {
    update.mockResolvedValue({});
    await attachSessionPayment('session-1', 'payment-1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'session-1' }, data: { paymentId: 'payment-1' } });
  });
});

describe('releaseSessionClaim', () => {
  it('only reverts a COMPLETED session with NO payment attached yet — never an already-finished one', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await releaseSessionClaim('company-1', 'stripe', 'cs_1');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        providerId: 'stripe',
        providerSessionId: 'cs_1',
        status: 'COMPLETED',
        paymentId: null,
      },
      data: { status: 'PENDING', completedAt: null },
    });
  });

  it("cannot release another company's claim — companyId scopes the rollback too", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await releaseSessionClaim('company-A', 'stripe', 'cs_B');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-A',
        providerId: 'stripe',
        providerSessionId: 'cs_B',
        status: 'COMPLETED',
        paymentId: null,
      },
      data: { status: 'PENDING', completedAt: null },
    });
  });
});

describe('markSessionFailed', () => {
  it('only ever moves a PENDING session to FAILED — never downgrades an already-COMPLETED one', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await markSessionFailed('company-1', 'stripe', 'cs_1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', providerId: 'stripe', providerSessionId: 'cs_1', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  });

  it("cannot fail another company's PENDING session — the forged checkout.failed denial-of-service is closed here", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await markSessionFailed('company-A', 'stripe', 'cs_B');

    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company-A', providerId: 'stripe', providerSessionId: 'cs_B', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  });
});
