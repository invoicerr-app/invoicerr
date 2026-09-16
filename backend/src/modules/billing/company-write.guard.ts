/**
 * The single, generic hook that applies `write-gate.ts#assertCompanyWritable` to every write —
 * registered as a global `APP_GUARD` (`app.module.ts`), ONLY when billing is enabled (the same
 * `...(billingEnabled ? [...] : [])` conditional `BillingModule` itself is registered with), so its
 * existence is structural, not merely a runtime no-op — see `write-gate.ts`'s own header for the full
 * exemption list this guard implements (GET/HEAD/OPTIONS, no active company on the request, and why
 * `/api/auth/*` — including Polar's checkout/portal — never reaches this at all).
 *
 * Runs alongside, not instead of, `AuthGuard`/`RolesGuard`: Nest ANDs every registered `APP_GUARD`
 * (the same "adds a check rather than replacing" relationship `app.module.ts`'s own comment on
 * `ThrottlerGuard` describes), and by the time this guard runs `request.companyId` is already
 * populated by `AuthGuard` (or left `null`/`undefined` for a route with no active company).
 *
 * One route-level exemption on top of the method/companyId ones above: `@BillingGateExempt()`
 * (`billing-gate-exempt.decorator.ts`) — see that file's own header for why `POST /billing/checkout`/
 * `/billing/portal` must stay reachable for a blocked company; the same exemption also covers the
 * seat check below (an OWNER/ADMIN buying more seats must stay reachable even while, in the
 * degenerate case, THEY are somehow the one waiting).
 *
 * Also applies `seat-gate.ts#assertUserHasSeatOrThrow` — a member who has lost their seat (an
 * over-capacity company) is refused every write the same way a BLOCKED company is, named
 * `SEAT_REQUIRED` rather than `COMPANY_BLOCKED`. Checked AFTER `assertCompanyWritable`: a company that
 * is itself BLOCKED/ZIPPED should surface that reason first, regardless of the caller's own seat.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RequestWithUser } from '@/types/request';

import { BILLING_GATE_EXEMPT_KEY } from './billing-gate-exempt.decorator';
import { assertUserHasSeatOrThrow } from './seat-gate';
import { assertCompanyWritable } from './write-gate';

/** HTTP methods this guard never gates — read-only by construction. Checked case-sensitively against
 *  `request.method`, which Express/Nest always report upper-case. */
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
