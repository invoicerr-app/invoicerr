import { Module } from '@nestjs/common';

import { DocumentsCoreModule } from '../documents-core.module';
import { PublicDocumentsController } from './public-documents.controller';
import { PublicSignaturesController } from './public-signatures.controller';

/**
 * A THIRD, separate documents module — alongside `DocumentsCoreModule` (providers) and
 * `DocumentsModule` (the authenticated controller) — for the `@Public()` routes this whole feature
 * area has (see `PublicDocumentsController`'s own header on why they live outside `DocumentsModule`
 * entirely). Imports `DocumentsCoreModule` directly (never through `DocumentsModule`) for the same
 * reason `DocumentsModule` itself does: `DocumentsCoreModule` already exports
 * `DocumentsService`/`ShareLinksService`/`SignaturesService`, no re-export layer is needed on top.
 *
 * `PublicSignaturesController` joined `PublicDocumentsController` here
 * rather than getting its own THIRD module: both controllers already share the identical shape (one
 * `DocumentsCoreModule`-provided service, zero controller-local state, every route `@Public()`) this
 * module exists to host — unlike `SdiNotificheModule`, which earns its OWN module for a genuinely
 * different reason (a third-party SOAP push endpoint, not a document-facing public flow at all — see
 * that module's own header).
 */
@Module({
  imports: [DocumentsCoreModule],
  controllers: [PublicDocumentsController, PublicSignaturesController],
})
export class PublicDocumentsModule {}
