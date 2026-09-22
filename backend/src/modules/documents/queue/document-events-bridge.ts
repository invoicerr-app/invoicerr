/**
 * The READ side of the worker→API bridge — see `document-events-publisher.ts`'s own header for the
 * full "why Redis pub/sub" reasoning this file is the other half of. Lives in `DocumentsModule`
 * (controller-only, API-process-only — see that module's own header) rather than the `@Global()`
 * `DocumentQueueModule`: a BullMQ worker process (`DocumentsQueueWorkerModule`) never serves HTTP/SSE
 * at all, so instantiating this there would open a Redis subscribe connection nothing would ever read
 * from.
 *
 * ONE dedicated subscribe-mode connection for the WHOLE process, opened once at boot (`onModuleInit`)
 * and closed once at shutdown (`onModuleDestroy`) — never one connection per SSE client, and never one
 * per company. This is not a mere convenience: once an ioredis connection issues `SUBSCRIBE`/
 * `PSUBSCRIBE`, that connection enters Redis's own subscriber mode and can run NO other command ever
 * again for its lifetime (see ioredis's own docs, "Pub/Sub" section) — so this connection is dedicated
 * to exactly that and nothing else, by construction, never sharing a client with anything that also
 * needs to run ordinary commands. `PSUBSCRIBE document-events:*` receives every tenant's own channel
 * on this ONE connection; multi-tenant isolation is enforced entirely AFTER that, in-process, by
 * `subscribeCompany` dispatching strictly on the message's own companyId (see that method's own
 * header) — never by opening a separate connection/subscription per tenant.
 */
import { EventEmitter } from 'node:events';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  DOCUMENT_EVENTS_CHANNEL_PATTERN,
  DocumentEventMessage,
  companyIdFromChannel,
} from './document-events';
import { createIoredisClient } from './redis.config';

@Injectable()
export class DocumentEventsBridge implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentEventsBridge.name);
  private subscriber: Redis | null = null;
  // Node's own EventEmitter, NOT a second Redis structure — fans out from the ONE Redis connection
  // above to however many SSE connections this API process itself currently holds open, entirely
  // in-memory. The event name IS the companyId, which is what makes cross-tenant leakage structurally
  // impossible: `emitter.emit(companyId, ...)` only ever invokes listeners registered under that
  // EXACT string (see `subscribeCompany` below) — there is no "listen to everything" API in use here,
  // so a bug elsewhere cannot accidentally widen what one SSE connection receives.
  private readonly emitter = new EventEmitter();

  async onModuleInit(): Promise<void> {
    this.subscriber = createIoredisClient();
    // Attached BEFORE `psubscribe` resolves — no message can arrive before this handler exists to
    // receive it.
    this.subscriber.on('pmessage', (_pattern: string, channel: string, raw: string) => {
      const companyId = companyIdFromChannel(channel);
      try {
        const message = JSON.parse(raw) as DocumentEventMessage;
        this.emitter.emit(companyId, message);
      } catch (error) {
        // Cannot happen from this codebase's own publisher (it always JSON.stringifies a well-typed
        // DocumentEventMessage) — but a bridge that let a malformed payload crash the whole API
        // process would be far worse than one dropped nudge. Same "never throws" posture
        // `document-events-publisher.ts` documents for the write side, mirrored here for the read
        // side.
        this.logger.warn(
          `Malformed document event on channel "${channel}": ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    // The default max-listener warning (10) is tuned for a process that opens a HANDFUL of listeners
    // for its own lifetime — this emitter gains one new listener per currently-open SSE connection,
    // routinely more than 10 at real usage levels. 0 disables the warning outright rather than picking
    // an arbitrary ceiling that would just need raising again later.
    this.emitter.setMaxListeners(0);
    await this.subscriber.psubscribe(DOCUMENT_EVENTS_CHANNEL_PATTERN);
  }

  /**
   * Registers `listener` for every event published for `companyId` from now on — the SSE controller's
   * own per-connection hook (`documents.controller.ts`'s `events` route), called once per open
   * browser tab. Returns a function that removes ONLY this listener; the underlying Redis connection
   * — shared by every OTHER tenant's own SSE connection, and every other connection THIS same tenant
   * might have open in another tab — is entirely unaffected, and stays open until `onModuleDestroy`.
   */
  subscribeCompany(companyId: string, listener: (message: DocumentEventMessage) => void): () => void {
    this.emitter.on(companyId, listener);
    return () => this.emitter.off(companyId, listener);
  }

  /** Closed at shutdown — never left dangling for the process to exit around, the same discipline
   *  `document-events-publisher.ts`'s own `onModuleDestroy` holds for the write side. */
  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
    }
  }
}
