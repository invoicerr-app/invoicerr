/**
 * The ONE `@polar-sh/sdk` client instance this process uses for every server-to-server Polar call —
 * `checkout-session.ts`'s `checkouts.create`/`customers.*`, `portal-session.ts`'s
 * `customerSessions.create`, `seat-sync.ts`'s `subscriptions.update({ subscriptionUpdate: { seats } })`,
 * `status-reconcile.ts`'s `subscriptions.list`, `legacy-customer.ts`'s `customers.getExternal` — every
 * one of them a plain Nest route or function now (option A, product decision 2026-09-16), never
 * `@polar-sh/better-auth`'s own middleware, which this backend no longer depends on at all. Never
 * constructed unless something actually calls `getPolarClient()`, so an instance with the billing flag
 * off never even imports `@polar-sh/sdk`'s runtime.
 */
import { Polar } from '@polar-sh/sdk';

import { resolvePolarServerEnvironment } from './polar-env';

let cached: Polar | null = null;

export function getPolarClient(): Polar {
  if (!cached) {
    cached = new Polar({
      accessToken: process.env.POLAR_ACCESS_TOKEN,
      server: resolvePolarServerEnvironment(),
    });
  }
  return cached;
}

/** Test-only: drops the cached client so a spec that swaps env vars (or mocks the SDK) between
 *  cases does not silently reuse an earlier instance. */
export function resetPolarClientForTests(): void {
  cached = null;
}
