/**
 * The ONE `@polar-sh/sdk` client instance this process uses for every server-to-server Polar call —
 * `checkout-session.ts`'s `checkouts.create`/`customers.*`, `portal-session.ts`'s
 * `customerSessions.create`, `seat-sync.ts`'s `subscriptions.update({ subscriptionUpdate: { seats } })`,
 * `status-reconcile.ts`'s `subscriptions.list`, `legacy-customer.ts`'s `customers.getExternal` — every
 * one of them a plain Nest route or function now (option A, product decision 2026-09-16), never
 * `@polar-sh/better-auth`'s own middleware, which this backend no longer depends on at all. Never
 * constructed unless something actually calls `getPolarClient()`, so an instance with the billing flag
 * off never even imports `@polar-sh/sdk`'s runtime.
 *
 * CREDENTIAL LEAK (live incident): every error `@polar-sh/sdk` throws for a non-2xx response is a
 * `PolarError` subclass (`node_modules/@polar-sh/sdk/dist/commonjs/models/errors/polarerror.js`, read
 * directly) whose OWN constructor stamps `this.rawResponse`; the ~31 schema-parsed subclasses
 * (`HTTPValidationError` included, `httpvalidationerror.js`) additionally stamp `this.data$ = err`,
 * where `err.request$` is the REAL `Request` object this SDK call sent — `Authorization: Bearer
 * polar_oat_…` header and all (confirmed by constructing a real `HTTPValidationError` with a real
 * `Request`/`Response` and reading `error.data$.request$.headers.get('authorization')` back out — it
 * is exactly that token). Node's `util.inspect` (what Nest's own default exception logging — and any
 * future `logger.error('x', error)` passing the raw object — ultimately calls) walks INTO that nested
 * `Request`'s `headers` (a `Headers` instance with its own custom inspector that prints every entry,
 * `authorization` included) and that is the exact live log line this incident reported. `getPolarClient`
 * below wraps every call this app makes through the SDK so that whatever error escapes it has already
 * had `rawResponse`/`headers`/`data$` stripped — see `sanitizePolarError`'s own header for why this is
 * a denylist, not an allowlist, and for the one path (an `AsyncIterable` page walk mid-iteration,
 * `member-resolution.ts`'s own `members.listMembers`) it does not reach.
 *
 * Chosen over the other two ways this could have been fixed, and why:
 *  - A global Nest exception filter would only catch an error that reaches an HTTP controller
 *    unhandled — every OTHER Polar caller in this module family (the boot-reseed service, the
 *    lifecycle-sweep runner, the BullMQ processor) runs with no HTTP request/response cycle at all, so
 *    a filter protects NONE of them; it would also do nothing for a future caller that catches the
 *    error itself and logs it directly, which is a real pattern this codebase already uses everywhere
 *    (`customer-provisioning.ts`, `member-sync.ts`, `customer-sync.ts` — though every one of those
 *    already only logs `error.message`, by discipline, not by anything enforcing it).
 *  - A log-formatter redaction (regex/deny-key scrubbing at the point something is written to a log
 *    sink) has to run on every sink this app has (console, and whatever aggregator reads it downstream)
 *    and has to keep matching whatever SHAPE a credential-carrying object takes — a `Headers` instance
 *    formats itself with its OWN `util.inspect` custom method, so a formatter would need to know to
 *    look inside `Request`/`Headers` objects specifically, the same fragile "guess the shape" problem
 *    this file's sanitizer already solves once, structurally, at the source.
 *  - Sanitizing AT `getPolarClient()` instead: this is the ONE chokepoint every Polar call in this
 *    codebase already goes through (this file's own opening paragraph) — including one added later by
 *    someone who has never read this comment, as long as it calls `getPolarClient()` like every
 *    existing caller does. The credential-carrying data is removed from the error object itself,
 *    before ANY catch block, log line, or exception filter — anywhere in this process — ever sees it,
 *    rather than trying to intercept every place that error could end up.
 */
import { Polar } from '@polar-sh/sdk';

