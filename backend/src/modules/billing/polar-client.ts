/**
 * The ONE `@polar-sh/sdk` client instance this process uses for every server-to-server Polar call:
 * `checkout-session.ts`'s `checkouts.create`/`customers.*`, `portal-session.ts`'s
 * `customerSessions.create`, `seat-sync.ts`'s `subscriptions.update({ subscriptionUpdate: { seats } })`,
 * `status-reconcile.ts`'s `subscriptions.list`, `legacy-customer.ts`'s `customers.getExternal`. Every
 * one of them is a plain Nest route or function now (option A, product decision 2026-09-16), never
 * `@polar-sh/better-auth`'s own middleware; that package is no longer even a dependency (#537, see
 * below). Never constructed unless something actually calls `getPolarClient()`, so an instance with
 * the billing flag off never even imports `@polar-sh/sdk`'s runtime.
 *
 * ## #537: `@polar-sh/sdk` 1.x, versioned import, `2026-10` (2026-09-29)
 *
 * `@polar-sh/sdk` 1.0.0 (npm, read directly, no more alpha) restructured the whole package. It no
 * longer exports a `Polar` CLASS you `new` up: `import { Polar } from '@polar-sh/sdk'` now resolves to
 * only the base error classes, confirmed by reading `node_modules/@polar-sh/sdk/dist/index.d.cts`
 * (no `Polar`/`HTTPClient` there at all). Instead every dated API version is its own subpath export
 * (`@polar-sh/sdk/2026-04`, `@polar-sh/sdk/2026-10`, `@polar-sh/sdk/2027-01`, confirmed by reading the
 * package's own `exports` map in `package.json`), each exporting a `createPolar(options)` factory.
 * `options.version` is baked in by whichever subpath you import, not a runtime-settable field
 * (`PolarOptions extends Omit<ClientOptions, 'baseUrl' | 'version'>`, read directly), and every request
 * that client builds stamps `Polar-Version: <that version>` itself (`ClientBase.buildRequest`, in the
 * package's own shipped `base-*.cjs`: `headers: new Headers({ 'Polar-Version': this.options.version,
 * … })`). So the PR #536 fix this file used to carry, a hand-built `HTTPClient` with a `beforeRequest`
 * hook stamping the header on every call, is no longer needed or possible: `HTTPClient` itself is
 * gone from the package. Pinning the API version is now "import the right dated subpath", nothing else.
 *
 * `POLAR_API_VERSION` below is kept as the single, greppable source of truth for which version that
 * is: asserted against in `polar-client.spec.ts`, named in
 * `documentation/docs/developer-guide/hosted-billing.md`. It is documentation, not configuration;
 * changing it without also changing the `from '@polar-sh/sdk/2026-10'` import path two lines below does
 * nothing. The next quarterly upgrade (`2027-01` becomes Current some time after 2027-01-01, per
 * Polar's own https://polar.sh/docs/api-reference/2026-10/versioning.md: quarterly releases in the first week of
 * January/April/July/October, roughly 3 months each as Next/Current/Deprecated) changes both together.
 *
 * CREDENTIAL LEAK (live incident, pre-#537): every error `@polar-sh/sdk@0.49` threw for a non-2xx
 * response was a `PolarError` subclass whose own constructor stamped `this.rawResponse`, with the
 * roughly 31 schema-parsed subclasses (`HTTPValidationError` included) additionally stamping
 * `this.data$`, whose own `request$` was the real `Request` object the SDK sent, `Authorization:
 * Bearer polar_oat_…` header and all. `sanitizePolarError`/`withSanitizedPolarErrors` below were built
 * to strip that before any catch block or log line could see it.
 *
 * **This specific leak is gone in 1.0.0, structurally.** Confirmed by reading
 * `node_modules/@polar-sh/sdk`'s shipped `base-*.cjs`/`errors-*.cjs` directly: `PolarClientError` (the
 * base every generated error subclass, `HTTPValidationError` included, extends) is constructed as
 * `new ErrorClass(statusCode, parsedResponseBody)`, nothing else; `PolarRateLimitError` as
 * `new PolarRateLimitError(statusCode, retryAfter)`; `PolarServerError`/`PolarNetworkError` carry only
 * a message string. No subclass, in this version, is ever handed the raw
 * `Request`/`Response`/`Headers` object at all, so there is nothing left for
 * `POLAR_ERROR_SECRET_CARRIERS` to find on a real error this SDK throws today.
 * `sanitizePolarError`/`withSanitizedPolarErrors` are kept anyway, deliberately, as defense in depth.
 * They cost nothing on an error that never carries the denylisted keys (the loop below simply skips
 * nothing), and they still protect this process against a future `@polar-sh/sdk` release reintroducing
 * the pattern, or any other library this module family might one day wrap the same way. A parsed error
 * body is still copied through on purpose (see `HTTPValidationError.error` below): that is the
 * diagnostic `detail` array every duck-typed check in this file family reads, never a credential.
 */
