import util from 'node:util';

import { vi, type Mock } from 'vitest';

// The REAL SDK error class, not a hand-rolled lookalike (`CLAUDE.md`'s own "delegate to libs"
// preference), constructing an actual `HTTPValidationError` is what proves the sanitizer's mechanism
// (and, post-#537, that there is nothing left on a real one TO sanitize) against the exact shape
// `@polar-sh/sdk` produces, not a guess at it.
import { errors } from '@polar-sh/sdk/2026-10';

import {
  callPolarWithRetry,
  getPolarClient,
  POLAR_API_VERSION,
  resetPolarClientForTests,
  sanitizePolarError,
  withSanitizedPolarErrors,
} from './polar-client';
import { DemoModeBlockedError } from '../demo/demo-blocked';
import { DEMO_MODE_FLAG_NAME } from '../demo/demo-flag';

/** Builds a REAL `HTTPValidationError` the way `@polar-sh/sdk@1.0.0`'s own `ClientBase#parseResponse`
 *  does (read directly, the package's own shipped `base-*.cjs`): `new ErrorClass(statusCode,
 *  parsedResponseBody)`, nothing else. #537: unlike 0.49's `HTTPValidationError`, which stashed the
 *  REAL, sent `Request` (bearer token and all, the live incident `polar-client.ts`'s own header
 *  describes), this constructor is NEVER handed a `Request`/`Response`/`Headers` object at all. */
function realHttpValidationError(): InstanceType<typeof errors.HTTPValidationError> {
  const detail = [
    {
      loc: ['body', 'individual', 'email'],
      msg: 'value is not a valid email address: An email address must have an @-sign.',
      type: 'value_error',
    },
  ];
  return new errors.HTTPValidationError(422, { detail });
}

/** A SYNTHETIC error shaped like `@polar-sh/sdk@0.49`'s own leaky one, `rawResponse`/`headers`/`data$`
 *  carrying a real `Headers` instance with a bearer token, exactly the shape `sanitizePolarError`'s own
 *  `POLAR_ERROR_SECRET_CARRIERS` denylist was built against. No error this codebase's OWN SDK version
 *  (1.0.0) throws looks like this any more (see `realHttpValidationError` above and the "gone in
 *  1.0.0" test below), but the denylist is kept as defense in depth (`polar-client.ts`'s own header),
 *  and this fixture is what proves THAT mechanism still works, independent of whether any current SDK
 *  error actually needs it. */
function legacyShapedErrorWithBearerToken(bearerToken: string): Error {
  const headers = new Headers({ authorization: `Bearer ${bearerToken}`, 'content-type': 'application/json' });
  return Object.assign(new Error('HTTPValidationError'), {
    statusCode: 422,
    rawResponse: { status: 422, headers },
    headers,
    data$: { request$: { headers } },
  });
}

function rateLimitError(): unknown {
  return { statusCode: 429, message: 'Too Many Requests' };
}

describe('callPolarWithRetry', () => {
  it('returns the result on the first try when nothing fails', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    await expect(callPolarWithRetry(fn, 'test call')).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a 429 (rate limit) and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError())
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce('ok');

    const result = await callPolarWithRetry(fn, 'test call', { baseDelayMs: 1 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries a non-429 failure, a business refusal or outage is not something a retry fixes', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('polar is down'));

    await expect(callPolarWithRetry(fn, 'test call', { baseDelayMs: 1 })).rejects.toThrow('polar is down');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is BOUNDED, gives up and rethrows once maxAttempts is exhausted, never retries forever', async () => {
    const fn = vi.fn().mockRejectedValue(rateLimitError());

    await expect(
      callPolarWithRetry(fn, 'test call', { baseDelayMs: 1, maxAttempts: 3 }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('backs off exponentially between attempts', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError())
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce('ok');
    // Filtered to delays this call could plausibly ask for (baseDelayMs 10, at most a few backoff
    // steps), spying on the GLOBAL setTimeout also catches whatever OTHER timers the test runner
    // itself schedules when this file runs alongside the rest of the suite (observed: a handful of
    // unrelated ~10s housekeeping timers), which a plain "record everything" spy would otherwise
    // wrongly attribute to this call.
    const delays: number[] = [];
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
      if ((ms ?? 0) <= 1000) delays.push(ms ?? 0);
      return realSetTimeout(cb, 0);
    }) as unknown as typeof setTimeout);

    await callPolarWithRetry(fn, 'test call', { baseDelayMs: 10 });

    expect(delays).toEqual([10, 20]);
    (global.setTimeout as unknown as Mock).mockRestore();
  });
});

