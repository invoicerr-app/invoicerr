import { Module } from '@nestjs/common';

import { DocumentsCoreModule } from '../documents-core.module';
import { PublicDocumentsController } from './public-documents.controller';

/**
 * A THIRD, separate documents module — alongside `DocumentsCoreModule` (providers) and
 * `DocumentsModule` (the authenticated controller) — for exactly one controller carrying the one
 * `@Public()` route this whole feature area has (see PublicDocumentsController's own header on why
 * that route lives in its own file). Imports `DocumentsCoreModule` directly (never through
 * `DocumentsModule`) for the same reason `DocumentsModule` itself does: `DocumentsCoreModule`
 * already exports `DocumentsService`/`ShareLinksService`, no re-export layer is needed on top.
 */
@Module({
  imports: [DocumentsCoreModule],
  controllers: [PublicDocumentsController],
})
export class PublicDocumentsModule {}
