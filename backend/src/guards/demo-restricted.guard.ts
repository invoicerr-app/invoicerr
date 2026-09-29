import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { DemoModeBlockedError } from '@/modules/demo/demo-blocked';
import { DEMO_RESTRICTED_KEY } from '@/decorators/demo-restricted.decorator';

/**
 * Refuses every route carrying `@DemoRestricted()` — unconditionally, regardless of who is calling or
 * how (session or API key): the point of this guard is that the demo account cannot be taken over by
 * ANYONE, not that it merely resists an anonymous attacker. Registered globally, but only when demo
 * mode is on (`guards/global-guards.ts`'s own `demoModeEnabled` param), the identical "invisible and
 * inert without its own flag" shape `CompanyWriteGuard`/`LegalAcceptanceGuard` already hold for
 * `billingEnabled` — a self-hosted instance that never sets `DEMO_MODE` never even constructs this
 * guard, so it costs that instance nothing.
 *
 * Runs after `AuthGuard`/`RolesGuard` (see `global-guards.ts`'s own ordering comment) purely because
 * every entry in that chain runs before this one in the array — this guard reads nothing either of
 * them populated, so its own position relative to them is not itself load-bearing.
 */
@Injectable()
export class DemoRestrictedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const restricted = this.reflector.getAllAndOverride<boolean>(DEMO_RESTRICTED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!restricted) return true;

    throw new DemoModeBlockedError('This action');
  }
}
