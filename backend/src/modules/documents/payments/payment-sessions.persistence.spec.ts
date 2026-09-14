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
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    paymentCheckoutSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const create = prisma.paymentCheckoutSession.create as jest.Mock;
const findFirst = prisma.paymentCheckoutSession.findFirst as jest.Mock;
const findUnique = prisma.paymentCheckoutSession.findUnique as jest.Mock;
const update = prisma.paymentCheckoutSession.update as jest.Mock;
const updateMany = prisma.paymentCheckoutSession.updateMany as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
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
  it("looks up by the composite (providerId, providerSessionId) key, never by this row's own id", async () => {
    findUnique.mockResolvedValue(null);
    await findSessionByProviderRef('stripe', 'cs_1');

    expect(findUnique).toHaveBeenCalledWith({
      where: { providerId_providerSessionId: { providerId: 'stripe', providerSessionId: 'cs_1' } },
    });
  });
});

describe('claimSessionForCompletion', () => {
  it('wins the claim (count === 1) and returns the now-COMPLETED row', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue({ id: 'session-1', status: PaymentCheckoutSessionStatus.COMPLETED });

    const result = await claimSessionForCompletion('stripe', 'cs_1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { providerId: 'stripe', providerSessionId: 'cs_1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(result?.id).toBe('session-1');
  });

  it('loses the claim (count === 0, a replay or an unknown session) and returns null WITHOUT reading the row', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    const result = await claimSessionForCompletion('stripe', 'cs_1');

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
    await releaseSessionClaim('stripe', 'cs_1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { providerId: 'stripe', providerSessionId: 'cs_1', status: 'COMPLETED', paymentId: null },
      data: { status: 'PENDING', completedAt: null },
    });
  });
});

describe('markSessionFailed', () => {
  it('only ever moves a PENDING session to FAILED — never downgrades an already-COMPLETED one', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await markSessionFailed('stripe', 'cs_1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { providerId: 'stripe', providerSessionId: 'cs_1', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  });
});
