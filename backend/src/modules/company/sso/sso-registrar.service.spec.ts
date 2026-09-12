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
 * break an unrelated sign-in, removal finds its entry without triggering a build, and the OIDC_ONLY
 * boot assertion fires. What it does NOT prove: that the real `genericOAuth` builds a working
 * provider (only `npm run build` and the production path cover that), and nothing about a real OAuth
 * round-trip — there is no identity provider in this environment.
 */
import { resetRegisteredCompanyProviders } from '@/lib/sso-registry';
import { auth } from '@/lib/auth';
import { SsoProviderResolved, SsoService } from './sso.service';
import { SsoRegistrarService, buildCompanyProvider } from './sso-registrar.service';

jest.mock('@/lib/auth', () => {
  // Built inside the factory rather than closed over: `jest.mock` is hoisted above the imports, so a
  // module-level const would still be in its temporal dead zone when the factory first runs.
  const context = {
    socialProviders: [] as unknown[],
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
  };
  return { __esModule: true, auth: { $context: Promise.resolve(context) } };
});

jest.mock('better-auth/plugins', () => ({
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
  logger: { error: jest.Mock };
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
    listActiveRegistrations: jest.fn().mockResolvedValue([]),
    resolveForRegistration: jest.fn().mockResolvedValue(resolved()),
    ...overrides,
  }) as unknown as SsoService;

describe('buildCompanyProvider — better-auth constructs the provider, nothing here re-implements OAuth', () => {
  it('hands the library the stored configuration, under the per-company id', async () => {
    const ctx = { socialProviders: [], logger: { error: jest.fn() } };

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

  it('omits an absent client secret entirely rather than passing undefined for a public client', async () => {
    const ctx = { socialProviders: [], logger: { error: jest.fn() } };

    const built = await buildCompanyProvider(ctx as never, resolved({ clientSecret: undefined }));

    const config = (built as unknown as { builtFrom: Record<string, unknown> }).builtFrom;
    expect(Object.keys(config)).not.toContain('clientSecret');
  });

  it('returns null rather than the WRONG provider when the plugin declines the config', async () => {
    // THE load-bearing guard. When the real plugin rejects a config it logs and `continue`s,
    // contributing nothing — so reading `[0]` of its result would hand back the first PRE-EXISTING
    // provider, and this company's sign-ins would silently run on the environment provider's
    // configuration. The pre-existing provider here is what makes that failure observable.
    const ctx = { socialProviders: [{ id: 'pocketid' }], logger: { error: jest.fn() } };

    const built = await buildCompanyProvider(ctx as never, resolved({ clientId: DECLINED_CLIENT_ID }));

    expect(built).toBeNull();
  });

  it("does not mutate the context it is given — registration is the caller's job", async () => {
    const ctx = { socialProviders: [], logger: { error: jest.fn() } };
    await buildCompanyProvider(ctx as never, resolved());
    expect(ctx.socialProviders).toHaveLength(0);
  });
});

describe('SsoRegistrarService', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
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
      const resolveForRegistration = jest
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
      const sso = fakeSso({ resolveForRegistration: jest.fn().mockResolvedValue(null) });
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
        resolveForRegistration: jest.fn().mockRejectedValue(new Error('decrypt failed')),
      });
      const service = new SsoRegistrarService(sso);
      await service.register(COMPANY_ID);

      const entries = (await context()).socialProviders;
      await expect(findProvider(entries, PROVIDER_ID)).resolves.toBeUndefined();
    });

    it('forgets a failure so a fixed IdP or key is retried without a restart', async () => {
      const resolveForRegistration = jest.fn().mockResolvedValueOnce(null).mockResolvedValue(resolved());
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
        listActiveRegistrations: jest.fn().mockResolvedValue([
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
        listActiveRegistrations: jest.fn().mockRejectedValue(new Error('connection refused')),
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
          listActiveRegistrations: jest.fn().mockResolvedValue([
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
});
