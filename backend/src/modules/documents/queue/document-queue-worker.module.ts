import { Module, OnApplicationBootstrap } from '@nestjs/common';

import { CurrencyRateSweepRunner } from '../../company/currency-rates/currency-rate-sweep-runner';
import { DocumentsCoreModule } from '../documents-core.module';
import { DocumentQueueDispatcher } from './document-queue.dispatcher';
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
 *
 * `onApplicationBootstrap` registers the ONE recurrence sweep repeatable (root TODO item 5,
 * schedule-sweep.ts) — same discipline the pre-refonte compliance queue's own worker module
 * documented for its `registerRepeatables()` call (`avant-refonte-documents`,
 * compliance-worker.module.ts): idempotent (BullMQ dedups a repeat definition by its own key across
 * the whole cluster), so calling this on EVERY process that imports this module — the API in-line, or
 * every scaled worker replica — is safe, never a double-registration.
 *
 * `CurrencyRateSweepRunner` (TODO_FEATURES.md rank 9) is provided directly HERE, not imported via
 * `CompanyModule`, even though the class itself lives under `modules/company/currency-rates/` —
 * unlike `ConformitySweepRunner` (which needs `AuthorityStatusPollerRegistry` and
 * `DocumentQueueDispatcher` injected, hence its home in `DocumentsCoreModule`'s own `providers`,
 * re-exported for this module to pick up), this runner has NO Nest-injected dependencies at all: it
 * talks to `prisma` (a plain singleton default import, never a DI token — see the repo's own
 * CLAUDE.md) and to `ecb-rates-client.ts` (a plain async function). A leaf provider with zero
 * constructor dependencies can be listed in ANY module's own `providers` without that module also
 * needing to import wherever the class happens to live — the identical reasoning that lets
 * `DocumentActionProcessor` itself (this module's other provider) sit here despite depending on
 * classes from three different directories.
 */
@Module({
  imports: [DocumentsCoreModule],
  providers: [DocumentActionProcessor, CurrencyRateSweepRunner],
})
export class DocumentsQueueWorkerModule implements OnApplicationBootstrap {
  constructor(private readonly queueDispatcher: DocumentQueueDispatcher) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queueDispatcher.registerScheduleSweepRepeatable();
    // Root TODO item 10's own named remainder (post-deposit conformity tracking) — same idempotent-
    // registration guarantee, same reasoning: see `registerConformitySweepRepeatable`'s own header.
    await this.queueDispatcher.registerConformitySweepRepeatable();
    // TODO_FEATURES.md rank 9 — same idempotent-registration guarantee, same reasoning: see
    // `registerCurrencyRateSweepRepeatable`'s own header (document-queue.dispatcher.ts).
    await this.queueDispatcher.registerCurrencyRateSweepRepeatable();
  }
}