import { createPolar, type Polar } from '@polar-sh/sdk/2026-10';

import { logger } from '@/logger/logger.service';
import { assertDemoSendingAllowed } from '@/modules/demo/demo-blocked';

import { resolvePolarServerEnvironment } from './polar-env';

/** See this file's own header, "#537: `@polar-sh/sdk` 1.x, versioned import, `2026-10`", this constant
 *  and the `from '@polar-sh/sdk/2026-10'` import two lines above move together; changing one without
 *  the other is a lie the next reader (and `polar-client.spec.ts`'s own header-assertion tests) will
 *  catch. `2026-04` (this app's contract from PR #536 until 2026-10-01, when it was renamed Deprecated
 *  by Polar) is retired: `2026-10` became Current on 2026-10-01 and is itself renamed Deprecated at the
 *  next quarterly release, in the first week of January 2027 (Polar's own
 *  https://polar.sh/docs/api-reference/2026-10/versioning.md), upgrade before then. */
export const POLAR_API_VERSION = '2026-10';

let cached: Polar | null = null;

export function getPolarClient(): Polar {
  // Demo instance (issue #533): refuses BEFORE the client is even constructed, independently of
  // `isBillingEnabled()`'s own demo-mode override (`billing-flag.ts`): this is belt-and-suspenders for
  // any caller that reaches this chokepoint without going through that flag first, on the same "the
  // ONE chokepoint every Polar call already goes through" reasoning this file's own header states for
  // why sanitization lives here.
  assertDemoSendingAllowed('Polar billing');
  if (!cached) {
    cached = withSanitizedPolarErrors(
      createPolar({
        // #537: `PolarOptions.accessToken` is a required `string` in `@polar-sh/sdk@1.0.0` (0.49's was
        // optional), `?? ''` is a type-level fallback only, never reached with billing genuinely
        // enabled: `assertPolarEnvConfiguredForBoot` (`polar-env.ts`, called from `main.ts`) already
        // refuses to boot with the flag on and `POLAR_ACCESS_TOKEN` blank, so this function is never
        // actually called with an empty token in a real deployment.
        accessToken: process.env.POLAR_ACCESS_TOKEN ?? '',
        // #537: `PolarOptions`'s own field is `environment` in `@polar-sh/sdk@1.0.0` (`Environment =
        // "production" | "sandbox"`, read directly), 0.49's was named `server`, same two values.
        environment: resolvePolarServerEnvironment(),
        // #537, LIVE-SANDBOX FINDING (2026-09-29): `ClientBase`'s own constructor
        // (`node_modules/@polar-sh/sdk`'s own shipped `dist/base-*.cjs`, read directly) defaults
        // `timeout` to 5 SECONDS when not given, `this.options = { timeout: 5, ...options }`.
        // `@polar-sh/sdk@0.49` had no such default (`timeoutMs` only applied when explicitly set and
        // `> 0`, that version's own request-dispatch source, read directly, so an un-configured
        // 0.49 call had NO timeout at all). This is a real behavior regression, not a hypothetical
        // one: re-running
        // `checkout-tax-id.live.spec.ts`'s own "checksum-valid FR VAT number" case against the real
        // sandbox, the one case that makes Polar perform a live VIES lookup server-side
        // (`checkout-session.ts`'s own header), failed with `PolarNetworkError: The operation was
        // aborted due to timeout` under the bare 5s default; the exact same call succeeds once a
        // longer timeout is set here. 30s is generous for every OTHER call this module makes (all much
        // faster than a VIES round trip) and still bounded, never the unbounded wait 0.49 silently
        // allowed, which could hang a request indefinitely on a genuine Polar outage.
        timeout: 30,
      }),
    );
  }
  return cached;
}

/** Property names `@polar-sh/sdk@0.49`'s own `PolarError` base class and its schema-parsed subclasses
 *  (`data$`) used to carry the real, sent `Request`/`Response` on, see this file's own header, "The
 *  credential leak is gone in 1.0.0, structurally": no error this SDK version actually throws carries
 *  any of these three any more, confirmed by reading `node_modules/@polar-sh/sdk`'s own shipped
 *  `base-*.cjs`/`errors-*.cjs`. Kept as a DENYLIST anyway, deliberately, not an allowlist of "fields to
 *  keep", a future Polar error subclass (or a future SDK major version) can add any OTHER diagnostic
 *  field and it survives sanitization untouched, because nothing here needs to know its name; only
 *  these three, historically structural to the shared base class/codegen pattern, are ever stripped. */
