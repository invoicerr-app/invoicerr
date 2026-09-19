/**
 * Proves the `main.ts` body-parser fix against a real HTTP socket. What this file does NOT do, and
 * why, first — it matters for reading everything below:
 *
 * `createApp()` (`create-app.ts`, imported by `main.ts`) is not called here. It imports `auth` from
 * `lib/auth.ts` unconditionally,
 * and importing `lib/auth.ts` AT ALL turns out to be impossible under this repo's Jest setup:
 * `better-auth` ITSELF is ESM-only across nearly every subpath export `lib/auth.ts` needs — confirmed
 * by reading `node_modules/better-auth/package.json`'s own "exports" map: `./node`, `./api`,
 * `./plugins`, `./adapters/prisma` each carry only a `"default"` condition pointing at an `.mjs` file,
 * no `"require"` condition, no CJS build at all. Real Node (this repo's runtime, v22+) `require()`s
 * ESM like that transparently and `lib/auth.ts` boots fine; Jest's own CJS module loader cannot load a
 * single one of them ("SyntaxError: Cannot use import statement outside a module") — confirmed
 * directly while writing this file: a first version of this spec built a real
 * `@thallesp/nestjs-better-auth` `AuthModule` for its own test-only auth instance and failed on
 * exactly this, at `@thallesp/nestjs-better-auth/dist/index.cjs:5` (`require('better-auth/node')`),
 * before any Polar-related code ever ran. This is the real reason this codebase's own convention is
 * that no spec imports `lib/auth.ts` (`sso-policy.ts` notes the convention too) — this used to ALSO be
 * true of `@polar-sh/better-auth` (its bundled `dist/index.cjs` unconditionally `require`d the
 * browser-only, ESM-only `@polar-sh/checkout/embed`), until that whole dependency was removed
 * 2026-09-16 when hosted billing moved off it entirely (`billing.controller.ts`'s own header) — the
 * `better-auth`-itself reason alone was always sufficient on its own, Polar was never the only cause.
 *
 * So the fix itself lives in two places: `main.ts` wires it up (unchanged, still what `bootstrap()`
 * runs in production), but the actual skip PREDICATE + WRAPPER — the part a test can actually reach
 * — was pulled into `lib/body-parser-auth-skip.ts`, which has zero dependency on `better-auth`. That
 * file has its own plain unit spec (`body-parser-auth-skip.spec.ts`) for the matching logic itself.
 *
 * THIS file's job is different: prove that wiring `skipBodyParserFor` via a plain `app.use()` call —
 * exactly what `main.ts` does — actually wins the ordering race against a middleware registered the
 * way `@thallesp/nestjs-better-auth`'s own `AuthModule.configure()` registers its
 * `SkipBodyParsingMiddleware` (via `MiddlewareConsumer` inside a `NestModule#configure()`, wired up
 * only inside `NestApplication.init()` — see `main.ts`'s own comment at the call site for the full
 * mechanism). It builds a real `NestFactory.create()` app, applies the real, imported
 * `skipBodyParserFor` the same way `main.ts` does, registers a `NestModule#configure()` middleware of
 * its own standing in for "whatever a late-registered auth library reads the raw body itself" —
 * reading the raw Node request stream directly via `node:stream/consumers#text` (a Node builtin, not
 * better-auth's own `toNodeHandler`/`getRequest`, unavailable under Jest for the reason above; what
 * matters for this bug is only whether something upstream already drained the stream, which is
 * exactly as true of a raw Node stream read as of a Web `Request` built from one) — then verifies a
 * genuinely-signed payload with `standardwebhooks#Webhook`, the exact primitive `@polar-sh/sdk`'s own
 * `validateEvent` delegates to for HMAC verification (confirmed by reading
 * `@polar-sh/sdk/dist/commonjs/webhooks.js`: `new Webhook(base64Secret).verify(body, headers)` after
 * base64-encoding the raw secret — this file's own middleware does the identical two steps), the same
 * library `webhook-signature.spec.ts` already uses to sign+verify in isolation. Real `app.listen(0)`
 * (an OS-picked ephemeral port), real HTTP over that socket — not `app.init()` alone — so the full
 * `NestApplication.init()` → `registerModules()` → `configure()` sequence this bug is about actually
 * runs, exactly like a real `bootstrap()`.
 *
 * `WEBHOOK_PATH`/`TestPolarWebhookMiddleware` below stand in for "whatever real `/api/auth/*` route
 * reads its own raw body" — as of 2026-09-15 that is no longer literally true of a Polar webhook:
 * `POST /api/auth/polar/webhooks` was removed along with `@polar-sh/better-auth`'s own `webhooks()`
 * sub-plugin (see `modules/billing/polar-webhook.controller.ts`'s own header), and the real Polar
 * receiver now lives at `POST /api/billing/webhooks/polar` — deliberately NOT under `/api/auth`, so it
 * never exercises this skip at all. The mechanism this file proves is still exactly as necessary for
 * every OTHER `/api/auth/*` route (sign-in, checkout, portal, …), so the illustrative path/middleware
 * names below are kept rather than renamed away from their original, real-incident example.
 */
