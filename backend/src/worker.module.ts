import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DocumentsQueueWorkerModule } from './modules/documents/queue/document-queue-worker.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Root module for the dedicated document-action queue worker process (bootstrapped by worker.ts,
 * `ROLE=worker`) — the documents-module equivalent of the pre-refonte compliance engine's own
 * `WorkerModule` (git tag `avant-refonte-documents`, backend/src/worker.module.ts), rebuilt for
 * TODO.md item 22.
 *
 * Deliberately minimal: no controllers, no auth guards, none of the other feature modules (clients,
 * companies, webhooks, ...) — only what the queue processor needs. `DocumentsQueueWorkerModule`
 * itself imports `DocumentsCoreModule` (documents-core.module.ts), which is where `ClientsModule`/
 * `ArticlesModule` actually get pulled in (the entity-reference and transport registries need
 * `ClientsService`/`ArticlesService`) — nothing extra to wire here.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, DocumentsQueueWorkerModule],
})
export class WorkerModule {}
