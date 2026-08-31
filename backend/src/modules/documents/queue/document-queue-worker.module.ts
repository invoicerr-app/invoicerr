import { Module } from '@nestjs/common';

import { DocumentsCoreModule } from '../documents-core.module';
import { DocumentActionProcessor } from './processors/document-action.processor';

/**
 * The CONSUMING half of the document-action queue — the gate target for `WORKER_INLINE` (default
 * `true`): `WorkerModule` (the dedicated worker process, worker.ts) ALWAYS imports this module;
 * `AppModule` (the API process) imports it only when `WORKER_INLINE !== 'false'` — see app.module.ts's
 * own comment. Nest only instantiates `@Processor()` classes reachable from an imported module, so
 * gating THIS import is enough to gate consumption entirely: a scaled ("giga") deployment
 * (docker-compose.scale.yml) sets the API's `WORKER_INLINE=false` and only the dedicated worker
 * process(es) import this module, so a job is never consumed twice.
 *
 * Imports `DocumentsCoreModule` (never the full `DocumentsModule`, which also carries the HTTP
 * controller this worker process has no use for) so `DocumentActionProcessor` gets the SAME
 * DI-wired `DocumentsService` — and therefore the SAME `ActionRegistry`/`TransportRegistry`/etc. — the
 * API process uses, never a second, parallel construction of them. This is the exact split the
 * pre-refonte compliance engine's own `ComplianceWorkerModule` documented for the same reason (git tag
 * `avant-refonte-documents`, compliance/nest/queue/compliance-worker.module.ts).
 */
@Module({
  imports: [DocumentsCoreModule],
  providers: [DocumentActionProcessor],
})
export class DocumentsQueueWorkerModule {}
