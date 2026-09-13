import { Module } from '@nestjs/common';

import { MailService } from '@/mail/mail.service';

import { DocumentsCoreModule } from '../documents/documents-core.module';
import { PortalAccessController } from './portal-access.controller';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { PortalTokensService } from './portal-tokens.service';

/**
 * The client portal (TODO_FEATURES.md rank 3) — ONE module for both halves (staff-facing invite CRUD,
 * client-facing read/respond), unlike the documents module's own three-way Core/HTTP/Public split:
 * this feature has no worker-process concern (nothing here is queued or replayed) and no re-export
 * complication (`PortalTokensService`/`PortalService` are both providers OF this exact module, not
 * imported from elsewhere), so the extra split would only add ceremony.
 *
 * Imports `DocumentsCoreModule` directly (never `DocumentsModule`, which also carries the HTTP
 * controller and SSE bridge a client portal has no use for — the same reasoning
 * `PublicDocumentsModule`/`DocumentsQueueWorkerModule` already document for the identical choice) for
 * `DocumentsService`/`SignaturesService`, both already exported by it. `MailService` is a plain
 * provider here (not exported by `DocumentsCoreModule`), the same "each module that needs it
 * constructs its own" convention that module's own `providers` array already follows for the exact
 * same class.
 */
@Module({
  imports: [DocumentsCoreModule],
  controllers: [PortalAccessController, PortalController],
  providers: [PortalTokensService, PortalService, MailService],
})
export class ClientPortalModule {}
