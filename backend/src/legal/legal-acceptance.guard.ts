/**
 * `requiresAcceptance`/`pending` (`legal.service.ts#getStatus`) used to be purely INFORMATIONAL: no
 * guard anywhere actually refused a request once a document's content changed and the caller had not
 * re-accepted it. The frontend's own sign-in interstitial (`pages/legal/accept.tsx`) is a courtesy, not
 * a boundary — closing it, calling the API directly, or driving it through an API key all kept working
 * regardless, which defeats the entire purpose of a mechanism whose only reason to exist is proof of
 * consent.
 *
 * Registered as a global `APP_GUARD` in `app.module.ts`, ONLY when `isBillingEnabled()` — the exact
 * same `...(billingEnabled ? [...] : [])` conditional `CompanyWriteGuard` is registered with, and for
 * the same reason: self-hosted has nothing to accept in the first place
 * (`legal-signup-policy.ts`'s own header), so this guard's absence there is structural, not a
 * runtime no-op. Runs alongside `AuthGuard`/`RolesGuard`/`ThrottlerGuard`/`CompanyWriteGuard` — Nest
 * ANDs every registered `APP_GUARD` (`app.module.ts`'s own comment on `ThrottlerGuard` describes the
 * relationship), so this only ever ADDS a check.
 *
 * Exemptions, deliberately narrow:
 *  - read-only methods (GET/HEAD/OPTIONS) — a pending acceptance blocks doing things with the
 *    product, never looking at it (including the interstitial's own `GET /legal/status` read);
 *  - no authenticated user on the request at all (`request.user`) — `/api/auth/*` never reaches this
 *    guard regardless (mounted as raw middleware ahead of Nest's router entirely, the same reason
 *    `ThrottlerGuard` misses it, see `lib/auth-rate-limit.ts`'s own header), and every `/api/portal/*`
 *    client-portal route is `@Public()` from `AuthGuard`'s own point of view — its bearer-token
 *    identity is never written to `request.user` (see `portal-auth.guard.ts`'s own header) — so this
 *    check is what naturally leaves the public portal untouched, with no route-by-route exemption
 *    needed;
 *  - `@LegalGateExempt()` — exactly one route carries it: `POST /legal/accept`, the one write that
 *    must stay reachable to ever CLEAR the pending state this guard enforces.
 *
 * Deliberately covers an API-key-authenticated request the identical way it covers a session one
 * (`AuthGuard` sets `request.user` for both) — the exact gap the "quiconque... utilise une clé d'API"
 * finding named: automation must not be a way to keep using the product while a required re-acceptance
 * sits unanswered.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RequestWithUser } from '@/types/request';
import { LEGAL_ACCEPTANCE_REQUIRED_CODE } from '@/lib/legal-signup-policy';

import { getPendingAcceptanceSlugs } from './legal-acceptance';
import { LEGAL_GATE_EXEMPT_KEY } from './legal-gate-exempt.decorator';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export { LEGAL_ACCEPTANCE_REQUIRED_CODE };

@Injectable()
export class LegalAcceptanceGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest() as RequestWithUser;

    if (READ_ONLY_METHODS.has(request.method)) return true;
    if (!request.user?.id) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(LEGAL_GATE_EXEMPT_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const pending = await getPendingAcceptanceSlugs(request.user.id);
    if (pending.length > 0) {
      throw new ForbiddenException({
        message: 'You must accept the latest legal documents before continuing.',
        code: LEGAL_ACCEPTANCE_REQUIRED_CODE,
        pending,
      });
    }

    return true;
  }
}
