import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { LEGAL_ACCEPTANCE_REQUIRED_CODE, LegalAcceptanceGuard } from '@/legal/legal-acceptance.guard';
import { getPendingAcceptanceSlugs } from '@/legal/legal-acceptance';

import { AccountTransfersController } from './account-transfers.controller';
import { TransferService } from './transfer.service';

jest.mock('@/legal/legal-acceptance');

const getPending = getPendingAcceptanceSlugs as jest.Mock;

function buildContext(method: string, userId: string): ExecutionContext {
  const request = { method, user: { id: userId } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    // The REAL controller class and its REAL prototype method — not a stand-in — so
    // `Reflector.getAllAndOverride` reads whatever `@LegalGateExempt()` metadata (if any) is actually
    // attached to THIS route, proving the structural claim in `account-transfers.controller.ts`'s own
    // header rather than merely re-testing `LegalAcceptanceGuard` in isolation (already covered by
    // `legal-acceptance.guard.spec.ts`).
    getHandler: () => AccountTransfersController.prototype.accept,
    getClass: () => AccountTransfersController,
  } as unknown as ExecutionContext;
}

describe('AccountTransfersController — accept is reached by the global legal-acceptance gate', () => {
  afterEach(() => jest.clearAllMocks());

  it('POST :id/accept carries no @LegalGateExempt() — a pending re-acceptance refuses it, in SaaS mode', async () => {
    getPending.mockResolvedValue(['terms-of-service']);
    const guard = new LegalAcceptanceGuard(new Reflector());

    const action = guard.canActivate(buildContext('POST', 'user-1'));

    await expect(action).rejects.toBeInstanceOf(ForbiddenException);
    const error = await action.catch((e) => e);
    expect(error.getResponse()).toMatchObject({ code: LEGAL_ACCEPTANCE_REQUIRED_CODE });
  });

  it('lets the same route through once nothing is pending', async () => {
    getPending.mockResolvedValue([]);
    const guard = new LegalAcceptanceGuard(new Reflector());

    await expect(guard.canActivate(buildContext('POST', 'user-1'))).resolves.toBe(true);
  });
});

describe('AccountTransfersController — delegation', () => {
  it('lists transfers addressed to the caller', async () => {
    const listReceivedTransfers = jest.fn().mockResolvedValue([{ id: 't1' }]);
    const controller = new AccountTransfersController({
      listReceivedTransfers,
    } as unknown as TransferService);

    const result = await controller.mine({ id: 'user-1' } as never);

    expect(listReceivedTransfers).toHaveBeenCalledWith('user-1');
    expect(result).toEqual([{ id: 't1' }]);
  });

  it('accepts as the caller, never a body-supplied user id', async () => {
    const acceptTransfer = jest.fn().mockResolvedValue({ success: true });
    const controller = new AccountTransfersController({ acceptTransfer } as unknown as TransferService);

    await controller.accept('transfer-1', { id: 'user-1' } as never);

    expect(acceptTransfer).toHaveBeenCalledWith('transfer-1', 'user-1');
  });
});
