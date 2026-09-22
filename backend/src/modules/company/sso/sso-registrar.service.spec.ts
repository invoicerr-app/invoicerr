/**
 * SsoRegistrarService — the runtime registration of a per-company provider into the LIVE better-auth
 * provider list.
 *
 * TWO modules are mocked here, each for a reason worth stating.
 *
 * `@/lib/auth`, because importing it for real builds a Prisma adapter at import time and pulls in
 * `dotenv/config`, which would read this repository's own `.env` (it really does set `OIDC_CLIENT_ID`
 * and a discovery URL) and register the live environment provider. No spec in this repository imports
 * it. The mock supplies a synthetic context whose `socialProviders` array is the same object the
 * service mutates — exactly the relationship the real `auth.$context` has with every request.
 *
 * `better-auth/plugins`, because it cannot be loaded under Jest at all: the package ships ESM only
 * (`dist/plugins/index.mjs`) and this project's Jest config excludes `node_modules` from
 * transformation apart from `node-schematron`, so a real import fails with "Cannot use import
 * statement outside a module". Widening `transformIgnorePatterns` to cover better-auth would drag its
 * entire ESM dependency chain through the transformer and put all 262 suites at risk for one spec, so
 * the fake below reproduces the documented `init` contract instead: it returns
 * `{ context: { socialProviders: built.concat(ctx.socialProviders) } }`, and contributes NOTHING for a
 * config it declines — which is the real plugin's behaviour when discovery yields no usable endpoints
 * (it logs and `continue`s).
 *
 * So what this spec proves: the config handed to better-auth is the stored configuration, the
 * id-verification guard catches a declined config instead of silently returning another provider, the
 * entry inserted is shaped the way better-auth's own resolution requires, a broken provider cannot
 * break an unrelated sign-in (including one whose stored endpoint fails the outbound-URL guard's own
 * DNS-rebinding-safe re-check), removal finds its entry without triggering a build, and the
 * OIDC_ONLY boot assertion fires. What it does NOT prove: that the real `genericOAuth` builds a
 * working provider (only `npm run build` and the production path cover that), and nothing about a
 * real OAuth round-trip — there is no identity provider in this environment.
 *
 * A THIRD module is mocked for the same "no real network in a unit test" reason as the two above:
 * `@/utils/outbound-url`, whose own exhaustive decision-logic coverage is `outbound-url.spec.ts`'s job
 * (and `sso.service.spec.ts` for the write-time call). Here it only needs to prove it is CALLED, and
 * that a rejection propagates as "this one provider fails to build", never a crash — real DNS
 * resolution against `idp.acme.com` would make this spec flaky and network-dependent for no benefit.
 */

import { vi, type Mock } from 'vitest';

import { resetRegisteredCompanyProviders } from '@/lib/sso-registry';
import { auth } from '@/lib/auth';
import { assertPublicOutboundUrl } from '@/utils/outbound-url';
import { SsoRegistrySync, SsoRegistrySyncMessage } from './sso-registry-sync';
import { SsoProviderResolved, SsoService } from './sso.service';
import { SsoRegistrarService, buildCompanyProvider } from './sso-registrar.service';

vi.mock('@/utils/outbound-url', () => ({
  __esModule: true,
  assertPublicOutboundUrl: vi.fn().mockResolvedValue(undefined),
  OutboundUrlValidationError: class extends Error {},
}));

const mockedAssertPublicOutboundUrl = assertPublicOutboundUrl as Mock;

