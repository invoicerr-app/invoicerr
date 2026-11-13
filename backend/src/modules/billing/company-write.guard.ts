/**
 * Global `APP_GUARD`, registered only when billing is enabled, that refuses writes for a BLOCKED/ZIPPED
 * company and for a member without a seat. `@BillingGateExempt()` routes stay reachable so a blocked
 * company can still pay. The company check runs first so that reason surfaces before the seat one.
 *
 * The seat check uses `request.user.id` even for API keys: `AuthGuard` sets it to the key's holder, so a
 * member who lost their seat cannot keep writing through a key created while seated.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RequestWithUser } from '@/types/request';

import { BILLING_GATE_EXEMPT_KEY } from './billing-gate-exempt.decorator';
import { assertUserHasSeatOrThrow } from './seat-gate';
import { assertCompanyWritable } from './write-gate';

/** Compared case-sensitively; Express/Nest report `request.method` upper-case. */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CompanyWriteGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest() as RequestWithUser;

    if (READ_ONLY_METHODS.has(request.method)) return true;
    if (!request.companyId) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(BILLING_GATE_EXEMPT_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    await assertCompanyWritable(request.companyId);
    if (request.user?.id) {
      await assertUserHasSeatOrThrow(request.companyId, request.user.id);
    }
    return true;
  }
}
