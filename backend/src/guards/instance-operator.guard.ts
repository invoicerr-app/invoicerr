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
 *  2. Not a PROVEN holder of an address on the `INSTANCE_OPERATOR_EMAILS` allowlist
 *     (`lib/instance-operators.ts`) — an absent/empty variable means this branch refuses EVERY
 *     caller, which is the intended "no operator configured" resting state.
 *
 * `emailVerified` is half of that second refusal, and it is load-bearing rather than belt-and-braces.
 * The allowlist names an ADDRESS; what reaches this guard is whatever address a `User` row happens to
 * carry, and this deployment writes that column from two places only. Plain sign-up writes
 * `emailVerified: false` unconditionally (better-auth's own `sign-up` route; this repository sets
 * neither `sendOnSignUp` nor `requireEmailVerification` — see `lib/auth.ts`'s `emailVerification`
 * block), and sign-up is open by default (`lib/registration-policy.ts`). So without this condition,
 * the operator identity is claimable by anyone who reaches the instance and types the address into
 * the sign-up form before the operator himself does — the whole window between an operator writing
 * `INSTANCE_OPERATOR_EMAILS` into a compose file and creating his own account. The other writer is an
 * identity provider's `email_verified` claim, which is why `lib/sso-policy.ts#signupMayAssertVerifiedEmail`
 * refuses to honour that claim from a provider a CUSTOMER registered: a tenant IdP asserts whatever
 * it likes about whichever address it likes, so letting one write this column would hand it the same
 * claim by another route.
 *
 * ONE refusal for both halves, deliberately, and with one message: a distinct "your address is on
 * the list but unverified" would answer "is this address the operator's?" for a caller holding an
 * unverified session at that address — which is exactly the position the attacker above is in, and
 * exactly the question he needs answered to know his attack is worth finishing.
 */
@Injectable()
export class InstanceOperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    if (request.scopes !== null) {
      throw new ForbiddenException('Instance-operator actions require a real session, never an API key');
    }

    if (!isInstanceOperator(request.user?.email) || request.user?.emailVerified !== true) {
      throw new ForbiddenException('This account is not an instance operator');
    }

    return true;
  }
}
