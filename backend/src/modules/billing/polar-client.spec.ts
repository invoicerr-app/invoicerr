import util from 'node:util';

import { vi, type Mock } from 'vitest';

// The REAL SDK class, not a hand-rolled lookalike (`CLAUDE.md`'s own "delegate to libs" preference) —
// constructing an actual `HTTPValidationError` with a real `Request`/`Response` is what proves the
// leak (and the fix) against the exact shape `@polar-sh/sdk` produces, not a guess at it.
import { HTTPValidationError } from '@polar-sh/sdk/models/errors/httpvalidationerror.js';

import { callPolarWithRetry, sanitizePolarError, withSanitizedPolarErrors } from './polar-client';

/** Builds a REAL `HTTPValidationError` the way `@polar-sh/sdk`'s own generated `customersCreate.js`
 *  does (read directly): a real `Request` carrying the bearer token as its `Authorization` header, a
 *  real `Response` carrying the 422 body, matching the exact live incident this file's own header
 *  describes (`checkout-session.ts` sending an empty `email` to `customers.create`). */
function realHttpValidationError(bearerToken: string): HTTPValidationError {
  const detail = [
    {
      loc: ['body', 'individual', 'email'],
      msg: 'value is not a valid email address: An email address must have an @-sign.',
      type: 'value_error',
      input: '',
    },
  ];
  const request = new Request('https://api.polar.sh/v1/customers/', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearerToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'individual', email: '' }),
  });
  const body = JSON.stringify({ detail });
  const response = new Response(body, { status: 422, headers: { 'content-type': 'application/json' } });
  return new HTTPValidationError(
    { detail, request$: request, response$: response, body$: body },
    { request, response, body },
  );
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

  it('never retries a non-429 failure — a business refusal or outage is not something a retry fixes', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('polar is down'));

    await expect(callPolarWithRetry(fn, 'test call', { baseDelayMs: 1 })).rejects.toThrow('polar is down');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is BOUNDED — gives up and rethrows once maxAttempts is exhausted, never retries forever', async () => {
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
    // steps) — spying on the GLOBAL setTimeout also catches whatever OTHER timers the test runner
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
  // FAILS ON THE OLD BEHAVIOUR: proves the vulnerability this file exists to close. If this assertion
  // ever starts failing on its own, `@polar-sh/sdk` changed shape and the rest of this describe block
  // needs re-checking against the new one — it is not a redundant check.
  it('the raw, unsanitized SDK error really does carry the bearer token in a logged dump', () => {
    const error = realHttpValidationError('polar_oat_SUPERSECRETTOKEN123');

    expect(util.inspect(error, { depth: 6 })).toContain('polar_oat_SUPERSECRETTOKEN123');
  });

  it('strips the bearer token while keeping the status code and validation detail a log line needs', () => {
    const error = realHttpValidationError('polar_oat_SUPERSECRETTOKEN123');

    const sanitized = sanitizePolarError(error) as { statusCode: number; detail: unknown[] };
    const dump = util.inspect(sanitized, { depth: 6 });

    expect(dump).not.toContain('polar_oat_SUPERSECRETTOKEN123');
    expect(dump).not.toContain('authorization');
    // The diagnostic value survives — this is a redaction, not a swallow (this file's own header).
    expect(sanitized.statusCode).toBe(422);
    expect(sanitized.detail).toEqual([
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
    const error = realHttpValidationError('polar_oat_ANOTHERSECRET456');
    const client = withSanitizedPolarErrors({ customers: { create: vi.fn().mockRejectedValue(error) } });

    const caught = await client.customers.create({}).catch((e: unknown) => e);

    expect(util.inspect(caught, { depth: 6 })).not.toContain('polar_oat_ANOTHERSECRET456');
    expect((caught as { statusCode: number }).statusCode).toBe(422);
  });

  // Mirrors `@polar-sh/sdk`'s own `Customers extends ClientSDK` shape (`sdk/customers.js`, read
  // directly): a nested namespace exposed as a GETTER, memoized onto private state keyed by `this`. If
  // the proxy ever invoked that getter — or the method it hands back — with `this` bound to the proxy
  // instead of the real instance, the private lookup below misses and throws a DIFFERENT error than
  // the one under test, which is exactly the regression this test guards against (see
  // `withSanitizedPolarErrors`'s own header on `Reflect.get(obj, prop, obj)`).
  it('preserves `this` through a getter-exposed nested namespace backed by private state', async () => {
    const state = new WeakMap<object, { calls: number }>();
    class Nested {
      async create(): Promise<never> {
        const own = state.get(this as object);
        if (!own) throw new Error('private state missed — `this` was not the real instance');
        own.calls++;
        throw realHttpValidationError('polar_oat_NESTEDSECRET789');
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
