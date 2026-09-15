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
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { RequestWithUser } from '@/types/request';

import { assertCompanyWritable } from './write-gate';

/** HTTP methods this guard never gates — read-only by construction. Checked case-sensitively against
 *  `request.method`, which Express/Nest always report upper-case. */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CompanyWriteGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest() as RequestWithUser;

    if (READ_ONLY_METHODS.has(request.method)) return true;
    if (!request.companyId) return true;

    await assertCompanyWritable(request.companyId);
    return true;
  }
}
