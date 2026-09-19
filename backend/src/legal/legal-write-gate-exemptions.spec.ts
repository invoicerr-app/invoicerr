import { vi, type Mock } from 'vitest';

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { LEGAL_ACCEPTANCE_REQUIRED_CODE, LegalAcceptanceGuard } from './legal-acceptance.guard';
import { getPendingAcceptanceSlugs } from './legal-acceptance';

import { CompaniesController } from '@/modules/companies/companies.controller';
import { DangerController } from '@/modules/danger/danger.controller';
import { BillingController } from '@/modules/billing/billing.controller';

vi.mock('./legal-acceptance');

const getPending = getPendingAcceptanceSlugs as Mock;

/**
 * Drives `LegalAcceptanceGuard` against the REAL controller classes and their REAL prototype methods —
 * never a stand-in — so `Reflector.getAllAndOverride` reads whatever `@LegalGateExempt()` metadata is
 * actually attached to each route, proving the read/export/termination exemption list this guard's own
 * header describes rather than merely re-testing the guard's mechanics in isolation (already covered
 * by `legal-acceptance.guard.spec.ts`). Mirrors
 * `modules/company/transfer/account-transfers.controller.spec.ts`'s own shape for the identical reason.
 */
function buildContext(
  method: string,
  handler: (...args: never[]) => unknown,
  klass: unknown,
): ExecutionContext {
  const request = { method, user: { id: 'user-1' } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => klass,
  } as unknown as ExecutionContext;
}

describe('LegalAcceptanceGuard — write-gate exemption wiring (read/export/termination routes)', () => {
  afterEach(() => vi.clearAllMocks());

  describe.each([
    ['CompaniesController#exportData', 'POST', CompaniesController.prototype.exportData, CompaniesController],
    ['CompaniesController#leave', 'DELETE', CompaniesController.prototype.leave, CompaniesController],
    ['DangerController#requestOtp', 'POST', DangerController.prototype.requestOtp, DangerController],
    ['DangerController#deleteCompany', 'POST', DangerController.prototype.deleteCompany, DangerController],
    ['BillingController#openPortal', 'POST', BillingController.prototype.openPortal, BillingController],
    [
      'BillingController#openLegacyPortal',
      'POST',
      BillingController.prototype.openLegacyPortal,
      BillingController,
    ],
    // The one route this guard MUST always let through regardless of what else is exempt — see
    // `legal-acceptance.guard.spec.ts` for the generic version of this same case.
  ])('%s carries @LegalGateExempt()', (_name, method, handler, klass) => {
    it('is reached even with a pending re-acceptance', async () => {
      getPending.mockResolvedValue(['terms-of-service']);
      const guard = new LegalAcceptanceGuard(new Reflector());

      await expect(guard.canActivate(buildContext(method as string, handler as never, klass))).resolves.toBe(
        true,
      );
      // Never even queries pending state — same short-circuit `POST /legal/accept` gets.
      expect(getPending).not.toHaveBeenCalled();
    });
  });

  describe.each([
    [
      'DangerController#resetCompanyData',
      'POST',
      DangerController.prototype.resetCompanyData,
      DangerController,
    ],
    ['BillingController#startCheckout', 'POST', BillingController.prototype.startCheckout, BillingController],
  ])('%s carries NO exemption — it changes what the account holds while the relationship continues', (_name, method, handler, klass) => {
    it('is refused with a pending re-acceptance, same as any other business write', async () => {
      getPending.mockResolvedValue(['terms-of-service']);
      const guard = new LegalAcceptanceGuard(new Reflector());

      const action = guard.canActivate(buildContext(method as string, handler as never, klass));

      await expect(action).rejects.toBeInstanceOf(ForbiddenException);
      const error = await action.catch((e) => e);
      expect(error.getResponse()).toMatchObject({ code: LEGAL_ACCEPTANCE_REQUIRED_CODE });
    });

    it('is reached once nothing is pending', async () => {
      getPending.mockResolvedValue([]);
      const guard = new LegalAcceptanceGuard(new Reflector());

      await expect(guard.canActivate(buildContext(method as string, handler as never, klass))).resolves.toBe(
        true,
      );
    });
  });
});
