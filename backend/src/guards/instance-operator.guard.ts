import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { isInstanceOperator } from '@/lib/instance-operators';
import { RequestWithUser } from '@/types/request';

/**
 * Gates a route to real instance operators only — no per-company `CompanyRole` can express "acts
 * across every company on this deployment", so this is the generic identity check for the handful of
 * instance-wide actions that need one (today: `InstanceController`'s reset flow, and `GET /api/backup/
 * status`). Runs AFTER the global `AuthGuard`/`RolesGuard` (`app.module.ts`'s own `APP_GUARD` list):
 * this guard never re-derives identity itself, it only reads what `AuthGuard` already populated on
 * the request.
 *
 * Deliberately carries NO SaaS/`isBillingEnabled()` opinion of its own — the two controllers that use
 * it disagree on what SaaS should do here: `InstanceController`'s reset flow is masked and refused
 * entirely on SaaS (an owner decision — see `instance-reset-saas.guard.ts`, stacked in FRONT of this
 * one on that controller only), while `GET /api/backup/status` must keep answering for a real
 * operator on SaaS too — the hosted-billing operator still runs their own instance and still needs to
 * see its backup status. Baking a universal SaaS refusal in HERE would make the second case
 * impossible without a second, near-duplicate guard, so the SaaS decision lives at the call site
 * instead, not in this shared identity check.
 *
 * Two independent refusals:
 *
 *  1. API-key auth, refused OUTRIGHT regardless of the key's own scopes — `ApiKeyScope`
 *     (`utils/scope-check.ts`) has no notion of "instance operator" and never will. `request.scopes`
 *     is `null` for session auth and a `string[]` (possibly empty) for API-key auth, see
 *     `guards/auth.guard.ts`'s own header on that split. An instance-wide action requires a real,
 *     freshly-authenticated human in the loop, never a long-lived bearer credential that could leak
 *     or sit unattended in a script.
 *  2. Not on the `INSTANCE_OPERATOR_EMAILS` allowlist (`lib/instance-operators.ts`) — an absent/empty
 *     variable means this branch refuses EVERY caller, which is the intended "no operator configured"
 *     resting state.
 */
@Injectable()
export class InstanceOperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    if (request.scopes !== null) {
      throw new ForbiddenException('Instance-operator actions require a real session, never an API key');
    }

    if (!isInstanceOperator(request.user?.email)) {
      throw new ForbiddenException('This account is not an instance operator');
    }

    return true;
  }
}