vi.mock('@/lib/auth', () => {
  // Built inside the factory rather than closed over: `vi.mock` is hoisted above the imports, so a
  // module-level const would still be in its temporal dead zone when the factory first runs.
  const context = {
    socialProviders: [] as unknown[],
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
  return { __esModule: true, auth: { $context: Promise.resolve(context) } };
});

vi.mock('better-auth/plugins', () => ({
  __esModule: true,
  // Mirrors the real plugin's `init`: each accepted config becomes a provider keyed by its
  // `providerId`, PREPENDED to whatever the context already had. A config whose clientId is the
  // decline marker contributes nothing, standing in for the real plugin's skip path. The config object
  // is attached to the result so a test can assert what was actually handed to the library.
  genericOAuth: (options: { config: { providerId: string; clientId: string }[] }) => ({
    id: 'generic-oauth',
    init: (ctx: { socialProviders: unknown[] }) => ({
      context: {
        socialProviders: [
          ...options.config
            .filter((config) => config.clientId !== 'DECLINE-THIS-CONFIG')
            .map((config) => ({ id: config.providerId, builtFrom: config })),
          ...ctx.socialProviders,
        ],
      },
    }),
  }),
}));

/** The clientId the faked plugin refuses to build, standing in for a config the real one skips. */
const DECLINED_CLIENT_ID = 'DECLINE-THIS-CONFIG';

interface FakeContext {
  socialProviders: unknown[];
  logger: { error: Mock };
}

const context = async (): Promise<FakeContext> => (await auth.$context) as unknown as FakeContext;

const COMPANY_ID = 'acme';
const PROVIDER_ID = 'c_acme';

const resolved = (overrides: Partial<SsoProviderResolved> = {}): SsoProviderResolved => ({
  companyId: COMPANY_ID,
  providerId: PROVIDER_ID,
  label: 'Acme SSO',
  authorizationUrl: 'https://idp.acme.com/authorize',
  tokenUrl: 'https://idp.acme.com/token',
  userInfoUrl: 'https://idp.acme.com/userinfo',
  scopes: ['openid', 'profile', 'email'],
  clientId: 'acme-client',
  clientSecret: 'acme-secret',
  ...overrides,
});

/**
 * better-auth's OWN provider resolution, reproduced exactly: `getAwaitableValue`
 * (`better-auth/dist/context/helpers.mjs`) walks the array, CALLS any entry that is a function, and
 * compares the result's `id`. Reproduced here rather than imported because better-auth does not expose
 * it from a public entry point — and reproducing it is the point: if the entries this service inserts
 * were not shaped the way that function requires, this is what would catch it.
 */
async function findProvider(entries: unknown[], providerId: string): Promise<{ id: string } | undefined> {
  for (const entry of entries) {
    const value = (typeof entry === 'function' ? await (entry as () => Promise<unknown>)() : entry) as {
      id: string;
    };
    if (value.id === providerId) return value;
  }
  return undefined;
}

const fakeSso = (overrides: Partial<Record<keyof SsoService, unknown>> = {}) =>
  ({
    listActiveRegistrations: vi.fn().mockResolvedValue([]),
    resolveForRegistration: vi.fn().mockResolvedValue(resolved()),
    ...overrides,
  }) as unknown as SsoService;

describe('buildCompanyProvider — better-auth constructs the provider, nothing here re-implements OAuth', () => {
  it('hands the library the stored configuration, under the per-company id', async () => {
    const ctx = { socialProviders: [], logger: { error: vi.fn() } };

    const built = await buildCompanyProvider(ctx as never, resolved());

    expect(built?.id).toBe(PROVIDER_ID);
    // What reached the library is this company's own stored configuration, not a default or a mix-up
    // with another tenant's.
    expect((built as unknown as { builtFrom: Record<string, unknown> }).builtFrom).toMatchObject({
      providerId: PROVIDER_ID,
      clientId: 'acme-client',
      clientSecret: 'acme-secret',
      authorizationUrl: 'https://idp.acme.com/authorize',
      tokenUrl: 'https://idp.acme.com/token',
      scopes: ['openid', 'profile', 'email'],
    });
  });

  it('re-validates every stored endpoint through the shared outbound-URL guard before building', async () => {
    const ctx = { socialProviders: [], logger: { error: vi.fn() } };

    await buildCompanyProvider(
      ctx as never,
      resolved({ discoveryUrl: 'https://idp.acme.com/.well-known/openid-configuration' }),
    );

    const checked = mockedAssertPublicOutboundUrl.mock.calls.map(([url]) => url);
    expect(checked).toEqual(
      expect.arrayContaining([
        'https://idp.acme.com/.well-known/openid-configuration',
        'https://idp.acme.com/authorize',
        'https://idp.acme.com/token',
        'https://idp.acme.com/userinfo',
      ]),
    );
  });

  it('refuses to build — never silently proceeds — when a stored endpoint fails that guard', async () => {
    // A hostname that resolved to a public IP when the company saved its configuration can be
    // repointed at an internal one by the time this thunk actually runs ("DNS rebinding") — this is
    // what proves the guard is re-run HERE, not only once at `sso.service.ts#upsert` write time.
    mockedAssertPublicOutboundUrl.mockRejectedValueOnce(
      new Error('outbound URL rejected: literal address is private/internal'),
    );
    const ctx = { socialProviders: [], logger: { error: vi.fn() } };

    await expect(buildCompanyProvider(ctx as never, resolved())).rejects.toThrow();
  });

  it('omits an absent client secret entirely rather than passing undefined for a public client', async () => {
    const ctx = { socialProviders: [], logger: { error: vi.fn() } };

    const built = await buildCompanyProvider(ctx as never, resolved({ clientSecret: undefined }));

    const config = (built as unknown as { builtFrom: Record<string, unknown> }).builtFrom;
    expect(Object.keys(config)).not.toContain('clientSecret');
  });

  it('returns null rather than the WRONG provider when the plugin declines the config', async () => {
    // THE load-bearing guard. When the real plugin rejects a config it logs and `continue`s,
    // contributing nothing — so reading `[0]` of its result would hand back the first PRE-EXISTING
    // provider, and this company's sign-ins would silently run on the environment provider's
    // configuration. The pre-existing provider here is what makes that failure observable.
    const ctx = { socialProviders: [{ id: 'pocketid' }], logger: { error: vi.fn() } };

    const built = await buildCompanyProvider(ctx as never, resolved({ clientId: DECLINED_CLIENT_ID }));

    expect(built).toBeNull();
  });

  it("does not mutate the context it is given — registration is the caller's job", async () => {
    const ctx = { socialProviders: [], logger: { error: vi.fn() } };
    await buildCompanyProvider(ctx as never, resolved());
    expect(ctx.socialProviders).toHaveLength(0);
  });
});

describe('SsoRegistrarService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetRegisteredCompanyProviders();
    (await context()).socialProviders.length = 0;
  });

  describe('register — a provider added after boot is immediately findable', () => {
    it("inserts an entry better-auth's own resolution finds under the per-company id", async () => {
      const service = new SsoRegistrarService(fakeSso());

      await service.register(COMPANY_ID);

      const entries = (await context()).socialProviders;
      expect(entries).toHaveLength(1);
      // Resolved through the same algorithm better-auth uses, thunk-calling included.
      expect((await findProvider(entries, PROVIDER_ID))?.id).toBe(PROVIDER_ID);
    });

    it('unshifts, so a company provider is never shadowed by an earlier entry', async () => {
      const ctx = await context();
      ctx.socialProviders.push({ id: 'pocketid' });

      await new SsoRegistrarService(fakeSso()).register(COMPANY_ID);

      expect(ctx.socialProviders).toHaveLength(2);
      expect((ctx.socialProviders[0] as { providerId?: string }).providerId).toBe(PROVIDER_ID);
    });

    it('defers the build: registering touches neither the stored secret nor the IdP', async () => {
      // Why thunks at all — booting must not decrypt every tenant's credentials, nor depend on every
      // customer's IdP being reachable.
      const sso = fakeSso();
      await new SsoRegistrarService(sso).register(COMPANY_ID);
      expect(sso.resolveForRegistration).not.toHaveBeenCalled();
    });

    it('memoises: the provider is built once per process however often it is resolved', async () => {
      const sso = fakeSso();
      const service = new SsoRegistrarService(sso);
      await service.register(COMPANY_ID);

      const entries = (await context()).socialProviders;
      await findProvider(entries, PROVIDER_ID);
      await findProvider(entries, PROVIDER_ID);
      await findProvider(entries, PROVIDER_ID);

      expect(sso.resolveForRegistration).toHaveBeenCalledTimes(1);
    });

    it('re-registering replaces the old entry instead of stacking a stale one', async () => {
      const service = new SsoRegistrarService(fakeSso());
      await service.register(COMPANY_ID);
      await service.register(COMPANY_ID);

      expect((await context()).socialProviders).toHaveLength(1);
    });

    it('re-registering forgets the previous build, so an edited configuration takes effect', async () => {
      // Otherwise a company that corrected its client secret would keep signing in against the old
      // one until the process restarted.
      const resolveForRegistration = vi
        .fn()
        .mockResolvedValueOnce(resolved({ clientId: 'first' }))
        .mockResolvedValue(resolved({ clientId: 'second' }));
      const service = new SsoRegistrarService(fakeSso({ resolveForRegistration }));

      await service.register(COMPANY_ID);
      await findProvider((await context()).socialProviders, PROVIDER_ID);
      await service.register(COMPANY_ID);
      const rebuilt = await findProvider((await context()).socialProviders, PROVIDER_ID);

      expect((rebuilt as unknown as { builtFrom: { clientId: string } }).builtFrom.clientId).toBe('second');
    });
  });

  describe('a broken provider must never break an unrelated sign-in', () => {
    it('resolves to a non-matching sentinel instead of throwing', async () => {
      // A thunk is awaited while better-auth walks the array looking for some OTHER provider, so a row
      // whose configuration cannot be resolved must not throw: it would take down sign-in for every
      // provider positioned behind it.
      const sso = fakeSso({ resolveForRegistration: vi.fn().mockResolvedValue(null) });
      const service = new SsoRegistrarService(sso);
      await service.register(COMPANY_ID);

      const ctx = await context();
      ctx.socialProviders.push({ id: 'pocketid' });

      // The environment provider, positioned BEHIND the broken company entry, still resolves.
      await expect(findProvider(ctx.socialProviders, 'pocketid')).resolves.toEqual({ id: 'pocketid' });
      // And the broken one simply never matches.
      await expect(findProvider(ctx.socialProviders, PROVIDER_ID)).resolves.toBeUndefined();
    });

    it('does not throw when the stored configuration itself errors', async () => {
      const sso = fakeSso({
        resolveForRegistration: vi.fn().mockRejectedValue(new Error('decrypt failed')),
      });
      const service = new SsoRegistrarService(sso);
      await service.register(COMPANY_ID);

      const entries = (await context()).socialProviders;
      await expect(findProvider(entries, PROVIDER_ID)).resolves.toBeUndefined();
    });

    it('a stored endpoint that fails the outbound-URL guard behaves like any other broken provider', async () => {
      // Persistent, not `Once`: `findProvider` below walks the array TWICE, and a failed build is
      // deliberately un-memoised (see `makeThunk`'s own header on why) so each walk re-invokes the
      // thunk — a `Once` rejection would only fail the first of those, and the second would then
      // build a real (unexpected) provider. Restored in `finally` so this does not leak into the
      // OTHER tests in this describe block, which all expect a successful build by default.
      mockedAssertPublicOutboundUrl.mockRejectedValue(new Error('outbound URL rejected'));
      try {
        const service = new SsoRegistrarService(fakeSso());
        await service.register(COMPANY_ID);

        const ctx = await context();
        ctx.socialProviders.push({ id: 'pocketid' });

        // The thunk swallows the rejection (see `makeThunk`'s own header) — never throws through
        // better-auth's own provider walk, and the environment provider behind it still resolves.
        await expect(findProvider(ctx.socialProviders, 'pocketid')).resolves.toEqual({ id: 'pocketid' });
        await expect(findProvider(ctx.socialProviders, PROVIDER_ID)).resolves.toBeUndefined();
      } finally {
        mockedAssertPublicOutboundUrl.mockResolvedValue(undefined);
      }
    });

    it('forgets a failure so a fixed IdP or key is retried without a restart', async () => {
      const resolveForRegistration = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(resolved());
      const service = new SsoRegistrarService(fakeSso({ resolveForRegistration }));
      await service.register(COMPANY_ID);

      const entries = (await context()).socialProviders;
      await expect(findProvider(entries, PROVIDER_ID)).resolves.toBeUndefined();
      // Second attempt actually retries rather than replaying the memoised failure.
      expect((await findProvider(entries, PROVIDER_ID))?.id).toBe(PROVIDER_ID);
      expect(resolveForRegistration).toHaveBeenCalledTimes(2);
    });
  });

  describe('unregister', () => {
    it('removes the entry, so a deleted provider stops resolving', async () => {
      const service = new SsoRegistrarService(fakeSso());
      await service.register(COMPANY_ID);
      await service.unregister(COMPANY_ID);

      const entries = (await context()).socialProviders;
      expect(entries).toHaveLength(0);
      await expect(findProvider(entries, PROVIDER_ID)).resolves.toBeUndefined();
    });

    it('finds the entry by its tag, without calling the thunk (so removal triggers no discovery)', async () => {
      const sso = fakeSso();
      const service = new SsoRegistrarService(sso);
      await service.register(COMPANY_ID);
      await service.unregister(COMPANY_ID);

      expect(sso.resolveForRegistration).not.toHaveBeenCalled();
    });

    it('leaves other providers alone', async () => {
      const ctx = await context();
      ctx.socialProviders.push({ id: 'pocketid' });
      const service = new SsoRegistrarService(fakeSso());
      await service.register(COMPANY_ID);

      await service.unregister(COMPANY_ID);

      expect(ctx.socialProviders).toEqual([{ id: 'pocketid' }]);
    });

    it('is a no-op for a company that was never registered', async () => {
      await expect(new SsoRegistrarService(fakeSso()).unregister('never-seen')).resolves.toBeUndefined();
    });
  });

  describe('onModuleInit', () => {
    it('registers every active stored provider at boot', async () => {
      const sso = fakeSso({
        listActiveRegistrations: vi.fn().mockResolvedValue([
          {
            companyId: 'a',
            providerId: 'c_a',
            label: 'A',
            discoveryUrl: null,
            authorizationUrl: null,
            tokenUrl: null,
          },
          {
            companyId: 'b',
            providerId: 'c_b',
            label: 'B',
            discoveryUrl: null,
            authorizationUrl: null,
            tokenUrl: null,
          },
        ]),
      });

      await new SsoRegistrarService(sso).onModuleInit();

      const entries = (await context()).socialProviders;
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => (e as { providerId?: string }).providerId).sort()).toEqual(['c_a', 'c_b']);
    });

    it('survives an unreachable database rather than taking the whole API down over SSO', async () => {
      const sso = fakeSso({
        listActiveRegistrations: vi.fn().mockRejectedValue(new Error('connection refused')),
      });
      await expect(new SsoRegistrarService(sso).onModuleInit()).resolves.toBeUndefined();
    });

    describe('the OIDC_ONLY boot assertion', () => {
      // `process.env` is shared across specs in a Jest worker, and importing this module tree loads
      // `dotenv/config` (through sso.service -> prisma.service), which sets this repository's real
      // OIDC_CLIENT_ID. Both variables are therefore controlled explicitly here.
      let savedOnly: string | undefined;
      let savedClientId: string | undefined;

      beforeEach(() => {
        savedOnly = process.env.OIDC_ONLY;
        savedClientId = process.env.OIDC_CLIENT_ID;
      });

      afterEach(() => {
        if (savedOnly === undefined) delete process.env.OIDC_ONLY;
        else process.env.OIDC_ONLY = savedOnly;
        if (savedClientId === undefined) delete process.env.OIDC_CLIENT_ID;
        else process.env.OIDC_CLIENT_ID = savedClientId;
      });

      it('refuses to boot when OIDC_ONLY is set and no provider exists anywhere', async () => {
        process.env.OIDC_ONLY = '1';
        delete process.env.OIDC_CLIENT_ID;

        await expect(new SsoRegistrarService(fakeSso()).onModuleInit()).rejects.toThrow(/OIDC_ONLY/);
      });

      it('boots when OIDC_ONLY is set and a company registered its own provider', async () => {
        process.env.OIDC_ONLY = '1';
        delete process.env.OIDC_CLIENT_ID;
        const sso = fakeSso({
          listActiveRegistrations: vi.fn().mockResolvedValue([
            {
              companyId: 'a',
              providerId: 'c_a',
              label: 'A',
              discoveryUrl: null,
              authorizationUrl: null,
              tokenUrl: null,
            },
          ]),
        });

        await expect(new SsoRegistrarService(sso).onModuleInit()).resolves.toBeUndefined();
      });

      it('boots when OIDC_ONLY is set and the environment provider is configured', async () => {
        process.env.OIDC_ONLY = 'true';
        process.env.OIDC_CLIENT_ID = 'env-client';

        await expect(new SsoRegistrarService(fakeSso()).onModuleInit()).resolves.toBeUndefined();
      });

      it('boots a default instance with no providers at all (mutation check: OIDC_ONLY is opt-in)', async () => {
        delete process.env.OIDC_ONLY;
        delete process.env.OIDC_CLIENT_ID;

        await expect(new SsoRegistrarService(fakeSso()).onModuleInit()).resolves.toBeUndefined();
      });
    });
  });

  /**
   * The actual defect and its fix. A bare `new SsoRegistrarService(fakeSso())` (every case
   * above) never constructs a `sync`, standing in for the pre-fix codebase entirely — that this
   * codebase's own default now behaves exactly like production BEFORE the fix is the point: the fix
   * is additive, not a behaviour change for a caller that supplies nothing.
   *
   * `fakeBus()` below is a tiny, in-memory, synchronous stand-in for two ioredis connections pointed
   * at the same Redis (`publish` on one instance calls every `onMessage` handler registered on ANY
   * instance sharing the same bus) — the "second module instance sharing a fake shared backend" shape
   * used elsewhere in this fix (`lib/auth-rate-limit.spec.ts`'s own `fakeSharedStore`) to simulate two
   * replicas without a real network.
   */
  describe('cross-replica sync', () => {
    function fakeBus(): { forReplica: () => SsoRegistrySync } {
      const handlers: Array<(message: SsoRegistrySyncMessage) => void> = [];
      return {
        forReplica: () => ({
          async publish(message) {
            for (const handler of handlers) handler(message);
          },
          async onMessage(handler) {
            handlers.push(handler);
          },
        }),
      };
    }

    /**
     * `onModuleInit`'s own subscription handler applies an incoming message via `void
     * this.applyRemoteChange(message)` — deliberately fire-and-forget, matching what a REAL ioredis
     * 'message' event handler must be (nothing is ever waiting on it; `publish()` on the wire only
     * ever confirms delivery TO Redis, never that a subscriber finished reacting). `fakeBus#publish`
     * mirrors that same non-blocking shape, so a test that calls `register()`/`unregister()` and
     * immediately inspects `auth.$context` must give the other replica's fire-and-forget handler a
     * chance to actually finish its own two awaited steps first — a `setImmediate` round trip drains
     * every microtask queued so far (unlike a bare extra `await`, which only guarantees ONE more tick,
     * not "however many this handler's own chain needs").
     */
    function flush(): Promise<void> {
      return new Promise((resolve) => setImmediate(resolve));
    }

    it(
      'a register() on replica A is applied on replica B too — without B ever restarting — closing the ' +
        'exact gap named in this file\'s own header ("a write served by one process does not register ' +
        'the provider in another\'s memory until that one restarts")',
      async () => {
        const bus = fakeBus();
        const replicaA = new SsoRegistrarService(fakeSso(), bus.forReplica());
        const replicaB = new SsoRegistrarService(fakeSso(), bus.forReplica());
        // Both replicas subscribe, exactly as `onModuleInit` does in production — with no stored rows,
        // so this isolates the SYNC path from the boot-time reseed path.
        await replicaA.onModuleInit();
        await replicaB.onModuleInit();
        (await context()).socialProviders.length = 0; // the OIDC_ONLY assertion above needs nothing.

        await replicaA.register(COMPANY_ID);
        await flush();

        // Replica B never called `.register()` itself — its own copy of the (shared, in this test
        // process) `auth.$context.socialProviders` array was updated purely by RECEIVING replica A's
        // published change.
        const entries = (await context()).socialProviders;
        expect((await findProvider(entries, PROVIDER_ID))?.id).toBe(PROVIDER_ID);
      },
    );

    it('an unregister() on replica A removes the entry on replica B too', async () => {
      const bus = fakeBus();
      const replicaA = new SsoRegistrarService(fakeSso(), bus.forReplica());
      const replicaB = new SsoRegistrarService(fakeSso(), bus.forReplica());
      await replicaA.onModuleInit();
      await replicaB.onModuleInit();
      (await context()).socialProviders.length = 0;
      await replicaA.register(COMPANY_ID);
      await flush();

      await replicaA.unregister(COMPANY_ID);
      await flush();

      const entries = (await context()).socialProviders;
      expect(await findProvider(entries, PROVIDER_ID)).toBeUndefined();
    });

    it(
      're-registering on replica A never leaves a stale duplicate on replica B — even though a ' +
        "replica's own publish echoes back to its OWN subscription too (Redis pub/sub delivers a " +
        "publish to every subscriber, the publisher's own connection included), so replica A's local " +
        'call and its self-echoed remote apply race each other on the SAME array',
      async () => {
        const bus = fakeBus();
        const replicaA = new SsoRegistrarService(fakeSso(), bus.forReplica());
        const replicaB = new SsoRegistrarService(fakeSso(), bus.forReplica());
        await replicaA.onModuleInit();
        await replicaB.onModuleInit();
        (await context()).socialProviders.length = 0;

        await replicaA.register(COMPANY_ID);
        await flush();
        await flush();
        await replicaA.register(COMPANY_ID); // an edited configuration, re-saved.
        await flush();
        await flush();

        // Never stacked — exactly one entry, on the ONE array both replicas share in this test
        // (see this describe block's own header on why `auth.$context` is process-global here).
        const entries = (await context()).socialProviders;
        expect(entries).toHaveLength(1);
        expect((await findProvider(entries, PROVIDER_ID))?.id).toBe(PROVIDER_ID);
      },
    );

    it('never publishes when no sync was supplied — the default, every other case in this file', async () => {
      // Guards against a regression where `register`/`unregister` might call `this.sync.publish`
      // unconditionally instead of `this.sync?.publish` — which would throw on `undefined` and break
      // every single test above this describe block instead of merely this one.
      await expect(new SsoRegistrarService(fakeSso()).register(COMPANY_ID)).resolves.toBeUndefined();
      await expect(new SsoRegistrarService(fakeSso()).unregister(COMPANY_ID)).resolves.toBeUndefined();
    });

    it('a publish failure never propagates out of register()/unregister() — the local write already succeeded', async () => {
      // Even though the REAL `SsoRegistrySyncService#publish` already never rejects on its own (it
      // logs and swallows internally), `register`/`unregister` guard a second time — a customer's
      // "save my SSO settings" request must not fail merely because telling OTHER replicas hiccupped.
      // A rejecting fake proves that second guard exists, not just the concrete class's own.
      const failingSync: SsoRegistrySync = {
        publish: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        onMessage: vi.fn().mockResolvedValue(undefined),
      };
      const service = new SsoRegistrarService(fakeSso(), failingSync);

      await expect(service.register(COMPANY_ID)).resolves.toBeUndefined();
      // The local registration itself was NOT skipped — only the announcement failed.
      expect((await findProvider((await context()).socialProviders, PROVIDER_ID))?.id).toBe(PROVIDER_ID);

      await expect(service.unregister(COMPANY_ID)).resolves.toBeUndefined();
      expect(await findProvider((await context()).socialProviders, PROVIDER_ID)).toBeUndefined();
      expect(failingSync.publish).toHaveBeenCalledTimes(2);
    });
  });
});