describe('sanitizePolarError', () => {
  // #537's own canary, replacing 0.49's "FAILS ON THE OLD BEHAVIOUR" one: proves the credential leak
  // this file was built to close no longer reproduces against the SDK version this codebase actually
  // ships. If this assertion ever starts FAILING, `@polar-sh/sdk` changed shape again, go re-read
  // `polar-client.ts`'s own header before assuming the sanitizer below still covers it.
  it('a REAL @polar-sh/sdk@1.0.0 HTTPValidationError never carries a raw Request/Headers/bearer token in the first place', () => {
    const error = realHttpValidationError();

    expect(Object.getOwnPropertyNames(error)).not.toEqual(
      expect.arrayContaining(['rawResponse', 'headers', 'data$']),
    );
    expect(util.inspect(error, { depth: 6 })).not.toMatch(/bearer/i);
  });

  it('strips a legacy-shaped (0.49-like) leak while keeping the status code a log line needs, the mechanism this file keeps as defense in depth', () => {
    const error = legacyShapedErrorWithBearerToken('polar_oat_SUPERSECRETTOKEN123');

    const sanitized = sanitizePolarError(error) as { statusCode: number };
    const dump = util.inspect(sanitized, { depth: 6 });

    expect(dump).not.toContain('polar_oat_SUPERSECRETTOKEN123');
    expect(dump).not.toContain('authorization');
    // The diagnostic value survives, this is a redaction, not a swallow (this file's own header).
    expect(sanitized.statusCode).toBe(422);
  });

  it('keeps the parsed response body (.error, e.g. HTTPValidationError.error.detail) intact through sanitization', () => {
    const error = realHttpValidationError();

    const sanitized = sanitizePolarError(error) as { statusCode: number; error: { detail: unknown[] } };

    expect(sanitized.statusCode).toBe(422);
    expect(sanitized.error.detail).toEqual([
      expect.objectContaining({ msg: expect.stringContaining('An email address must have an @-sign') }),
    ]);
  });

  it('leaves a non-Polar error (no statusCode at all) completely untouched', () => {
    const plain = new Error('network is down');

    expect(sanitizePolarError(plain)).toBe(plain);
  });
});

describe('withSanitizedPolarErrors', () => {
  it('sanitizes an error thrown by a nested, promise-returning method before the caller ever sees it', async () => {
    const error = legacyShapedErrorWithBearerToken('polar_oat_ANOTHERSECRET456');
    const client = withSanitizedPolarErrors({ customers: { create: vi.fn().mockRejectedValue(error) } });

    const caught = await client.customers.create({}).catch((e: unknown) => e);

    expect(util.inspect(caught, { depth: 6 })).not.toContain('polar_oat_ANOTHERSECRET456');
    expect((caught as { statusCode: number }).statusCode).toBe(422);
  });

  // A general regression test for the proxy's `Reflect.get(obj, prop, obj)` binding, NOT a mirror of
  // `@polar-sh/sdk@1.0.0`'s own architecture any more (`createPolar()` returns a plain object of
  // plain, eagerly-built namespace objects, no getters, no `WeakMap`, `polar-client.ts`'s own
  // header), kept because it is still the structurally correct way to proxy an arbitrary object
  // graph this function does not control the shape of, and a future dependency (or SDK major version)
  // could reintroduce a getter-backed, WeakMap-keyed nested resource exactly like 0.49's own
  // `Customers extends ClientSDK` used to be.
  it('preserves `this` through a getter-exposed nested namespace backed by private state', async () => {
    const state = new WeakMap<object, { calls: number }>();
    class Nested {
      async create(): Promise<never> {
        const own = state.get(this as object);
        if (!own) throw new Error('private state missed, `this` was not the real instance');
        own.calls++;
        throw legacyShapedErrorWithBearerToken('polar_oat_NESTEDSECRET789');
      }
    }
    class Client {
      private _nested?: Nested;
      get nested(): Nested {
        if (!this._nested) {
          this._nested = new Nested();
          state.set(this._nested, { calls: 0 });
        }
        return this._nested;
      }
    }

    const client = withSanitizedPolarErrors(new Client());
    const caught = await client.nested.create().catch((e: unknown) => e);

    expect((caught as Error).message).not.toContain('private state missed');
    expect(util.inspect(caught, { depth: 6 })).not.toContain('polar_oat_NESTEDSECRET789');
  });
});

