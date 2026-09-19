/**
 * Proves `resolveTrustProxyHops()` (`lib/trust-proxy.ts`) against a REAL HTTP socket and Express's own
 * `trust proxy` resolution (`proxy-addr`, via `app.getHttpAdapter().getInstance().set('trust proxy', n)`
 * — exactly what `create-app.ts` wires) — not merely that the function returns the right number, which
 * `lib/trust-proxy.spec.ts` already covers.
 *
 * `nginx.conf` itself is out of reach of a backend unit test (it's a separate process/config file), so
 * this reproduces its CONTRACT instead: nginx's own `X-Forwarded-For` handling now APPENDS its directly-
 * observed peer to whatever it received (`$proxy_add_x_forwarded_for`) rather than overwriting it (see
 * that file's own comment) — so a request arriving at THIS process carries a comma-separated chain with
 * exactly one entry per real HTTP-aware hop in front of it, oldest (the real client) first, nginx's own
 * appended entry always last. Sending a synthetic `X-Forwarded-For` header directly to this test's own
 * bare Nest app reproduces exactly what Express itself receives after nginx has done that appending —
 * this file does not need a real nginx in front to prove the hop-counting contract between the two.
 *
 * Deliberately does NOT import `create-app.ts` — that file imports `lib/auth.ts`, which is ESM-only and
 * cannot be loaded the way this project's test tooling loads specs (see `main.middleware.spec.ts`'s own
 * header for the full account). This file reproduces only the ONE line under test
 * (`app.set('trust proxy', ...)`, `create-app.ts`'s own call site) against a throwaway harness module.
 */
import { Controller, Get, Injectable, Module, Req } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request } from 'express';

import { resolveTrustProxyHops } from './lib/trust-proxy';

@Injectable()
@Controller()
class WhoAmIController {
  @Get('whoami')
  whoami(@Req() req: Request): { ip: string } {
    return { ip: req.ip ?? '' };
  }
}

@Module({ controllers: [WhoAmIController] })
class TrustProxyHarnessModule {}

async function buildApp(hops: number): Promise<{ app: INestApplication; baseUrl: string }> {
  const app = await NestFactory.create(TrustProxyHarnessModule, { logger: false });
  // The exact call `create-app.ts` makes, with the exact value `resolveTrustProxyHops()` would compute
  // for whatever env this test passes it — see this file's own header for why `create-app.ts` itself
  // cannot be imported directly here.
  app.getHttpAdapter().getInstance().set('trust proxy', hops);
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (typeof address === 'string' || address === null) {
    throw new Error('Expected the test server to bind a TCP port.');
  }
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function whoami(baseUrl: string, xForwardedFor?: string): Promise<string> {
  const response = await fetch(`${baseUrl}/whoami`, {
    headers: xForwardedFor ? { 'X-Forwarded-For': xForwardedFor } : {},
  });
  const body = (await response.json()) as { ip: string };
  return body.ip;
}

describe('trust proxy hop count — real HTTP, with and without a forwarded-for chain', () => {
  it('TRUST_PROXY_HOPS defaults to 1 when unset — resolveTrustProxyHops(process.env) matches create-app.ts', () => {
    expect(resolveTrustProxyHops({})).toBe(1);
  });

  describe("single hop (default, TRUST_PROXY_HOPS unset — today's docker-compose.yml topology)", () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
      ({ app, baseUrl } = await buildApp(resolveTrustProxyHops({})));
    });
    afterAll(async () => {
      await app.close();
    });

    it('with no X-Forwarded-For at all, resolves to the raw socket peer (a direct connection)', async () => {
      const ip = await whoami(baseUrl);
      expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(ip);
    });

    it("with nginx's own single-hop chain (one entry — the real client, as $remote_addr saw it), resolves to it", async () => {
      const ip = await whoami(baseUrl, '203.0.113.9');
      expect(ip).toBe('203.0.113.9');
    });

    it(
      'THE BUG THIS FIXES, reproduced: a load balancer added in front while this stays at 1 hop makes ' +
        "every client resolve to the balancer's own address, never the real client — proves why the " +
        'count has to be raised, not merely why appending in nginx.conf is safe on its own',
      async () => {
        // nginx appended ITS OWN peer (the load balancer's address) after whatever the balancer itself
        // forwarded — a real client's address, then the balancer's.
        const ip = await whoami(baseUrl, '203.0.113.9, 198.51.100.1');
        expect(ip).toBe('198.51.100.1'); // the balancer, not the real client at 203.0.113.9.
      },
    );
  });

  describe("two hops (TRUST_PROXY_HOPS=2 — a load balancer or the Helm chart's Ingress in front of nginx)", () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
      ({ app, baseUrl } = await buildApp(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '2' })));
    });
    afterAll(async () => {
      await app.close();
    });

    it('resolves the REAL client through a two-hop chain (balancer -> nginx -> this process)', async () => {
      const ip = await whoami(baseUrl, '203.0.113.9, 198.51.100.1');
      expect(ip).toBe('203.0.113.9');
    });

    it("a client-injected fake prefix beyond the trusted count is ignored — spoofing still doesn't work", async () => {
      // An attacker's own request would never pass through the balancer AND nginx with a THIRD,
      // attacker-controlled entry surviving both hops' own real address recording — but even if one
      // somehow did, only the two trusted, nearest entries are ever read.
      const ip = await whoami(baseUrl, '10.0.0.66, 203.0.113.9, 198.51.100.1');
      expect(ip).toBe('203.0.113.9');
    });
  });
});
