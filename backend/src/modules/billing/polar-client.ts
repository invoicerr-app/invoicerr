/**
 * The Polar API version is pinned by the dated SDK subpath import, which stamps `Polar-Version` on
 * every request; there is no runtime setting for it.
 *
 * Error sanitization strips properties that once carried the sent request, `Authorization` header
 * included. The current SDK no longer attaches them; kept as defense in depth.
 */
import { createPolar, type Polar } from '@polar-sh/sdk/2026-10';

import { logger } from '@/logger/logger.service';
import { assertDemoSendingAllowed } from '@/modules/demo/demo-blocked';

import { resolvePolarServerEnvironment } from './polar-env';

/** Documentation only: must move together with the dated import path above. Polar deprecates each
 *  version after one quarter. */
export const POLAR_API_VERSION = '2026-10';

let cached: Polar | null = null;

export function getPolarClient(): Polar {
  // Independent of `isBillingEnabled()`'s demo override, for callers that skip that flag.
  assertDemoSendingAllowed('Polar billing');
  if (!cached) {
    cached = withSanitizedPolarErrors(
      createPolar({
        // `?? ''` is type-level only: boot already refuses billing with a blank token.
        accessToken: process.env.POLAR_ACCESS_TOKEN ?? '',
        environment: resolvePolarServerEnvironment(),
        // The SDK defaults to 5 seconds, too short for checkouts that trigger a server-side VIES lookup.
        timeout: 30,
      }),
    );
  }
  return cached;
}

/** A denylist, not an allowlist, so new diagnostic fields on future errors survive sanitization. */
const POLAR_ERROR_SECRET_CARRIERS = new Set(['rawResponse', 'headers', 'data$']);

/** Keeps `statusCode`, `message` and the parsed body (`error`), which duck-typed checks read. */
export function sanitizePolarError(error: unknown): unknown {
  if (!(error instanceof Error) || !('statusCode' in error)) return error;

  const sanitized = new Error(error.message);
  for (const key of Object.getOwnPropertyNames(error)) {
    if (POLAR_ERROR_SECRET_CARRIERS.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (descriptor) Object.defineProperty(sanitized, key, descriptor);
  }
  return sanitized;
}

/**
 * Recurses into nested namespaces. `Reflect.get(obj, prop, obj)` binds to the real object, not the
 * proxy, so getters or `this`-keyed private state on SDK classes keep working.
 *
 * Known gap: values a resolved promise returns are not wrapped, so page fetches of an `iterList`
 * generator are not sanitized; its callers log only `error.message`.
 */
export function withSanitizedPolarErrors<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop, obj);
      if (typeof value !== 'function') {
        return value && typeof value === 'object' ? withSanitizedPolarErrors(value) : value;
      }
      return function (this: unknown, ...args: unknown[]) {
        try {
          const result = Reflect.apply(value as (...a: unknown[]) => unknown, obj, args);
          if (result && typeof (result as { then?: unknown }).then === 'function') {
            return (result as Promise<unknown>).catch((error: unknown) => {
              throw sanitizePolarError(error);
            });
          }
          return result;
        } catch (error) {
          throw sanitizePolarError(error);
        }
      };
    },
  }) as T;
}

export function resetPolarClientForTests(): void {
  cached = null;
}

/** Checks `statusCode` rather than the SDK class, so a class rename cannot break it. */
function isPolarRateLimitError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { statusCode?: unknown }).statusCode === 429
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PolarRetryOptions {
  /** Total attempts, including the first. */
  maxAttempts?: number;
  baseDelayMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 500;

/** Retries only 429s, with bounded exponential backoff; other failures are not fixed by retrying. */
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
      logger.warn(`Polar rate limit hit (${description}), retrying in ${delayMs}ms`, {
        category: 'billing',
        details: { description, attempt, maxAttempts, delayMs },
      });
      await sleep(delayMs);
    }
  }
}
