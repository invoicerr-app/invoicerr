import { vi } from 'vitest';

import express from 'express';
import type { Request, Response } from 'express';
import type { AddressInfo } from 'node:net';

import { CLIENT_IP_HEADER, injectClientIpHeaderMiddleware } from './client-ip-header';

function fakeReq(ip: string, headers: Record<string, string> = {}): Request {
  return { ip, headers } as unknown as Request;
}

function fakeRes(): Response {
  return {} as Response;
}

describe('injectClientIpHeaderMiddleware (unit)', () => {
  const next = vi.fn();

  afterEach(() => {
    next.mockClear();
  });

  it("sets the header to Express's own req.ip when absent", () => {
    const req = fakeReq('203.0.113.9');
    injectClientIpHeaderMiddleware()(req, fakeRes(), next);

    expect(req.headers[CLIENT_IP_HEADER]).toBe('203.0.113.9');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it(
    'OVERWRITES a client-supplied value rather than keeping or appending to it — the actual fix: a ' +
      'client must never be able to inject its own value into the header better-auth trusts',
    () => {
      const req = fakeReq('203.0.113.9', { [CLIENT_IP_HEADER]: '1.2.3.4' });
      injectClientIpHeaderMiddleware()(req, fakeRes(), next);

      expect(req.headers[CLIENT_IP_HEADER]).toBe('203.0.113.9');
      expect(req.headers[CLIENT_IP_HEADER]).not.toContain('1.2.3.4');
    },
  );

  it('always calls next() — never short-circuits the chain', () => {
    injectClientIpHeaderMiddleware()(fakeReq('203.0.113.9'), fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

/**
 * Integration-level proof, against a REAL Express app with `trust proxy` set exactly like
 * `create-app.ts` configures it — the unit tests above stub `req.ip` directly, which proves the
 * middleware's own overwrite logic but says nothing about whether `req.ip` itself resolves correctly
 * against a MULTI-ENTRY `X-Forwarded-For`, which is the entire scenario this fix exists for. Trust
 * proxy is set to `2` here — the Helm chart's own default (`deploy/helm/invoicerr/values.yaml`,
 * `app.trustProxyHops`), i.e. the real beta topology this defect was measured against: an Ingress in
 * front of the in-pod nginx, TWO real HTTP-aware hops, so a legitimate request's own
 * `X-Forwarded-For` genuinely carries two entries (`<client>, <ingress-observed-peer>`) — nginx's own
 * `$proxy_add_x_forwarded_for` (`nginx.conf`) appends its directly observed peer (the Ingress) to
 * whatever it received (the client, from the Ingress). See `lib/trust-proxy.spec.ts` /
 * `trust-proxy-http.spec.ts` for the hop-counting contract this relies on. A real `app.listen()` +
 * real HTTP request is what actually exercises Express's `proxy-addr` resolution, not just this file's
 * own code.
 */
describe('injectClientIpHeaderMiddleware (integration — real Express, real X-Forwarded-For)', () => {
  const TRUST_PROXY_HOPS = 2;
  /** Stands in for the Ingress's own address, as nginx directly observed it — the second, TRUSTED
   *  entry `$proxy_add_x_forwarded_for` appends. Constant across cases: only the client (leftmost)
   *  entry varies from one case to the next. */
  const TRUSTED_PROXY_PEER = '10.0.0.1';

  function createTestServer() {
    const app = express();
    app.set('trust proxy', TRUST_PROXY_HOPS);
    app.use(injectClientIpHeaderMiddleware());
    app.get('/probe', (req, res) => {
      res.json({ resolvedIp: req.ip, headerSeenByHandler: req.headers[CLIENT_IP_HEADER] });
    });
    return app;
  }

  async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
    const app = createTestServer();
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const { port } = server.address() as AddressInfo;
      await run(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }

  it(
    'resolves each of two distinct client addresses correctly through a genuine two-hop ' +
      'X-Forwarded-For — proves the fix actually gives two different clients two different header ' +
      "values, not the shared bucket better-auth's own getIP() would otherwise fall back to",
    async () => {
      await withServer(async (baseUrl) => {
        const first = await fetch(`${baseUrl}/probe`, {
          headers: { 'x-forwarded-for': `198.51.100.1, ${TRUSTED_PROXY_PEER}` },
        });
        const second = await fetch(`${baseUrl}/probe`, {
          headers: { 'x-forwarded-for': `198.51.100.2, ${TRUSTED_PROXY_PEER}` },
        });

        const firstBody = (await first.json()) as { resolvedIp: string; headerSeenByHandler: string };
        const secondBody = (await second.json()) as { resolvedIp: string; headerSeenByHandler: string };

        expect(firstBody.resolvedIp).toBe('198.51.100.1');
        expect(secondBody.resolvedIp).toBe('198.51.100.2');
        expect(firstBody.headerSeenByHandler).toBe('198.51.100.1');
        expect(secondBody.headerSeenByHandler).toBe('198.51.100.2');
        expect(firstBody.headerSeenByHandler).not.toBe(secondBody.headerSeenByHandler);
      });
    },
  );

  it('a client-supplied CLIENT_IP_HEADER is ignored — overwritten with the real resolved address', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/probe`, {
        headers: {
          'x-forwarded-for': `198.51.100.5, ${TRUSTED_PROXY_PEER}`,
          [CLIENT_IP_HEADER]: '10.0.0.1',
        },
      });
      const body = (await response.json()) as { resolvedIp: string; headerSeenByHandler: string };

      expect(body.headerSeenByHandler).toBe('198.51.100.5');
      expect(body.headerSeenByHandler).not.toBe('10.0.0.1');
    });
  });

  it(
    'the SAME client address keeps producing the SAME header value across repeated requests — a ' +
      'sanity check that a limiter keyed on this header still limits a genuinely repeated caller',
    async () => {
      await withServer(async (baseUrl) => {
        const responses = await Promise.all(
          Array.from({ length: 5 }, () =>
            fetch(`${baseUrl}/probe`, {
              headers: { 'x-forwarded-for': `198.51.100.9, ${TRUSTED_PROXY_PEER}` },
            }),
          ),
        );
        const bodies = (await Promise.all(responses.map((r) => r.json()))) as Array<{
          headerSeenByHandler: string;
        }>;

        for (const body of bodies) {
          expect(body.headerSeenByHandler).toBe('198.51.100.9');
        }
      });
    },
  );
});

/**
 * End-to-end proof of the actual CONSEQUENCE this middleware exists for, not just the header value it
 * produces: a limiter keyed on `CLIENT_IP_HEADER` — standing in for better-auth's own bundled rate
 * limiter, which is exactly this shape (`getIP()` resolves one header value, then keys a fixed-window
 * counter on it, `node_modules/better-auth/dist/api/rate-limiter/index.mjs`) — gives two different
 * client addresses two independent budgets, keeps limiting one address that keeps calling, and cannot
 * be evaded by a client forging the header itself. `better-auth` is not imported here (ESM-only, see
 * `main.middleware.spec.ts`'s own header for why no spec in this codebase imports `lib/auth.ts` or
 * anything that transitively pulls it in) — this reproduces only the keying CONTRACT the fix relies on,
 * with a trivial fixed-window counter of the test's own. Same two-hop topology as the describe block
 * above (trust proxy 2, a trusted-peer second entry) — see that block's own header for why.
 */
describe('injectClientIpHeaderMiddleware (integration — a downstream limiter keyed on the header)', () => {
  const TRUSTED_PROXY_PEER = '10.0.0.1';

  function createLimitedServer(max: number) {
    const app = express();
    app.set('trust proxy', 2);
    app.use(injectClientIpHeaderMiddleware());

    const counts = new Map<string, number>();
    app.use((req, res, next) => {
      const key = String(req.headers[CLIENT_IP_HEADER]);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      if (count > max) {
        res.status(429).json({ key });
        return;
      }
      next();
    });

    app.get('/probe', (_req, res) => res.status(200).json({ ok: true }));
    return app;
  }

  async function withLimitedServer(max: number, run: (baseUrl: string) => Promise<void>): Promise<void> {
    const app = createLimitedServer(max);
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const { port } = server.address() as AddressInfo;
      await run(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }

  it("two different client addresses get two independent buckets — neither exhausts the other's budget", async () => {
    await withLimitedServer(1, async (baseUrl) => {
      const clientA = await fetch(`${baseUrl}/probe`, {
        headers: { 'x-forwarded-for': `198.51.100.20, ${TRUSTED_PROXY_PEER}` },
      });
      const clientB = await fetch(`${baseUrl}/probe`, {
        headers: { 'x-forwarded-for': `198.51.100.21, ${TRUSTED_PROXY_PEER}` },
      });

      // THE BUG this whole fix answers: pre-fix (keying on getIP()'s own resolution of the raw,
      // multi-entry X-Forwarded-For, which it refuses to trust at all with no `trustedProxies`
      // configured), both of these would collapse into ONE shared bucket and the second request would
      // already be the second hit against the SAME key.
      expect(clientA.status).toBe(200);
      expect(clientB.status).toBe(200);
    });
  });

  it('the SAME client address keeps being limited once it crosses the budget', async () => {
    await withLimitedServer(2, async (baseUrl) => {
      const headers = { 'x-forwarded-for': `198.51.100.30, ${TRUSTED_PROXY_PEER}` };
      const first = await fetch(`${baseUrl}/probe`, { headers });
      const second = await fetch(`${baseUrl}/probe`, { headers });
      const third = await fetch(`${baseUrl}/probe`, { headers });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
    });
  });

  it('a client cannot dodge or poison the bucket by supplying its own CLIENT_IP_HEADER', async () => {
    await withLimitedServer(1, async (baseUrl) => {
      // Same real address (via X-Forwarded-For) on both calls, but the second tries to spoof a
      // DIFFERENT identity via the header the middleware is supposed to own exclusively.
      const first = await fetch(`${baseUrl}/probe`, {
        headers: { 'x-forwarded-for': `198.51.100.40, ${TRUSTED_PROXY_PEER}` },
      });
      const second = await fetch(`${baseUrl}/probe`, {
        headers: {
          'x-forwarded-for': `198.51.100.40, ${TRUSTED_PROXY_PEER}`,
          [CLIENT_IP_HEADER]: '9.9.9.9',
        },
      });

      expect(first.status).toBe(200);
      // If the spoofed header were honoured, this would land in a FRESH bucket (9.9.9.9) and return
      // 200 again, defeating the limiter entirely. Overwritten, it lands back in the same, now-
      // exhausted bucket for 198.51.100.40.
      expect(second.status).toBe(429);
    });
  });
});