import { logger } from '@/logger/logger.service';

import { resolvePolarServerEnvironment } from './polar-env';

let cached: Polar | null = null;

export function getPolarClient(): Polar {
  if (!cached) {
    cached = withSanitizedPolarErrors(
      new Polar({
        accessToken: process.env.POLAR_ACCESS_TOKEN,
        server: resolvePolarServerEnvironment(),
      }),
    );
  }
  return cached;
}

/** Property names `@polar-sh/sdk`'s own `PolarError` base class (`polarerror.js`) and its
 *  schema-parsed subclasses (`data$`, e.g. `httpvalidationerror.js`) always use to carry the real,
 *  sent `Request`/`Response` — see this file's own header. A DENYLIST, deliberately, not an allowlist
 *  of "fields to keep": a future Polar error subclass can add any OTHER diagnostic field (this SDK
 *  ships ~31 named business-error classes today, each with its own extra fields beyond
 *  `HTTPValidationError`'s own `detail`) and it survives sanitization untouched, because nothing here
 *  needs to know its name — only these three, which the shared base class/codegen pattern make
 *  structural, are ever stripped. */
const POLAR_ERROR_SECRET_CARRIERS = new Set(['rawResponse', 'headers', 'data$']);

/**
 * Rebuilds a Polar SDK error with every property EXCEPT the ones in `POLAR_ERROR_SECRET_CARRIERS` —
 * `statusCode`, `message`, `name`, `stack`, and (for `HTTPValidationError`) `detail` all survive, which
 * is everything every duck-typed check in this module family reads (`billing-customer.ts`'s own
 * `isResourceNotFoundError`/`isEmailAlreadyExistsError`, `checkout-session.ts`'s `isTaxIdInvalidError`,
 * this file's own `isPolarRateLimitError`) and everything worth putting in a log line. Anything that
 * is not an `Error` carrying a `statusCode` is returned UNCHANGED — a plain network failure, an abort,
 * or any non-Polar error this wrapper might also see is not this function's concern (`sdks.js`'s own
 * `_do` already names those as `RequestAbortedError`/`RequestTimeoutError`/`ConnectionError`, none of
 * which carry a `Request` at all).
 */
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
 * Wraps every function reachable on a Polar SDK client/namespace object so a rejected (or thrown)
 * call always surfaces `sanitizePolarError`'s output instead of the SDK's own error — see this file's
 * own header for why this lives here rather than at a logging or HTTP boundary. Recurses into nested
 * namespaces (`client.customers`, `client.customers.members`, …), each of which is re-wrapped the same
 * way, so a method several levels deep is covered without this function needing to know the SDK's
 * exact surface.
 *
 * `Reflect.get(obj, prop, obj)` — the THIRD argument pinned to the real, unwrapped `obj`, never the
 * proxy `receiver` a bare `get(obj, prop, receiver)` trap would default to — is the one detail that
 * makes this safe to use at all: several of this SDK's own classes (`Customers extends ClientSDK`,
 * `sdks.js`, read directly) read private state off a `WeakMap` keyed by `this`, and `Customers` itself
 * exposes `members` as a GETTER (`get members() { return this._members ?? (this._members = new
 * PolarMembers(...)) }`). Either one invoked with `this` bound to the Proxy instead of the real
 * instance throws or silently re-creates state on every access; binding every call and every getter
 * back to `obj` keeps `this` identical to what an unwrapped `getPolarClient()` would have used.
 *
 * KNOWN GAP: this wraps the CALL that returns a promise, not values a resolved promise hands back —
 * `members.listMembers()` resolves to an `AsyncIterable` (`member-resolution.ts`'s own `for await`
 * page walk) whose OWN later page fetches are not covered, because by the time iteration starts the
 * wrapped call has already resolved successfully. Accepted: every caller of that iterable already logs
 * only `error.message` on failure (`member-resolution.ts`, `member-sync.ts`), by the same discipline
 * every OTHER Polar caller in this codebase already holds, independently of this wrapper.
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