import { Injectable, Module } from '@nestjs/common';
import type { INestApplication, MiddlewareConsumer, NestMiddleware, NestModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as bodyParser from 'body-parser';
import type { NextFunction, Request, Response } from 'express';
import { text } from 'node:stream/consumers';
import { Webhook } from 'standardwebhooks';

import { skipBodyParserFor } from './lib/body-parser-auth-skip';

const AUTH_BASE_PATH = '/api/auth';
const WEBHOOK_PATH = `${AUTH_BASE_PATH}/polar/webhooks`;
const TEST_WEBHOOK_SECRET = 'whsec_main_middleware_spec_test_secret';

const onWebhookVerified = jest.fn();

/**
 * Stands in for `@thallesp/nestjs-better-auth`'s `SkipBodyParsingMiddleware` + better-auth's own
 * webhook route COMBINED — registered the exact same way that library registers both
 * (`consumer.apply(...).forRoutes(...)` inside a `NestModule#configure()`), which is the one
 * load-bearing fact this test needs: Nest only wires a `configure()` middleware up inside
 * `NestApplication.init()`, reached only from `app.listen()`/`app.init()` — never any earlier,
 * regardless of where in `main.ts`'s source text a body parser is registered via plain `app.use()`.
 * See this file's own header for why the real `AuthModule` itself can't stand in here.
 */
@Injectable()
class TestPolarWebhookMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.method !== 'POST' || req.originalUrl.split('?')[0] !== WEBHOOK_PATH) {
      next();
      return;
    }
    // The raw stream read: EMPTY here whenever something upstream already drained `req` — exactly the
    // production symptom (`ctx.request.text()` reading empty, `validateEvent` then rejecting a
    // correctly-signed body with "No matching signature found").
    const buf = await text(req);
    try {
      const headers = {
        'webhook-id': String(req.headers['webhook-id'] ?? ''),
        'webhook-timestamp': String(req.headers['webhook-timestamp'] ?? ''),
        'webhook-signature': String(req.headers['webhook-signature'] ?? ''),
      };
      // Same two steps `@polar-sh/sdk`'s own `validateEvent` performs — see this file's own header.
      const base64Secret = Buffer.from(TEST_WEBHOOK_SECRET, 'utf-8').toString('base64');
      const payload = new Webhook(base64Secret).verify(buf, headers);
      onWebhookVerified(payload);
      res.status(200).json({ received: true });
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** A normal, non-auth JSON route — proves the fix is SCOPED to `/api/auth`, not a global parsing
 *  bypass: `req.body` must still arrive parsed here exactly as before. */
@Injectable()
class EchoMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (req.method !== 'POST' || req.originalUrl.split('?')[0] !== '/api/echo') {
      next();
      return;
    }
    res.status(200).json({ echoed: req.body });
  }
}

