import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { genericOAuth } from 'better-auth/plugins';

import { auth } from '@/lib/auth';
import {
  companyIdFromProviderId,
  companyProviderId,
  isOidcOnly,
  resolveEnvOidcProvider,
} from '@/lib/sso-policy';
import { assertOidcOnlyHasProvider } from '@/lib/secret-guard';
import {
  markCompanyProviderRegistered,
  markCompanyProviderUnregistered,
  registeredCompanyProviderCount,
} from '@/lib/sso-registry';
import { SsoProviderResolved, SsoService } from './sso.service';

/**
 * The minimum better-auth needs of a provider entry to resolve one: `getAwaitableValue`
 * (`better-auth/dist/context/helpers.mjs`) iterates `ctx.socialProviders`, calls any entry that is a
 * function, and compares the result's `id` against the id being looked up. Typed locally rather than
 * imported because better-auth does not export its provider type from a public entry point.
 */
interface ProviderLike {
  id: string;
}

/** An entry in the live `socialProviders` array: a built provider, or a thunk returning one. */
type ProviderEntry = ProviderLike | ProviderThunk;

/** A thunk, tagged with the id it will return so it can be found and removed WITHOUT calling it. */
interface ProviderThunk {
  (): Promise<ProviderLike>;
  providerId: string;
}

/** The slice of better-auth's context this file touches. */
interface AuthContextLike {
  socialProviders: ProviderEntry[];
  logger: { error: (message: string, ...args: unknown[]) => void };
}

/**
 * Build a better-auth provider for one company, using better-auth's OWN provider construction.
 *
 * `genericOAuth({ config: [cfg] }).init(ctx)` is the exact code path a provider declared at boot goes
 * through — discovery fetch, JWKS binding, PKCE defaults, token-endpoint auth, id_token verification —
 * so nothing about OAuth is re-implemented here. `init` returns
 * `{ context: { socialProviders: built.concat(ctx.socialProviders) } }`, which is why the result is
 * read positionally.
 *
 * The id is then VERIFIED against the one expected, and that check is load-bearing rather than
 * defensive: when the plugin rejects a config (discovery yielding no usable authorization or token
 * endpoint, an invalid jwks_uri) it logs and `continue`s, contributing NOTHING to the array — so
 * `[0]` would silently be the first pre-existing provider instead, and this company's sign-ins would
 * be handed the environment provider's configuration. Returns null instead.
 *
 * Exported for `sso-registrar.service.spec.ts`, which drives it with a synthetic context so the real
 * construction is exercised without a network call or a Nest container.
 */
export async function buildCompanyProvider(
  ctx: AuthContextLike,
  resolved: SsoProviderResolved,
): Promise<ProviderLike | null> {
  const plugin = genericOAuth({
    config: [
      {
        providerId: resolved.providerId,
        clientId: resolved.clientId,
        ...(resolved.clientSecret ? { clientSecret: resolved.clientSecret } : {}),
        ...(resolved.discoveryUrl ? { discoveryUrl: resolved.discoveryUrl } : {}),
        ...(resolved.authorizationUrl ? { authorizationUrl: resolved.authorizationUrl } : {}),
        ...(resolved.tokenUrl ? { tokenUrl: resolved.tokenUrl } : {}),
        ...(resolved.userInfoUrl ? { userInfoUrl: resolved.userInfoUrl } : {}),
        scopes: resolved.scopes,
      },
    ],
  });

  // The plugin's `init` wants the full `AuthContext`; this file deliberately types only the slice it
  // actually touches (see `AuthContextLike`), which is also what lets a spec drive it with a synthetic
  // context. Cast through the plugin's own parameter type rather than `any`, so a signature change in
  // better-auth still surfaces here.
  type PluginInitContext = Parameters<NonNullable<ReturnType<typeof genericOAuth>['init']>>[0];
  const result = await plugin.init?.(ctx as unknown as PluginInitContext);
  const built = (result as { context?: { socialProviders?: ProviderLike[] } } | undefined)?.context
    ?.socialProviders?.[0];

  if (!built || built.id !== resolved.providerId) {
    return null;
  }
  return built;
}

/**
 * Registers every company's own OIDC provider with the live better-auth instance.
 *
 * Why this works at all: `auth.$context` resolves to the ONE context object every request reads. A
 * plugin's `init` result is merged into it with `Object.assign` at startup, and each request then
 * shallow-copies it (`Object.create(..., Object.getOwnPropertyDescriptors(ctx))` — see
 * `better-auth/dist/auth/base.mjs`), so the `socialProviders` ARRAY is shared by reference and an
 * insertion made after boot is visible to the very next request. No restart, no re-instantiation.
 *
 * Entries are registered as THUNKS, which `getAwaitableValue` explicitly supports, for two reasons:
 * booting the API must not depend on every customer's IdP being reachable (an eager build would fetch
 * each discovery document at startup, so one tenant's outage would slow or silently degrade every
 * boot), and it must not decrypt every tenant's client secret merely to learn that a row exists. The
 * thunk memoises, so the cost is paid once per provider per process rather than once per lookup.
 *
 * A thunk must NEVER throw: it is awaited while better-auth walks the array looking for some OTHER
 * provider, so a broken row would otherwise break unrelated sign-ins. On failure it logs and returns a
 * sentinel whose id is the empty string — which can never equal a real provider id, so the walk simply
 * continues — and forgets its memo so a later attempt retries once the IdP or the key is fixed.
 */
