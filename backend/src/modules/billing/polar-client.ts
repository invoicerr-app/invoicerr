/**
 * The ONE `@polar-sh/sdk` client instance this process uses for every server-to-server Polar call
 * that is NOT one of the four routes `@polar-sh/better-auth`'s own `polar()` plugin mounts under
 * `/api/auth/*` (checkout, customer portal, usage, webhooks — see `polar-plugin.ts`'s own header) —
 * today that is exactly one thing: `seat-sync.ts`'s `subscriptions.update({ subscriptionUpdate:
 * { seats } })`. Never constructed unless something actually calls `getPolarClient()`, so an instance
 * with the billing flag off never even imports `@polar-sh/sdk`'s runtime.
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
