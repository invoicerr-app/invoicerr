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

import { logger } from '@/logger/logger.service';

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

/** No named `RateLimitError`/`TooManyRequests` class exists in `@polar-sh/sdk`'s own
 *  `models/errors/` directory (read directly, every file there enumerated) — a 429 surfaces as a
 *  plain `PolarError`/`SDKError` carrying `statusCode: 429`, the same generic field every OTHER
 *  duck-typed Polar error check in this module family reads (`billing-customer.ts#isResourceNotFoundError`). */
function isPolarRateLimitError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { statusCode?: unknown }).statusCode === 429
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PolarRetryOptions {
  /** Total attempts, including the first — bounded (never unbounded backoff-and-retry-forever, which
   *  would turn a persistent rate limit into a request that simply never returns). */
  maxAttempts?: number;
  baseDelayMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 500;

/**
 * The ONE choke point every automatic (never user-initiated) Polar sync call goes through —
 * `seat-sync.ts`'s seat-count push and `member-resolution.ts`'s member lookup/create/delete calls,
 * shared by `member-sync.ts`'s own membership-driven sync. Retries ONLY a 429 (rate limit) — every
 * other failure (a business refusal, an outage, a bad token) is not something retrying fixes, and is
 * left to each caller's own existing "log and swallow, the next membership change retries" discipline.
 * Bounded exponential backoff (`DEFAULT_BASE_DELAY_MS * 2^attempt`), logged on every retry so a
 * sustained rate limit is visible in logs rather than silently absorbed.
 */
export async function callPolarWithRetry<T>(
  fn: () => Promise<T>,
  description: string,
  options: PolarRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (!isPolarRateLimitError(error) || attempt >= maxAttempts) throw error;

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      logger.warn(`Polar rate limit hit (${description}) — retrying in ${delayMs}ms`, {
        category: 'billing',
        details: { description, attempt, maxAttempts, delayMs },
      });
      await sleep(delayMs);
    }
  }
}
