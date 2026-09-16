import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { BillingGateExempt } from './billing-gate-exempt.decorator';
import { BILLING_FLAG_NAME } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { CompanyWriteGuard } from './company-write.guard';
import { assertUserHasSeatOrThrow } from './seat-gate';

jest.mock('./company-subscription.store');
jest.mock('./seat-gate');

const getOrCreate = getOrCreateCompanySubscription as jest.Mock;
const assertSeat = assertUserHasSeatOrThrow as jest.Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

// `userId: null` (never a bare `undefined` argument — JS default parameters trigger on `undefined`,
// which would silently fall back to `'user-1'` instead of producing a userless request) means "no
// user on this request".
function createContext(
  method: string,
  companyId: string | null | undefined,
  handler: (...args: unknown[]) => unknown = () => undefined,
  userId: string | null = 'user-1',
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, companyId, user: userId ? { id: userId } : undefined }),
    }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('CompanyWriteGuard', () => {
  const guard = new CompanyWriteGuard(new Reflector());

  afterEach(() => {
    jest.resetAllMocks();
    if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
  });

  it.each([
    'GET',
    'HEAD',
    'OPTIONS',
  ])('always allows a %s request, even for a blocked company', async (method) => {
    process.env[BILLING_FLAG_NAME] = 'true';
    getOrCreate.mockResolvedValue({ status: 'BLOCKED' });
    await expect(guard.canActivate(createContext(method, 'company-1'))).resolves.toBe(true);
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it('allows a write with no active company on the request', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    await expect(guard.canActivate(createContext('POST', null))).resolves.toBe(true);
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it('is a no-op when billing is disabled — a write passes even for what would be a blocked company', async () => {
    delete process.env[BILLING_FLAG_NAME];
    await expect(guard.canActivate(createContext('POST', 'company-1'))).resolves.toBe(true);
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  describe('when billing is enabled', () => {
    beforeEach(() => {
      process.env[BILLING_FLAG_NAME] = 'true';
    });

    it('allows a write from a TRIAL/ACTIVE company', async () => {
      getOrCreate.mockResolvedValue({ status: 'ACTIVE' });
      await expect(guard.canActivate(createContext('POST', 'company-1'))).resolves.toBe(true);
      expect(assertSeat).toHaveBeenCalledWith('company-1', 'user-1');
    });

    it('refuses a write from a user with no free seat, named SEAT_REQUIRED', async () => {
      getOrCreate.mockResolvedValue({ status: 'ACTIVE' });
      assertSeat.mockRejectedValue(
        new ForbiddenException({ message: 'no free seat', code: 'SEAT_REQUIRED' }),
      );
      const err = await guard.canActivate(createContext('POST', 'company-1')).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'SEAT_REQUIRED' });
    });

    it('never checks the seat when the request carries no user (should not normally happen this far)', async () => {
      getOrCreate.mockResolvedValue({ status: 'ACTIVE' });
      await expect(
        guard.canActivate(createContext('POST', 'company-1', () => undefined, null)),
      ).resolves.toBe(true);
      expect(assertSeat).not.toHaveBeenCalled();
    });

    it('refuses a write from a BLOCKED company, named COMPANY_BLOCKED', async () => {
      getOrCreate.mockResolvedValue({ status: 'BLOCKED' });
      const err = await guard.canActivate(createContext('DELETE', 'company-1')).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'COMPANY_BLOCKED' });
    });

    it('refuses a write from a ZIPPED company, named COMPANY_BLOCKED', async () => {
      getOrCreate.mockResolvedValue({ status: 'ZIPPED' });
      const err = await guard.canActivate(createContext('PATCH', 'company-1')).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'COMPANY_BLOCKED' });
    });

    it('lets a @BillingGateExempt() route through even for a BLOCKED company — checkout/portal must stay reachable', async () => {
      getOrCreate.mockResolvedValue({ status: 'BLOCKED' });

      class FakeController {
        @BillingGateExempt()
        checkout() {
          return undefined;
        }
      }
      const controller = new FakeController();

      await expect(guard.canActivate(createContext('POST', 'company-1', controller.checkout))).resolves.toBe(
        true,
      );
      expect(getOrCreate).not.toHaveBeenCalled();
    });
  });
});
