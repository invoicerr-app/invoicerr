/**
 * The global `APP_GUARD` chain, in the order it runs — its own file because the ORDER is a security
 * property, not a formatting detail, and a property nobody can assert on while the list is an inline
 * literal inside `app.module.ts` (importing that module to read it builds a live Prisma client, a
 * better-auth instance and an ioredis connection).
 *
 * Nest runs global guards in REGISTRATION order and stops at the first one that refuses
 * (`@nestjs/core`'s `scanner.js` pushes each `APP_GUARD` provider onto `ApplicationConfig` as it is
 * scanned; `GuardsConsumer` then walks that array and short-circuits). So the position of an entry in
 * this array is the position it occupies in front of every route in the product.
 *
 * `ThrottlerGuard` is FIRST, and that is the whole point of this file. Registered last — where it was
 * — a request refused by `AuthGuard` never reached it, so a refused request was never COUNTED: an
 * anonymous caller could hold an unlimited request rate against `/api/*` indefinitely, because the
 * only thing that would have limited him ran exclusively on the requests he never made. What each
 * refused request cost on the way to its 401 is the reason this is worth moving rather than
 * documenting: `AuthGuard` resolves a session first (cheap — better-auth verifies the session
 * cookie's HMAC against the secret and returns null with no query when it is absent or forged), then
 * falls through to the API-key branch, where a caller who presents ANY `x-api-key`/`Bearer` value at
 * all buys a SHA-256 and a `prisma.apiKey.findUnique({ include: { user: true } })` — one indexed
 * SELECT with a join, holding a connection out of `DATABASE_POOL_MAX`, per request, forever. The key
 * space itself is not the exposure (256-bit keys; `utils/api-key.ts`), the database round-trip is: an
 * anonymous flood of invented keys amplifies into the one resource the whole instance shares.
 *
 * What moving it costs, stated plainly because it is a real trade: every request now spends a Redis
 * round-trip (`ThrottlerStorageRedisService`, `app.module.ts`'s `ThrottlerModule.forRoot`) BEFORE
 * anything else, including the requests that used to be refused before touching Redis at all. That is
 * deliberate — an `INCR` against Redis is the cheap resource and a Postgres query against a pooled
 * connection is the expensive one, and it is the expensive one an anonymous caller could previously
 * spend without limit. Two consequences follow and are accepted: a flooding anonymous caller now sees
 * 429 where he used to see 401, and a Redis outage now fails every request rather than only the
 * authenticated ones — the latter being moot in practice, since `documents/queue/redis-required.guard.ts`
 * already refuses to let this process boot without Redis.
 *
 * Nothing in `ThrottlerGuard` depends on running after authentication: its default tracker is the
 * request IP (`req.ips[0] ?? req.ip`) and its key is derived from the handler's class/method name, so
 * it reads nothing `AuthGuard` populates. `@Throttle()`/`@SkipThrottle()` are reflector metadata,
 * which is order-independent. The one shape it genuinely sees differently is that it now also counts
 * requests that never became a caller — which is the defect being fixed, not a side effect of it.
 *
 * `CompanyContextInterceptor` (`app.module.ts`) is unaffected: Nest runs every interceptor after
 * every guard regardless of registration order.
 */
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Provider } from '@nestjs/common';

import { AuthGuard } from '@/guards/auth.guard';
import { RolesGuard } from '@/guards/roles.guard';
import { CompanyWriteGuard } from '@/modules/billing/company-write.guard';
import { LegalAcceptanceGuard } from '@/legal/legal-acceptance.guard';

/**
 * Every global guard this deployment registers, in execution order.
 *
 * `billingEnabled` is passed in rather than read here so this stays a pure function a spec can drive
 * both ways — `app.module.ts` owns the `isBillingEnabled()` call, as it does for `BillingModule`
 * itself.
 */
export function globalGuardProviders(params: { billingEnabled: boolean }): Provider[] {
  return [
    // Global rate limiting — FIRST, see this file's own header for what it cost when it was last.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Hosted billing's read-only gate (product decision 2026-09-15) — refuses every WRITE from a
    // `blocked`/`zipped` company. Registered ONLY under the flag, like `BillingModule` itself: with
    // it unset, this guard doesn't merely no-op, it never enters the graph at all. See
    // `billing/write-gate.ts`'s own header for the full exemption list (GET/HEAD/OPTIONS, no active
    // company, `/api/auth/*` bypassing Nest routing entirely). `send-gate.ts#assertCanSend` (the
    // narrower, TRIAL-only gate on `send` specifically) stays a direct call from
    // `documents.service.ts#runAction` — unrelated, not duplicated here.
    ...(params.billingEnabled ? [{ provide: APP_GUARD, useClass: CompanyWriteGuard }] : []),
    // Refuses every write from a caller with a pending legal-document re-acceptance — named
    // `LEGAL_ACCEPTANCE_REQUIRED`. Registered ONLY under the same flag as `CompanyWriteGuard` right
    // above, for the identical reason: self-hosted has nothing to accept in the first place. See
    // `legal/legal-acceptance.guard.ts`'s own header for the full exemption list.
    ...(params.billingEnabled ? [{ provide: APP_GUARD, useClass: LegalAcceptanceGuard }] : []),
  ];
}
