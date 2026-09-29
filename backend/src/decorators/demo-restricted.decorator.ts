import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as refused outright while `DEMO_MODE` is on — see
 * `guards/demo-restricted.guard.ts`. Applied to the handful of plain NestJS controller routes that
 * could otherwise take over, or grief, the single seeded demo account: creating/revoking an API key,
 * configuring or removing SSO (and its domain claims), setting a password on an OIDC-only account, and
 * deleting the company. Every one of these already sits behind the global `AuthGuard`/`RolesGuard`
 * chain — this decorator only needs to name the ones that ALSO need the demo refusal.
 *
 * The better-auth-NATIVE actions this same requirement covers (change-email, change-password,
 * delete-user, sign-up) never reach a NestJS route at all — `create-app.ts` mounts better-auth's own
 * handler as Express middleware BEFORE Nest's router, so no `@UseGuards()`/decorator here can ever see
 * them. Those four are refused instead inside `lib/auth.ts`'s own `hooks.before` and
 * `user.deleteUser.beforeDelete`, and inside `lib/registration-policy.ts#decideRegistration` — see
 * each file's own header.
 */
export const DEMO_RESTRICTED_KEY = 'demoRestricted';

export const DemoRestricted = () => SetMetadata(DEMO_RESTRICTED_KEY, true);
