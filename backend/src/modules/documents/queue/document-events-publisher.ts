/**
 * The WRITE side of the worker→API bridge TODO_PRODUIT.md T1 / PLAN-V2 R8 calls for. Every status
 * transition (`actions/async-send.ts`, `queue/mark-send-failed.ts`) and every newly-journaled batch of
 * authority events (`conformity/conformity-sweep-runner.ts`, `reporting/reporting-runner.ts`, the SdI
 * push receiver `transports/sdi/sdi-notifiche.service.ts`) is written in whichever PROCESS happens to
 * run that code — the API (a user's own synchronous "send" click writes "sending" directly, see
 * `actions/async-send.ts`'s own header on its two phases) or a BullMQ worker ("sending"→"sent"/
 * "send_failed", always) — while the SSE stream a browser holds open lives ONLY in the API process
 * (`documents.controller.ts`'s own `events` route, fed by `document-events-bridge.ts`).
 *
 * Redis pub/sub is the bridge, not an in-process EventEmitter: with `WORKER_INLINE=false`
 * (`docker-compose.scale.yml`), the worker that persists "sent" and the API process holding the SSE
 * connection are two entirely separate Node processes sharing nothing but Postgres and Redis — an
 * EventEmitter would silently work in dev (`WORKER_INLINE` defaults to `true`, same process) and
 * silently do NOTHING the moment a real scaled deployment split them apart. Redis is already a
 * REQUIRED dependency for this whole module (`redis-required.guard.ts` refuses to boot without one),
 * so this adds no new infrastructure; `ioredis` is already a direct dependency (see package.json, it
 * backs `bullmq` itself) so this adds no new npm dependency either.
 *
 * PUBLISH is an ordinary Redis command — unlike SUBSCRIBE/PSUBSCRIBE (see `document-events-bridge.ts`'s
 * own header for why THAT side needs a dedicated connection), a connection that publishes is free to
 * run any other command too, so this class needs no dedicated connection of its own. The client is
 * created lazily (never at construction) so a test that only ever depends on the narrow
 * `DocumentEventPublisher` interface (`document-events.ts`) never pays for a real connection.
 *
 * NEVER throws: every call site here runs strictly AFTER the fact it announces is already committed
 * to Postgres — the same "après le fait acquis, jamais avant" discipline `archive/archive-on-send.ts`
 * and `reporting/report-on-send.ts` already document for themselves. A Redis hiccup losing one SSE
 * nudge must never look like the WRITE itself failed, and must never crash a BullMQ worker event
 * handler (`document-action.processor.ts`'s own header already explains why an escaped exception
 * there kills the entire process). A missed nudge is not silent data loss: the frontend's own ~60s
 * polling fallback (`frontend/src/hooks/queries/use-document-types.ts`) still catches it, just slower.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { createIoredisClient } from './redis.config';
import { DocumentEventMessage, DocumentEventPublisher, documentEventsChannel } from './document-events';

@Injectable()
export class DocumentEventsPublisher implements DocumentEventPublisher, OnModuleDestroy {
  private readonly logger = new Logger(DocumentEventsPublisher.name);
  private client: Redis | null = null;

  private getClient(): Redis {
    if (!this.client) {
      this.client = createIoredisClient();
    }
    return this.client;
  }

  async publish(companyId: string, message: DocumentEventMessage): Promise<void> {
    try {
      await this.getClient().publish(documentEventsChannel(companyId), JSON.stringify(message));
    } catch (error) {
      this.logger.warn(
        `Could not publish a "${message.kind}" document event for company ${companyId} (document ` +
          `${message.documentId}) — the ~60s polling fallback still covers it: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Closed at shutdown, same discipline every other Redis-backed provider in this directory holds
   *  (`document-queue.module.ts`'s own BullMQ connection is managed the same way by `@nestjs/bullmq`
   *  itself) — never left dangling for the process to exit around. */
  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }
}