@Injectable()
export class SsoRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(SsoRegistrarService.name);

  /** Memoised builds, keyed by provider id. Cleared per-entry on failure so a retry is possible. */
  private readonly built = new Map<string, Promise<ProviderLike | null>>();

  constructor(private readonly sso: SsoService) {}

  /**
   * Register every stored provider at boot, then refuse to boot an instance nobody could log into.
   *
   * The OIDC_ONLY assertion lives here rather than beside its sibling in `main.ts` because answering
   * "does any company have a provider?" means reading `CompanySsoProvider`, and this is the place that
   * already reads exactly those rows. It counts CONFIGURED providers, not reachable ones: whether a
   * customer's IdP is currently up is a different question from whether the operator has left the
   * instance with no way to authenticate at all.
   */
  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.sso.listActiveRegistrations();
      for (const row of rows) {
        await this.registerProviderId(row.providerId);
      }
      if (rows.length > 0) {
        this.logger.log(`Registered ${rows.length} per-company SSO provider(s).`);
      }
    } catch (error) {
      // A database that is not reachable yet must not take the whole API down over SSO: the providers
      // simply are not registered, and `OIDC_ONLY` below is evaluated on what IS known.
      this.logger.error(`Could not register per-company SSO providers: ${(error as Error).message}`);
    }

    assertOidcOnlyHasProvider({
      oidcOnly: isOidcOnly(),
      envProviderRegistered: resolveEnvOidcProvider().registered,
      companyProviderCount: registeredCompanyProviderCount(),
    });
  }

  /** Register (or re-register) one company's provider, after an upsert. */
  async register(companyId: string): Promise<void> {
    const providerId = companyProviderId(companyId);
    // Drop any previous entry FIRST: an edited row must not leave the old configuration resolvable,
    // and the memoised build of the previous configuration must not outlive it.
    await this.unregisterProviderId(providerId);
    await this.registerProviderId(providerId);
  }

  /** Remove one company's provider, after a delete or a deactivation. */
  async unregister(companyId: string): Promise<void> {
    await this.unregisterProviderId(companyProviderId(companyId));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Awaited rather than fire-and-forget: `register()` must not return before the provider is actually
   * in the array, or a caller that immediately unregisters (an upsert that deactivates) could splice
   * the array before the insertion lands and leave a stale entry resolvable forever.
   */
  private async registerProviderId(providerId: string): Promise<void> {
    const thunk = this.makeThunk(providerId);
    const ctx = await this.context();
    // `unshift`, not `push`: position decides who wins a lookup, and a company's own provider must
    // never be shadowed by an entry registered earlier.
    ctx.socialProviders.unshift(thunk);
    markCompanyProviderRegistered(providerId);
  }

  private async unregisterProviderId(providerId: string): Promise<void> {
    const ctx = await this.context();
    // Matches both shapes an entry can take: our own tagged thunk (identified WITHOUT calling it, so
    // removal never triggers a discovery fetch) and an already-built provider object.
    const index = ctx.socialProviders.findIndex((entry) =>
      typeof entry === 'function' ? entry.providerId === providerId : entry.id === providerId,
    );
    if (index >= 0) {
      ctx.socialProviders.splice(index, 1);
    }
    this.built.delete(providerId);
    markCompanyProviderUnregistered(providerId);
  }

  private makeThunk(providerId: string): ProviderThunk {
    const thunk = (async (): Promise<ProviderLike> => {
      let pending = this.built.get(providerId);
      if (!pending) {
        pending = this.buildFor(providerId);
        this.built.set(providerId, pending);
      }

      const provider = await pending;
      if (!provider) {
        // Forget the failure so the next attempt retries — a transient IdP outage or a key that has
        // since been fixed must not stay broken until the process restarts.
        this.built.delete(providerId);
        // Never throw: better-auth awaits this entry while searching for some OTHER provider. An id of
        // "" cannot match any real lookup, so the walk continues unharmed.
        return { id: '' };
      }
      return provider;
    }) as ProviderThunk;

    thunk.providerId = providerId;
    return thunk;
  }

  private async buildFor(providerId: string): Promise<ProviderLike | null> {
    const companyId = companyIdFromProviderId(providerId);
    if (!companyId) return null;

    try {
      const resolved = await this.sso.resolveForRegistration(companyId);
      if (!resolved) {
        this.logger.warn(`SSO provider ${providerId} has no usable stored configuration.`);
        return null;
      }
      const ctx = await this.context();
      const built = await buildCompanyProvider(ctx, resolved);
      if (!built) {
        this.logger.error(
          `SSO provider ${providerId} could not be built — check the discovery URL and endpoints.`,
        );
      }
      return built;
    } catch (error) {
      this.logger.error(`SSO provider ${providerId} failed to build: ${(error as Error).message}`);
      return null;
    }
  }

  private async context(): Promise<AuthContextLike> {
    return (await auth.$context) as unknown as AuthContextLike;
  }
}
