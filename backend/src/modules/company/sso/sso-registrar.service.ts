import { Injectable, Inject, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { genericOAuth } from 'better-auth/plugins';

import { auth } from '@/lib/auth';
import { assertPublicOutboundUrl } from '@/utils/outbound-url';
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
import { SSO_REGISTRY_SYNC, SsoRegistrySync, SsoRegistrySyncMessage } from './sso-registry-sync';
import { SsoProviderResolved, SsoService } from './sso.service';

/**
 * The minimum better-auth needs of a provider entry to resolve one: `getAwaitableValue` walks
 * `ctx.socialProviders`, calls each function entry and compares the result's id. Typed locally because
 * better-auth exposes no public provider type.
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
 * Removes the entry tagged with `providerId` in place, matching a tagged thunk without calling it (so
 * removal never triggers a discovery fetch) or an already-built provider. A standalone function so it
 * has no await of its own: callers stay synchronous between removal and their next step.
 */
function removeProviderEntry(entries: ProviderEntry[], providerId: string): void {
  const index = entries.findIndex((entry) =>
    typeof entry === 'function' ? entry.providerId === providerId : entry.id === providerId,
  );
  if (index >= 0) {
    entries.splice(index, 1);
  }
}

/**
 * Re-validated here, not only at write time: the hostname can be repointed at an internal address
 * before a later sign-in lazily builds this provider. `buildFor` turns a rejection into "this provider
 * failed to build", logged with a generic message, never the reason or the URL, which would make the
 * log a scanning oracle.
 *
 * It cannot pin the connection like the webhook and transport guards: the fetches happen inside
 * `genericOAuth` and `betterFetch`, with no dispatcher or fetch hook exposed. This narrows the
 * rebinding window, it does not close it; doing so would mean patching better-auth.
 */
async function assertResolvedEndpointsArePublic(resolved: SsoProviderResolved): Promise<void> {
  const allowPrivateForTesting = process.env.ALLOW_PRIVATE_OUTBOUND_URLS === '1';
  const urls = [resolved.discoveryUrl, resolved.authorizationUrl, resolved.tokenUrl, resolved.userInfoUrl];
  for (const url of urls) {
    if (!url) continue;
    try {
      await assertPublicOutboundUrl(url, { allowPrivateForTesting });
    } catch {
      throw new Error(
        `SSO provider ${resolved.providerId} has an endpoint that failed outbound-URL validation.`,
      );
    }
  }
}

/**
 * Builds a better-auth provider for one company through the plugin's own construction
 * (`genericOAuth({ config: [cfg] }).init(ctx)`), so no OAuth is re-implemented here.
 *
 * The returned provider's id is verified against the expected one because the plugin skips an invalid
 * config and contributes nothing, which would leave `[0]` as another provider and hand this company's
 * sign-ins the wrong configuration. Null instead.
 */
export async function buildCompanyProvider(
  ctx: AuthContextLike,
  resolved: SsoProviderResolved,
): Promise<ProviderLike | null> {
  await assertResolvedEndpointsArePublic(resolved);

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
 * It works because `auth.$context` is the one context every request reads, and the `socialProviders`
 * array is shared by reference across its shallow copies, so an insertion after boot is visible to the
 * next request.
 *
 * Entries are thunks so booting never depends on a customer's IdP being reachable and never decrypts a
 * secret just to learn a row exists; the thunk memoises, paying the cost once per provider per process.
 *
 * A thunk must never throw: it is awaited while better-auth looks for another provider, so a broken row
 * would break unrelated sign-ins. On failure it logs and returns an empty-id sentinel, which never
 * matches, and forgets its memo so a later attempt retries.
 *
 * The array lives in one process's memory, so `register`/`unregister` publish the change and every
 * replica subscribes, instead of waiting for a restart. The boot loop from the stored rows still runs
 * first and stays the source of truth when a publish is missed.
 */
@Injectable()
export class SsoRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(SsoRegistrarService.name);

  /** Memoised builds, keyed by provider id. Cleared per-entry on failure so a retry is possible. */
  private readonly built = new Map<string, Promise<ProviderLike | null>>();

  /**
   * `sync` is injected by token, typed as the bare interface. `@Optional()` because unit tests build
   * this class with plain `new`, bypassing Nest's container; production always provides the token.
   */
  constructor(
    private readonly sso: SsoService,
    @Optional() @Inject(SSO_REGISTRY_SYNC) private readonly sync?: SsoRegistrySync,
  ) {}

  /**
   * Registers every stored provider at boot, then refuses to boot an instance nobody could log into.
   *
   * The OIDC_ONLY assertion lives here because answering it means reading the provider rows, which this
   * already does. It counts configured providers, not reachable ones: a customer's IdP being down is a
   * different question from the operator leaving no way to authenticate at all.
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

    // Subscribed after the boot loop: this process is already correct from the stored rows before it
    // starts listening, so an incoming message cannot race the boot registration.
    if (this.sync) {
      await this.sync.onMessage((message) => {
        void this.applyRemoteChange(message);
      });
    }
  }

  /** Register (or re-register) one company's provider, after an upsert. */
  async register(companyId: string): Promise<void> {
    const providerId = companyProviderId(companyId);
    // Drop the previous entry first: an edited row must not leave the old configuration resolvable, and
    // its memoised build must not outlive it.
    await this.unregisterProviderId(providerId);
    await this.registerProviderId(providerId);
    await this.publishSyncChange(companyId, 'register');
  }

  /** Remove one company's provider, after a delete or a deactivation. */
  async unregister(companyId: string): Promise<void> {
    await this.unregisterProviderId(companyProviderId(companyId));
    await this.publishSyncChange(companyId, 'unregister');
  }

  /**
   * Publishes a change after applying it locally, so this replica is correct whether or not the
   * announcement arrives. Guarded even though the real implementation never rejects: the interface
   * promises nothing, and a customer's save must not fail because notifying other replicas hiccuped.
   */
  private async publishSyncChange(companyId: string, action: 'register' | 'unregister'): Promise<void> {
    if (!this.sync) return;
    try {
      await this.sync.publish({ companyId, action });
    } catch (error) {
      this.logger.warn(
        `Could not publish an SSO registry sync for company ${companyId} — other replicas will only ` +
          `pick this up at their own next boot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Applies a change another replica already made, without re-publishing (which would echo forever).
   * Reuses the same internals as a local register/unregister, so a remote edit replaces the old entry
   * rather than stacking beside it.
   */
  private async applyRemoteChange(message: SsoRegistrySyncMessage): Promise<void> {
    const providerId = companyProviderId(message.companyId);
    if (message.action === 'register') {
      await this.unregisterProviderId(providerId);
      await this.registerProviderId(providerId);
    } else {
      await this.unregisterProviderId(providerId);
    }
  }

  /**
   * Awaited, not fire-and-forget: a caller that immediately unregisters must not splice the array
   * before this insertion lands.
   *
   * The removal happens here too, synchronously before the insert. With sync wired in, a publish echoes
   * back to its own subscriber, so a local register and the self-echoed remote apply can overlap: each
   * could find nothing to remove and both insert, stacking two entries for one provider.
   */
  private async registerProviderId(providerId: string): Promise<void> {
    const thunk = this.makeThunk(providerId);
    const ctx = await this.context();
    removeProviderEntry(ctx.socialProviders, providerId);
    // `unshift`, not `push`: position decides who wins a lookup, and a company's own provider must
    // never be shadowed by an entry registered earlier.
    ctx.socialProviders.unshift(thunk);
    markCompanyProviderRegistered(providerId);
  }

  private async unregisterProviderId(providerId: string): Promise<void> {
    const ctx = await this.context();
    removeProviderEntry(ctx.socialProviders, providerId);
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
