/**
 * `BillingModule`'s own BullMQ wiring — see `BILLING_BULL_CONFIG_KEY`'s own comment
 * (`queue/billing-queue.constants.ts`) for the bug this guards against: `BullModule.forRoot()` ALWAYS
 * returns a `global: true` dynamic module, so an UNNAMED `forRoot()` call here would register a
 * provider for the exact same default shared-config token `DocumentQueueModule` (`@Global()`,
 * `documents/queue/document-queue.module.ts`) also provides — silently deciding, by whichever module
 * loads last, which Redis options BOTH queues actually get.
 *
 * `billing.module.ts` itself is deliberately never IMPORTED here: it transitively pulls in the whole
 * documents module graph (`DocumentsCoreModule` -> `ClientsModule` -> `WebhooksModule` ->
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

const billingModuleSource = fs.readFileSync(path.join(__dirname, 'billing.module.ts'), 'utf-8');

describe('BillingModule Bull wiring', () => {
  it('registers its BullMQ shared config under its own BILLING_BULL_CONFIG_KEY, never bare/unnamed', () => {
    expect(billingModuleSource).toMatch(/BullModule\.forRoot\(\s*BILLING_BULL_CONFIG_KEY\s*,/);
  });

  it("registers its queue under that SAME configKey, not BullMQ's unnamed default", () => {
    expect(billingModuleSource).toMatch(
      /BullModule\.registerQueue\(\{\s*configKey:\s*BILLING_BULL_CONFIG_KEY/,
    );
  });

  it("wires its worker (BillingLifecycleProcessor) to that SAME configKey, so it can never resolve its connection from an unrelated module's default config", () => {
    const processorMetadata = Reflect.getMetadata(BULLMQ_PROCESSOR_METADATA_KEY, BillingLifecycleProcessor);

    expect(processorMetadata).toEqual({ name: Q_BILLING_LIFECYCLE, configKey: BILLING_BULL_CONFIG_KEY });
  });
});