@Module({ providers: [TestPolarWebhookMiddleware, EchoMiddleware] })
class TestHarnessModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Both registered here, inside `configure()` — wired up late, deliberately, to reproduce the
    // exact timing `@thallesp/nestjs-better-auth`'s own `AuthModule` relies on in production.
    consumer.apply(TestPolarWebhookMiddleware, EchoMiddleware).forRoutes('*path');
  }
}

/** Builds the app the same way `create-app.ts#createApp()` does for the body-parser section specifically —
 *  `app.use()` calls BEFORE `app.listen()`, `skipBodyParserFor` imported unmodified from
 *  `lib/body-parser-auth-skip.ts` — against `TestHarnessModule` instead of the real `AppModule`
 *  (see this file's own header for why). */
async function createTestApp(): Promise<INestApplication> {
  const app = await NestFactory.create(TestHarnessModule, { bodyParser: false });
  app.setGlobalPrefix('api');
  app.use(
    skipBodyParserFor(
      AUTH_BASE_PATH,
      bodyParser.json({
        verify: (req, _res, buf) => {
          (req as unknown as { rawBody?: Buffer }).rawBody = buf;
        },
      }),
    ),
  );
  return app;
}

function signedHeaders(body: string, secret: string, webhookId = 'msg_1', timestamp = new Date()) {
  const base64Secret = Buffer.from(secret, 'utf-8').toString('base64');
  const signature = new Webhook(base64Secret).sign(webhookId, timestamp, body);
  return {
    'webhook-id': webhookId,
    'webhook-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
    'webhook-signature': signature,
  };
}

describe('main.ts body-parser fix — /api/auth/* keeps its raw body downstream', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await createTestApp();
    // Port 0: the OS picks a free ephemeral port — a real socket, not `app.init()` alone, so the
    // whole `NestApplication.init()` → `registerModules()` → `TestHarnessModule.configure()`
    // sequence this bug is about actually runs, exactly like a real `bootstrap()`.
    await app.listen(0);
    const address = app.getHttpServer().address();
    if (typeof address === 'string' || address === null) {
      throw new Error('Expected the test server to bind a TCP port.');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    onWebhookVerified.mockClear();
  });

  it('delivers a genuinely-signed webhook body intact: the handler sees the real payload, 200', async () => {
    const body = JSON.stringify({ type: 'subscription.active', data: { id: 'sub_test_1' } });
    const headers = signedHeaders(body, TEST_WEBHOOK_SECRET);

    const response = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });

    // Pre-fix, this was unconditionally 400 ("No matching signature found") — `bodyParser.json()`
    // had already drained the stream before the downstream handler ever read it, no matter what body
    // was actually sent or how correctly it was signed.
    expect(response.status).toBe(200);
    expect(onWebhookVerified).toHaveBeenCalledTimes(1);
    expect(onWebhookVerified).toHaveBeenCalledWith(expect.objectContaining({ type: 'subscription.active' }));
  });

  it('refuses a payload signed with the WRONG secret: 400, handler never called', async () => {
    const body = JSON.stringify({ type: 'subscription.active', data: { id: 'sub_test_2' } });
    const headers = signedHeaders(body, 'a-completely-different-secret');

    const response = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { message?: string };
    expect(payload.message).toMatch(/no matching signature/i);
    expect(onWebhookVerified).not.toHaveBeenCalled();
  });

  it('refuses a request with no signature headers at all: 400, handler never called', async () => {
    const body = JSON.stringify({ type: 'subscription.active', data: { id: 'sub_test_3' } });

    const response = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    expect(response.status).toBe(400);
    expect(onWebhookVerified).not.toHaveBeenCalled();
  });

  it('still parses a normal /api/echo JSON body — the skip is scoped to /api/auth, not global', async () => {
    const response = await fetch(`${baseUrl}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ echoed: { hello: 'world' } });
  });
});
