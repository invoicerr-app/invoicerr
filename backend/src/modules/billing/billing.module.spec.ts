/**
 * `billing-core.module.ts`'s own BullMQ wiring — see `BILLING_BULL_CONFIG_KEY`'s own comment
 * (`queue/billing-queue.constants.ts`) for the bug this guards against: `BullModule.forRoot()` ALWAYS
 * returns a `global: true` dynamic module, so an UNNAMED `forRoot()` call here would register a
 * provider for the exact same default shared-config token `DocumentQueueModule` (`@Global()`,
 * `documents/queue/document-queue.module.ts`) also provides — silently deciding, by whichever module
 * loads last, which Redis options BOTH queues actually get.
 *
 * This split moved this wiring OUT of `billing.module.ts` and into `billing-core.module.ts` (the
 * providers-only half a worker process can also import — see that file's own header); this spec
 * follows it there, unchanged in what it actually checks.
 *
 * `billing-core.module.ts` itself is deliberately never IMPORTED here: it transitively pulls in the
 * whole documents module graph (`DocumentsCoreModule` -> `ClientsModule` -> `WebhooksModule` ->
 * `WebhooksController`), which drags in `@thallesp/nestjs-better-auth`'s own ESM-only transitive
 * dependency that ts-jest cannot parse — the exact fact `polar-webhook.controller.ts`'s own header
 * already documents for that same package. Reading the module's SOURCE keeps this a fast, isolated
 * check of the two call sites that matter, without booting (or even loading) that whole graph.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as path from 'node:path';

import { BillingLifecycleProcessor } from './queue/billing-lifecycle.processor';
import { BILLING_BULL_CONFIG_KEY, Q_BILLING_LIFECYCLE } from './queue/billing-queue.constants';

/** `@nestjs/bullmq`'s own `@Processor()` decorator stores its options under this literal metadata key
 *  (`PROCESSOR_METADATA`, `bull.constants.ts` — not re-exported from that package's public
 *  entrypoint) — the same "read a third party's own key by its literal string, documented" discipline
 *  `polar-webhook.controller.ts`'s `isUniqueConstraintViolation`/`IS_PUBLIC_KEY` comments already hold. */
const BULLMQ_PROCESSOR_METADATA_KEY = 'bullmq:processor_metadata';

const billingCoreModuleSource = fs.readFileSync(path.join(__dirname, 'billing-core.module.ts'), 'utf-8');

describe('BillingCoreModule Bull wiring', () => {
  it('registers its BullMQ shared config under its own BILLING_BULL_CONFIG_KEY, never bare/unnamed', () => {
    expect(billingCoreModuleSource).toMatch(/BullModule\.forRoot\(\s*BILLING_BULL_CONFIG_KEY\s*,/);
  });

  it("registers its queue under that SAME configKey, not BullMQ's unnamed default", () => {
    expect(billingCoreModuleSource).toMatch(
      /BullModule\.registerQueue\(\{\s*configKey:\s*BILLING_BULL_CONFIG_KEY/,
    );
  });

  it("wires its worker (BillingLifecycleProcessor) to that SAME configKey, so it can never resolve its connection from an unrelated module's default config", () => {
    const processorMetadata = Reflect.getMetadata(BULLMQ_PROCESSOR_METADATA_KEY, BillingLifecycleProcessor);

    expect(processorMetadata).toEqual({ name: Q_BILLING_LIFECYCLE, configKey: BILLING_BULL_CONFIG_KEY });
  });
});

/**
 * The actual defect and its fix, at the module-graph level: BEFORE this split,
 * `BillingLifecycleProcessor` (the `@Processor()`) and the repeatable-registering
 * `onApplicationBootstrap` both lived inside `billing.module.ts`, a module `worker.module.ts` never
 * imported — so with `WORKER_INLINE=false` (the target 15-worker topology), NOTHING would ever
 * consume `Q_BILLING_LIFECYCLE` at all. Reading source text (the same reason the suite above does, not
 * booting the real module graph) proves the fix without needing a real Redis/Postgres: the processor
 * now lives in `billing-queue-worker.module.ts`, and `worker.module.ts` imports it.
 */
describe('BillingLifecycleProcessor is reachable from the worker process', () => {
  const billingQueueWorkerModuleSource = fs.readFileSync(
    path.join(__dirname, 'billing-queue-worker.module.ts'),
    'utf-8',
  );
  const workerModuleSource = fs.readFileSync(path.join(__dirname, '..', '..', 'worker.module.ts'), 'utf-8');
  const billingModuleSource = fs.readFileSync(path.join(__dirname, 'billing.module.ts'), 'utf-8');

  it('BillingQueueWorkerModule provides BillingLifecycleProcessor', () => {
    expect(billingQueueWorkerModuleSource).toMatch(/providers:\s*\[BillingLifecycleProcessor\]/);
  });

  it('worker.module.ts (ROLE=worker) imports BillingQueueWorkerModule — the processor is no longer stuck behind an API-only module', () => {
    expect(workerModuleSource).toMatch(/BillingQueueWorkerModule/);
  });

  it('the HTTP-only BillingModule no longer carries the processor or the repeatable registration itself', () => {
    // Checks actual CODE, not prose: this module's own header explains the split in words that
    // legitimately name `BillingLifecycleProcessor`/`OnApplicationBootstrap`, so a blanket string
    // search over the whole file would trip on its own comments — this extracts the real
    // `@Module({ providers: [...] })` array's own text (comments inside it included, code identifiers
    // only) and checks THAT, plus the class declaration.
    const providersArray = billingModuleSource.match(/providers:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    expect(providersArray).toMatch(/BillingCustomerProvisioningBootService/);
    expect(providersArray).not.toMatch(/Processor/);
    expect(billingModuleSource).not.toMatch(/implements OnApplicationBootstrap/);
  });
});
