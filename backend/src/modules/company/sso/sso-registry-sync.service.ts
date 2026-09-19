/**
 * Redis pub/sub plumbing behind `sso-registry-sync.ts`'s own wire shape — closes the cross-replica
 * registry gap `sso-registrar.service.ts`'s own header describes:
 * `SsoRegistrarService` injects this (optionally — see that file's own header) to publish a change
 * after it applies one locally, and to hear about a change some OTHER replica applied.
 *
 * Modeled directly on `modules/documents/queue/document-events-publisher.ts` /
 * `document-events-bridge.ts` (the worker-to-API bridge already proven safe for this exact shape:
 * PUBLISH on any connection, SUBSCRIBE only on a connection dedicated to nothing else — see those
 * files' own headers for why the two can never share a client). Folded into ONE class here rather
 * than split into two, unlike that pair: there is exactly one consumer of this channel
 * (`SsoRegistrarService`), so there is no reader/writer living in different Nest modules the way the
 * document-events split serves (a worker publishes, only the API's controller module subscribes).
 *
 * `createLibRedisClient()` (`lib/redis-connection.ts`), not `documents/queue/redis.config.ts` —
 * `modules/company/sso/` has no existing dependency on the documents module, and this file has no
 * reason to add one purely for a Redis connection helper (see `lib/redis-connection.ts`'s own header).
 *
 * Both connections are opened LAZILY, on first actual use (`publish`/`onMessage`), never at
 * construction — so merely having this class in `CompanyModule`'s own `providers` (it always is)
 * costs a real spec nothing: every existing `SsoRegistrarService` unit test constructs that service
 * with NO second constructor argument at all, so this class is never even instantiated by them, let
 * alone connected.
 */
import { EventEmitter } from 'node:events';

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { createLibRedisClient } from '@/lib/redis-connection';

import { SSO_REGISTRY_SYNC_CHANNEL, SsoRegistrySync, SsoRegistrySyncMessage } from './sso-registry-sync';

@Injectable()
export class SsoRegistrySyncService implements SsoRegistrySync, OnModuleDestroy {
  private readonly logger = new Logger(SsoRegistrySyncService.name);
  private publisherClient: Redis | null = null;
  private subscriberClient: Redis | null = null;
  private readonly emitter = new EventEmitter();

  /**
   * Announces a LOCAL registration change to every other replica. NEVER throws: the local
   * registration this follows has already succeeded (this process/replica is correct regardless of
   * whether the announcement itself lands) — a lost publish only delays other replicas catching up,
   * which they still do at their own next boot (driven from the stored rows, unchanged) even if every
   * publish this process ever makes were lost.
   */
  async publish(message: SsoRegistrySyncMessage): Promise<void> {
    try {
      if (!this.publisherClient) this.publisherClient = createLibRedisClient();
      await this.publisherClient.publish(SSO_REGISTRY_SYNC_CHANNEL, JSON.stringify(message));
    } catch (error) {
      this.logger.warn(
        `Could not publish an SSO registry sync for company ${message.companyId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Registers `handler` for every remote change from now on, opening the ONE dedicated subscribe-mode
   * connection this process needs on the FIRST call (subsequent calls just add another in-process
   * listener — there is only ever one real caller today, `SsoRegistrarService.onModuleInit`, but nothing
   * here assumes that). A subscribe-mode ioredis connection can run no other command for its lifetime
   * (see `document-events-bridge.ts`'s own header) — this is why it is never the SAME client `publish`
   * above uses.
   */
  async onMessage(handler: (message: SsoRegistrySyncMessage) => void): Promise<void> {
    this.emitter.on('message', handler);
    if (this.subscriberClient) return; // a connection already exists from an earlier call.

    this.subscriberClient = createLibRedisClient();
    this.subscriberClient.on('message', (channel: string, raw: string) => {
      if (channel !== SSO_REGISTRY_SYNC_CHANNEL) return;
      try {
        this.emitter.emit('message', JSON.parse(raw) as SsoRegistrySyncMessage);
      } catch (error) {
        // Cannot happen from this class's own `publish` (always a well-typed JSON.stringify) — but a
        // malformed payload must never crash the process that receives it, the same "never throws on
        // the read side" discipline `document-events-bridge.ts` holds for its own pmessage handler.
        this.logger.warn(
          `Malformed SSO registry sync message: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    await this.subscriberClient.subscribe(SSO_REGISTRY_SYNC_CHANNEL);
  }

  /** Closed at shutdown — never left dangling, the same discipline every other Redis-backed provider
   *  in this codebase holds (`document-events-publisher.ts`/`document-events-bridge.ts`). A no-op
   *  when neither connection was ever opened (the common case for a spec). */
  async onModuleDestroy(): Promise<void> {
    if (this.subscriberClient) await this.subscriberClient.quit();
    if (this.publisherClient) await this.publisherClient.quit();
  }
}
