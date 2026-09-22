/**
 * The wire shape + channel name for the per-company SSO provider registry's cross-replica sync.
 * See `sso-registrar.service.ts`'s own header for the registry itself, and for why a write
 * served by one API process previously never reached another's memory until that one restarted — this
 * is the fix: a single, cluster-wide Redis channel every replica subscribes to at boot, on top of (not
 * instead of) the existing boot-time registration from the stored rows.
 *
 * Kept in its OWN file, with no Redis/ioredis import at all — the same "pure shape, separate from the
 * plumbing that moves it" split `modules/documents/queue/document-events.ts` already holds for the
 * document-events bridge, for the identical reason: a spec depends on the SHAPE alone.
 *
 * ONE shared channel, not one per company (unlike `document-events.ts`'s own per-company channels):
 * SSO provider registration is a rare, admin-driven action — a customer wiring up SSO once, not a
 * per-request event — so there is no volume reason to shard by tenant, and every replica needs to
 * hear about every company's own change regardless (it cannot know in advance which company's users
 * will next be routed to it by the load balancer).
 */
export type SsoRegistrySyncAction = 'register' | 'unregister';

export interface SsoRegistrySyncMessage {
  companyId: string;
  action: SsoRegistrySyncAction;
}

export const SSO_REGISTRY_SYNC_CHANNEL = 'sso-registry-sync';

/** The narrow shape `SsoRegistrarService` depends on — never the concrete, ioredis-backed
 *  `SsoRegistrySyncService` (`sso-registry-sync.service.ts`) — the same "depend on the interface, not
 *  the class" discipline `document-webhooks.ts`'s own `DocumentWebhookEmitter` already holds, for the
 *  identical reason: a spec passes a bare `{ publish: vi.fn(), onMessage: vi.fn() }`, no Nest, no
 *  Redis, no ioredis connection, ever. */
export interface SsoRegistrySync {
  publish(message: SsoRegistrySyncMessage): Promise<void>;
  onMessage(handler: (message: SsoRegistrySyncMessage) => void): Promise<void>;
}

/**
 * The Nest injection TOKEN for `SsoRegistrySync` — a bare TS interface has no runtime representation,
 * so Nest cannot resolve it by TYPE the way it resolves a concrete class (`sso: SsoService` on the
 * same constructor already does). `@Inject(SSO_REGISTRY_SYNC)` is the standard Nest way to inject an
 * ABSTRACTION by token while the field itself stays typed as the interface — see
 * `document-webhooks.ts`'s own `DOCUMENT_WEBHOOK_EMITTER` comment for the fuller account of why this
 * matters (there: keeping specs from pulling in an unrelated ESM dependency chain; here: keeping
 * `SsoRegistrarService`'s OWN spec — which constructs it with plain `new`, never through Nest DI —
 * free to pass nothing at all and get a fully offline, no-Redis default).
 * `company.module.ts` provides it with `{ provide: SSO_REGISTRY_SYNC, useExisting:
 * SsoRegistrySyncService }`.
 */
export const SSO_REGISTRY_SYNC = Symbol('SSO_REGISTRY_SYNC');