/**
 * #537: on 2026-10-01 Polar's Current contract became `2026-10`; `2026-04` (this app's own contract
 * since PR #536) is renamed Deprecated. `getPolarClient()` now builds its client via `createPolar`
 * from the VERSIONED `@polar-sh/sdk/2026-10` subpath (`polar-client.ts`'s own header), the SDK itself
 * stamps `Polar-Version: 2026-10` on every request from `options.version`, which that subpath bakes
 * in. There is no more hand-built `HTTPClient`/`beforeRequest` hook to prove (0.49/#536's own fix, now
 * gone, `HTTPClient` no longer even exists in this package), what THIS block proves instead is that
 * importing the RIGHT subpath really does produce that header on the wire, for more than one resource,
 * through real `getPolarClient()` calls over a mocked global `fetch`, never a hand-rolled stand-in for
 * the SDK's own request path.
 *
 * There is no `@polar-sh/better-auth` plugin path left to exercise, and that package is no longer even
 * a listed dependency (#537, `package.json`), `getPolarClient()` is the ONLY place this backend
 * constructs a Polar client, which the calls below exercise directly.
 */
describe('getPolarClient sets the Polar-Version header (#537, 2026-10)', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.POLAR_ACCESS_TOKEN;

  beforeEach(() => {
    resetPolarClientForTests();
    process.env.POLAR_ACCESS_TOKEN = 'polar_oat_test_537';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.POLAR_ACCESS_TOKEN = originalToken;
    resetPolarClientForTests();
  });

  /** Captures the real `Request` objects the SDK's own request path hands to `fetch`: the exact
   *  wire-level object Polar's own server reads headers off. The response body is intentionally NOT a
   *  valid Polar schema: this test asserts on the OUTGOING request, so what a caller does with an
   *  invalid response (reject, in every case below, always swallowed) is irrelevant to it. */
  function interceptFetch(): Request[] {
    const seen: Request[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      seen.push(request);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return seen;
  }

  it('stamps Polar-Version on a customerSessions.create call (portal-session.ts path)', async () => {
    const seen = interceptFetch();
    const client = getPolarClient();

    await client.customerSessions
      .create({ external_customer_id: 'company_537_test', return_url: 'https://example.test/return' })
      .catch(() => undefined);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.get('Polar-Version')).toBe(POLAR_API_VERSION);
  });

  it('stamps Polar-Version on a products.list call (a second, unrelated resource/method)', async () => {
    const seen = interceptFetch();
    const client = getPolarClient();

    // `list()` resolves directly to one page now (#537), a single, genuinely one-shot `await` is
    // enough to observe the outgoing request.
    await client.products.list().catch(() => undefined);

    expect(seen.length).toBeGreaterThan(0);
    for (const request of seen) {
      expect(request.headers.get('Polar-Version')).toBe(POLAR_API_VERSION);
    }
  });

  it('stamps Polar-Version consistently across different Polar resources sharing one getPolarClient() instance', async () => {
    const seen = interceptFetch();
    const client = getPolarClient();

    await client.customerSessions
      .create({ external_customer_id: 'a', return_url: 'https://x.test' })
      .catch(() => undefined);
    await client.subscriptions.list({}).catch(() => undefined);

    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const request of seen) {
      expect(request.headers.get('Polar-Version')).toBe(POLAR_API_VERSION);
    }
  });
});

// Issue #533: no Polar call is ever possible in demo mode, independently of `isBillingEnabled()`'s own
// override: this is the belt-and-suspenders check `getPolarClient()`'s own header describes.
describe('getPolarClient: refuses outright in demo mode (issue #533)', () => {
  const ORIGINAL = process.env[DEMO_MODE_FLAG_NAME];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env[DEMO_MODE_FLAG_NAME];
    else process.env[DEMO_MODE_FLAG_NAME] = ORIGINAL;
    resetPolarClientForTests();
  });

  it('throws DemoModeBlockedError before constructing a client', () => {
    process.env[DEMO_MODE_FLAG_NAME] = 'true';
    resetPolarClientForTests();
    expect(() => getPolarClient()).toThrow(DemoModeBlockedError);
  });

  it('never caches a client while demo mode is on (a later real call still gets refused)', () => {
    process.env[DEMO_MODE_FLAG_NAME] = 'true';
    resetPolarClientForTests();
    expect(() => getPolarClient()).toThrow(DemoModeBlockedError);
    expect(() => getPolarClient()).toThrow(DemoModeBlockedError);
  });
});
