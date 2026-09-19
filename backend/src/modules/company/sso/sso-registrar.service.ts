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
 * Removes the entry (if any) tagged with `providerId` from `entries`, IN PLACE. Matches both shapes
 * an entry can take: our own tagged thunk (identified WITHOUT calling it, so removal never triggers a
 * discovery fetch) and an already-built provider object. A standalone function, not a private method,
 * specifically so it never has an `await` of its own — `registerProviderId`/`unregisterProviderId`
 * both call this synchronously, with no yield point between the removal and whatever they do next; see
 * `registerProviderId`'s own header for why that matters.
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
 * Re-validated right here, not only at `sso.service.ts#upsert` write time: a hostname that resolved to
 * a public IP when the company saved its configuration can be repointed at an internal one by the
 * time a real sign-in attempt lazily triggers this build ("DNS rebinding" — see
 * `@/utils/outbound-url.ts`'s own header). `buildFor`'s own try/catch is what turns a rejection here
 * into "this one provider fails to build, logged" rather than a crash — the error message is kept
 * generic (never `OutboundUrlValidationError#reason` or the URL itself) so that log line cannot be
 * used as a network-scanning oracle by whoever can read it.
 *
 * Deliberately does NOT pin the connection the way the webhook/PDP/SdI guards do
 * (`pinnedDispatcher`/`pinnedNodeLookup`): the actual discovery/token/userinfo fetches this validates
 * for happen inside `genericOAuth()`'s own `init`/sign-in handling a few lines and, for the token
 * exchange, an entire separate HTTP request later — both go through `betterFetch`
 * (`@better-fetch/fetch`, via `better-auth`/`@better-auth/core`) with no `dispatcher` or custom-`fetch`
 * hook exposed anywhere in the `genericOAuth` config surface to connect through instead. This
 * re-validation narrows the DNS-rebinding window to whatever it costs to resolve DNS once more; it
 * does not close it the way the other three callers' pinning does. Documented here rather than
 * silently accepted: closing it for real would mean vendoring or monkey-patching better-auth's own
 * fetch internals.
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
 *
 * CROSS-REPLICA SYNC: `register`/`unregister` mutate `auth.$context.socialProviders` — an
 * object that exists ONLY in the memory of whichever API process actually runs this code. Before this
 * fix, a write served by replica A therefore never reached replica B's own copy of that array until B
 * happened to restart (the ONLY thing that re-runs `onModuleInit`'s own boot loop) — a customer could
 * configure SSO, get balanced to a different replica on their very next sign-in attempt, and find the
 * provider simply does not exist there. `sync` (optional — see the constructor's own comment) closes
 * that gap the same way the worker→API document-events bridge already does for a different problem
 * (`documents/queue/document-events-publisher.ts`/`document-events-bridge.ts`): `register`/`unregister`
 * PUBLISH the change after applying it locally, and `onModuleInit` additionally SUBSCRIBES so this
 * process re-applies whatever change any OTHER replica just made — typically within a Redis pub/sub
 * round trip (single-digit milliseconds), not "at the next restart". The existing boot-time loop from
 * the stored rows is UNCHANGED and still runs first — this sync is additive, not a replacement: a
 * replica that boots between two Redis publishes (or missed one outright, pub/sub has no replay) is
 * still fully correct once it reaches that loop, and stays eventually-consistent afterwards via sync.
 */
@Injectable()
export class SsoRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(SsoRegistrarService.name);

  /** Memoised builds, keyed by provider id. Cleared per-entry on failure so a retry is possible. */
  private readonly built = new Map<string, Promise<ProviderLike | null>>();

  /**
   * `sync` is injected BY TOKEN (`SSO_REGISTRY_SYNC`, `sso-registry-sync.ts`), typed as the bare
   * interface — see that token's own comment for why. `@Optional()` because Nest DI is not the only
   * caller: every existing unit test in `sso-registrar.service.spec.ts` constructs this class with
   * plain `new SsoRegistrarService(fakeSso())`, one argument, which bypasses Nest's container (and
   * therefore `@Inject`) entirely — `@Optional()` documents that the REAL wiring
   * (`company.module.ts`, which always provides the token) is not the only supported shape, not that
   * production itself might run without it.
   */
  constructor(
    private readonly sso: SsoService,
    @Optional() @Inject(SSO_REGISTRY_SYNC) private readonly sync?: SsoRegistrySync,
  ) {}

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

    // Hear about every OTHER replica's own register/unregister from now on — see this class's own
    // "CROSS-REPLICA SYNC" header section. Subscribed AFTER the boot loop above, deliberately: this
    // process is already correct from the stored rows by the time it starts listening, so there is no
    // window where an incoming sync message could race an in-progress boot registration of the SAME
    // provider.
    if (this.sync) {
      await this.sync.onMessage((message) => {
        void this.applyRemoteChange(message);
      });
    }
  }

  /** Register (or re-register) one company's provider, after an upsert. */
  async register(companyId: string): Promise<void> {
    const providerId = companyProviderId(companyId);
    // Drop any previous entry FIRST: an edited row must not leave the old configuration resolvable,
    // and the memoised build of the previous configuration must not outlive it.
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
   * Announces a change AFTER it is already applied locally — this replica is correct regardless of
   * whether the announcement itself is ever delivered. `SsoRegistrySyncService#publish`'s own real
   * implementation already never rejects (it logs and swallows), but this call site guards a second
   * time anyway: `register`/`unregister` run straight from `sso.controller.ts` after the company's
   * own write already committed to Postgres, and nothing about the `SsoRegistrySync` INTERFACE
   * promises a caller that no implementation will ever reject — a customer's "save my SSO settings"
   * request must not fail merely because telling OTHER replicas about it hiccupped.
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
   * Applies a change ANOTHER replica already made and already announced — never re-publishes (that
   * would echo forever across every replica). Reuses the exact same `registerProviderId`/
   * `unregisterProviderId` internals `register`/`unregister` themselves call, so a remote "register"
   * gets the identical drop-then-insert treatment a local one does (an edited configuration arriving
   * as a remote sync must replace the old entry, not stack a stale one beside it).
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
   * Awaited rather than fire-and-forget: `register()` must not return before the provider is actually
   * in the array, or a caller that immediately unregisters (an upsert that deactivates) could splice
   * the array before the insertion lands and leave a stale entry resolvable forever.
   *
   * Removes any PRE-EXISTING entry for this same `providerId` itself, synchronously, right before
   * inserting — never relies solely on a caller having already called `unregisterProviderId` first.
   * `register()`/`applyRemoteChange()` still do call it first (for the OTHER visible effect that has:
   * forgetting the previous memoised build below), but with `sync` wired in a SECOND, independent
   * `SsoRegistrarService`-driven mutation can now be in flight for the exact same provider at the
   * exact same time within ONE process — a replica's own publish echoes back to its OWN subscription
   * (Redis pub/sub delivers a publish to every subscriber, the publisher's own connection included),
   * so `register()`'s direct local call and the resulting self-echoed `applyRemoteChange` race each
   * other. Without this self-check, two overlapping "remove-then-insert" sequences can each find
   * NOTHING to remove (the other has not inserted yet) and then both insert — two stacked entries for
   * one provider, silently, until the next full unregister/re-register cycle. Doing the removal here
   * too, with no `await` between it and the `unshift` below, closes that window: whichever of the two
   * overlapping calls reaches this point LAST always removes what the other just inserted first.
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
