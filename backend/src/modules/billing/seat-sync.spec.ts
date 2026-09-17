import prisma from '@/prisma/prisma.service';

import { BILLING_FLAG_NAME } from './billing-flag';
import { getOrCreateCompanySubscription, lockCompanySubscriptionRow } from './company-subscription.store';
import { countCompanySeats, NoFreeSeatError, withSeatReservation } from './seat-sync';

/** A fake interactive-transaction client — `prisma.$transaction(async (tx) => ...)` hands the callback
 *  this shape instead of the real `Prisma.TransactionClient`, the same "narrow, hand-rolled fake" every
 *  other billing spec uses. */
function fakeTx(overrides: {
  alreadyMember?: boolean;
  sub?: { seats: number };
  headcount?: number;
  usedSeatIndexes?: (number | null)[];
}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'sub-row-1' }]),
    userCompany: {
      findUnique: jest.fn().mockResolvedValue(overrides.alreadyMember ? { id: 'existing-row' } : null),
      count: jest.fn().mockResolvedValue(overrides.headcount ?? 0),
      findMany: jest
        .fn()
        .mockResolvedValue((overrides.usedSeatIndexes ?? []).map((seatIndex) => ({ seatIndex }))),
      update: jest.fn().mockResolvedValue({}),
    },
    companySubscription: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(overrides.sub ?? { seats: 1 }),
    },
  };
}

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    userCompany: { count: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('./company-subscription.store');

const count = prisma.userCompany.count as jest.Mock;
const transaction = prisma.$transaction as jest.Mock;
const getOrCreate = getOrCreateCompanySubscription as jest.Mock;
const lockRow = lockCompanySubscriptionRow as jest.Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

/** Wires `prisma.$transaction` to actually invoke its callback against a fresh `fakeTx` — returns the
 *  `tx` so a test can assert against its mocks. */
function stubTransaction(overrides: Parameters<typeof fakeTx>[0] = {}) {
  const tx = fakeTx(overrides);
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
  return tx;
}

describe('withSeatReservation', () => {
  beforeEach(() => {
    process.env[BILLING_FLAG_NAME] = 'true';
  });

  afterEach(() => {
    jest.resetAllMocks();
    if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
  });

  it('is a no-op wrapper when billing is disabled — still runs createMembership, no lock, no seat bookkeeping', async () => {
    delete process.env[BILLING_FLAG_NAME];
    const createMembership = jest.fn().mockResolvedValue('created');
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));

    await expect(withSeatReservation('company-1', 'user-1', createMembership)).resolves.toBe('created');

    expect(getOrCreate).not.toHaveBeenCalled();
    expect(createMembership).toHaveBeenCalledTimes(1);
  });

  it('refuses with NoFreeSeatError when the company already has as many members as bought seats', async () => {
    getOrCreate.mockResolvedValue({});
    stubTransaction({ alreadyMember: false, sub: { seats: 2 }, headcount: 2 });
    const createMembership = jest.fn().mockResolvedValue('created');

    const action = withSeatReservation('company-1', 'user-1', createMembership);

    await expect(action).rejects.toBeInstanceOf(NoFreeSeatError);
    await expect(action).rejects.toMatchObject({ code: 'NO_FREE_SEAT' });
    expect(createMembership).not.toHaveBeenCalled();
  });

  it('assigns the lowest free seatIndex to a genuinely new membership', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({
      alreadyMember: false,
      sub: { seats: 5 },
      headcount: 2,
      usedSeatIndexes: [1, 3],
    });
    const createMembership = jest.fn().mockResolvedValue('created');

    await withSeatReservation('company-1', 'user-2', createMembership);

    expect(createMembership).toHaveBeenCalledWith(tx);
    expect(tx.userCompany.update).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: 'user-2', companyId: 'company-1' } },
      data: { seatIndex: 2 },
    });
  });

  it('assigns desk 1 for a brand-new company (no seats taken yet)', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({
      alreadyMember: false,
      sub: { seats: 1 },
      headcount: 0,
      usedSeatIndexes: [],
    });
    const createMembership = jest.fn().mockResolvedValue('created');

    await withSeatReservation('company-1', 'owner-1', createMembership);

    expect(tx.userCompany.update).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: 'owner-1', companyId: 'company-1' } },
      data: { seatIndex: 1 },
    });
  });

  it('re-opening a link for an ALREADY-member user is a no-op: no capacity check, no seatIndex reassignment', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({ alreadyMember: true });
    const createMembership = jest.fn().mockResolvedValue('updated');

    await withSeatReservation('company-1', 'user-1', createMembership);

    expect(tx.companySubscription.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.userCompany.update).not.toHaveBeenCalled();
    expect(createMembership).toHaveBeenCalledWith(tx);
  });

  it('holds a row lock (via the shared lockCompanySubscriptionRow) for the whole check-then-create-then-assign sequence', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({ alreadyMember: false, sub: { seats: 5 }, headcount: 0 });

    await withSeatReservation('company-1', 'user-1', jest.fn().mockResolvedValue(undefined));

    expect(lockRow).toHaveBeenCalledWith(tx, 'company-1');
  });
});

describe('countCompanySeats', () => {
  afterEach(() => jest.resetAllMocks());

  it('counts UserCompany rows for the company', async () => {
    count.mockResolvedValue(5);
    await expect(countCompanySeats('company-1')).resolves.toBe(5);
    expect(count).toHaveBeenCalledWith({ where: { companyId: 'company-1' } });
  });
});
