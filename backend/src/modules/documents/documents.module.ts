import { Module } from '@nestjs/common';

import { DocumentsController } from './documents.controller';
import { DocumentsCoreModule } from './documents-core.module';

/**
 * The CONTROLLER half of the documents module — every actual provider (registries, DocumentsService,
 * the queue dispatcher) lives in `DocumentsCoreModule` instead (see that file's own header for why:
 * so the dedicated queue worker process can import the providers alone, with no HTTP surface at all).
 *
 * Re-exports `DocumentsCoreModule` wholesale rather than re-listing its individual tokens: Nest
 * cannot re-export a single token PROVIDED BY an imported module without re-declaring it, so the
 * whole module is the unit re-exported — the same split the pre-refonte compliance engine's own
 * `ComplianceModule` documented for `ComplianceCoreModule` (git tag `avant-refonte-documents`).
 * Nothing outside this file currently needs that (AppModule only ever wants the controller), but it
 * costs nothing to keep the door open the same way the old architecture did.
 */
@Module({
  imports: [DocumentsCoreModule],
  controllers: [DocumentsController],
  exports: [DocumentsCoreModule],
})
export class DocumentsModule {}