const POLAR_ERROR_SECRET_CARRIERS = new Set(['rawResponse', 'headers', 'data$']);

/**
 * Rebuilds a Polar SDK error with every property EXCEPT the ones in `POLAR_ERROR_SECRET_CARRIERS`:
 * `statusCode`, `message`, `name`, `stack`, and (in 1.0.0, for every generated error class:
 * `HTTPValidationError` included) `error`, the parsed response body itself (`PolarClientError`'s own
 * constructor: `new ErrorClass(statusCode, parsedBody)`, stored as `this.error`) all survive, which is
 * everything every duck-typed check in this module family reads (`billing-customer.ts`'s own
 * `isResourceNotFoundError`/`isEmailAlreadyExistsError`, `checkout-session.ts`'s `isTaxIdInvalidError`,
 * this file's own `isPolarRateLimitError`, every one of them now reading `.error.detail` rather than
 * 0.49's top-level `.detail`, see each file's own header) and everything worth putting in a log line.
 * Anything that is not an `Error` carrying a `statusCode` is returned UNCHANGED, a plain network
 * failure, an abort, or any non-Polar error this wrapper might also see is not this function's concern.
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
 * call always surfaces `sanitizePolarError`'s output instead of the SDK's own error, see this file's
 * own header for why this lives here rather than at a logging or HTTP boundary. Recurses into nested
 * namespaces (`client.customers`, `client.customers.members`, …), each of which is re-wrapped the same
 * way, so a method several levels deep is covered without this function needing to know the SDK's
 * exact surface.
 *
 * `Reflect.get(obj, prop, obj)`, the THIRD argument pinned to the real, unwrapped `obj`, never the
 * proxy `receiver` a bare `get(obj, prop, receiver)` trap would default to, is the one detail that
 * makes this safe to use at all. `@polar-sh/sdk@0.49`'s own classes (`Customers extends ClientSDK`)
 * used to read private state off a `WeakMap` keyed by `this` and expose nested resources as GETTERS
 * (`get members() { return this._members ?? (this._members = new PolarMembers(...)) }`), invoked with
 * `this` bound to the Proxy instead of the real instance, either one throws or silently re-creates
 * state on every access. `@polar-sh/sdk@1.0.0`'s `createPolar(options)` (read directly,
 * `dist/2026-10/index-*.cjs`) instead returns a PLAIN object of plain, eagerly-constructed namespace
 * objects (`{ organizations: {...}, subscriptions: {...}, customers: { ..., members: {...} }, ... }`,
 * no getters, no `WeakMap`), so this specific failure mode no longer exists to trigger. The
 * `Reflect.get(obj, prop, obj)` binding is kept anyway: it is still the structurally correct way to
 * proxy an arbitrary object graph whose shape this function does not control, and costs nothing extra
 * against a plain object.
 *
 * KNOWN GAP: this wraps the CALL that returns a promise, not values a resolved promise hands back, a
 * paginated `iterList` resolves to an `AsyncGenerator` (`member-resolution.ts`'s own `for await` walk,
 * post-#537) whose OWN later page fetches are not covered, because by the time iteration starts the
 * wrapped call has already resolved successfully. Accepted: every caller of that generator already logs
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

/** Test-only: drops the cached client so a spec that swaps env vars, mocks `fetch`, or mocks the SDK
 *  between cases does not silently reuse an earlier instance. */
export function resetPolarClientForTests(): void {
  cached = null;
}

/** `PolarRateLimitError` (`@polar-sh/sdk@1.0.0`'s own named class, `base-*.cjs`, read directly) always
 *  carries `statusCode: 429`, the same generic field every OTHER duck-typed Polar error check in this
 *  module family reads (`billing-customer.ts#isResourceNotFoundError`), so this stays correct without
 *  importing that class by name, and without caring whether a future SDK version renames it again. */
function isPolarRateLimitError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { statusCode?: unknown }).statusCode === 429
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PolarRetryOptions {
  /** Total attempts, including the first, bounded (never unbounded backoff-and-retry-forever, which
   *  would turn a persistent rate limit into a request that simply never returns). */
  maxAttempts?: number;
  baseDelayMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 500;

/**
 * The ONE choke point every automatic (never user-initiated) Polar sync call goes through:
 * `seat-sync.ts`'s seat-count push and `member-resolution.ts`'s member lookup/create/delete calls,
 * shared by `member-sync.ts`'s own membership-driven sync. Retries ONLY a 429 (rate limit), every
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
      logger.warn(`Polar rate limit hit (${description}), retrying in ${delayMs}ms`, {
        category: 'billing',
        details: { description, attempt, maxAttempts, delayMs },
      });
      await sleep(delayMs);
    }
  }
}
