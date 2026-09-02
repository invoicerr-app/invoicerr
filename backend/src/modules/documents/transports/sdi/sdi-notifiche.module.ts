import { Module } from '@nestjs/common';

import { WebhookDispatcherService } from '@/modules/webhooks/webhook-dispatcher.service';
import { WebhooksModule } from '@/modules/webhooks/webhooks.module';

import { DOCUMENT_WEBHOOK_EMITTER } from '../../queue/document-webhooks';
import { SdiNotificheController } from './sdi-notifiche.controller';
import { SdiNotificheService } from './sdi-notifiche.service';

/**
 * A small module of its own — same reasoning `public/public-documents.module.ts` gives for its own
 * single-controller module: this needs neither `DocumentsCoreModule`'s registries (`TransportRegistry`
 * etc.) nor any Nest-managed Prisma provider (`SdiNotificheService` calls the plain, prisma-importing
 * functions in `conformity/authority-events.persistence.ts` directly — see `CLAUDE.md`'s own "prisma
 * is a singleton default export" rule) — importing the whole documents module graph for one route
 * would be a needless coupling.
 *
 * `WebhooksModule` (TODO_PRODUIT.md T2bis) is the ONE addition: `SdiNotificheService` now dispatches
 * `DOCUMENT_AUTHORITY_EVENT`, whose emitter (`WebhookDispatcherService`) is NOT `@Global()` the way
 * `DocumentEventsPublisher` is — it has to be imported explicitly wherever it is injected.
 * `WebhooksModule` itself only imports `PluginsModule` (no Prisma-managed provider, no documents
 * coupling), so this stays exactly as narrow as the header above already commits to.
 *
 * `{ provide: DOCUMENT_WEBHOOK_EMITTER, useExisting: WebhookDispatcherService }` mirrors
 * `documents-core.module.ts`'s own identical provider — `SdiNotificheService` injects the TOKEN, never
 * the concrete class, so ts-jest never has to follow `webhook-dispatcher.service.ts` →
 * `webhooks.service.ts` → `drivers/discord.driver.ts` → `@teever/ez-hook` just to compile this
 * service's own spec (see the token's own header, `queue/document-webhooks.ts`, for the full story).
 */
@Module({
  imports: [WebhooksModule],
  controllers: [SdiNotificheController],
  providers: [
    SdiNotificheService,
    { provide: DOCUMENT_WEBHOOK_EMITTER, useExisting: WebhookDispatcherService },
  ],
})
export class SdiNotificheModule {}
