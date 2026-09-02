import { Module } from '@nestjs/common';

import { DocumentsController } from './documents.controller';
import { DocumentsCoreModule } from './documents-core.module';
import { DocumentEventsBridge } from './queue/document-events-bridge';

/**
 * The CONTROLLER half of the documents module — every actual provider (registries, DocumentsService,
 * the queue dispatcher) lives in `DocumentsCoreModule` instead (see that file's own header for why:
 * so the dedicated queue worker process can import the providers alone, with no HTTP surface at all).
 *
 * `DocumentEventsBridge` (T1/R8 — the SSE-side half of the status bridge, `queue/document-events-
 * bridge.ts`) is registered HERE rather than in the `@Global()` `DocumentQueueModule`, deliberately:
 * it is the ONLY thing in this whole mechanism that a BullMQ worker process must NEVER instantiate
 * (it would open a Redis subscribe connection nothing reads from — see that class's own header). This
 * module is imported ONLY by `AppModule` (the API process); `DocumentsQueueWorkerModule` imports
 * `DocumentsCoreModule` directly, never this one — so the bridge simply never exists in a worker.
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
  providers: [DocumentEventsBridge],
  exports: [DocumentsCoreModule],
})
export class DocumentsModule {}
