/**
 * `transfer-core.module.ts`'s own BullMQ wiring, and — the actual fix under test — that
 * `TransferExpiryProcessor` is reachable from `worker.module.ts` (`ROLE=worker`), which it was NOT
 * before this split: `TransferModule` used to carry the processor and the repeatable registration
 * directly, and `worker.module.ts` never imported `TransferModule` — so a dedicated worker process had
 * no way to consume `Q_COMPANY_TRANSFER` at all, and the expiry sweep always ran on an API replica.
 *
 * Reads module source text rather than booting the real graph — `transfer.module.ts`/
 * `transfer-core.module.ts` do not themselves pull in the `@thallesp/nestjs-better-auth` ESM chain the
 * way `billing-core.module.ts` (via `DocumentsCoreModule`) does, but this file follows the same
 * lightweight, no-Nest-bootstrap style as `billing.module.spec.ts` for consistency and speed.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as path from 'node:path';

import { TransferExpiryProcessor } from './queue/transfer-expiry.processor';
import { Q_COMPANY_TRANSFER, TRANSFER_BULL_CONFIG_KEY } from './queue/transfer-queue.constants';

const BULLMQ_PROCESSOR_METADATA_KEY = 'bullmq:processor_metadata';

const transferCoreModuleSource = fs.readFileSync(path.join(__dirname, 'transfer-core.module.ts'), 'utf-8');

describe('TransferCoreModule Bull wiring', () => {
  it('registers its BullMQ shared config under its own TRANSFER_BULL_CONFIG_KEY, never bare/unnamed', () => {
    expect(transferCoreModuleSource).toMatch(/BullModule\.forRoot\(\s*TRANSFER_BULL_CONFIG_KEY\s*,/);
  });

  it("registers its queue under that SAME configKey, not BullMQ's unnamed default", () => {
    expect(transferCoreModuleSource).toMatch(
      /BullModule\.registerQueue\(\{\s*configKey:\s*TRANSFER_BULL_CONFIG_KEY/,
    );
  });

  it("wires its worker (TransferExpiryProcessor) to that SAME configKey, so it can never resolve its connection from an unrelated module's default config", () => {
    const processorMetadata = Reflect.getMetadata(BULLMQ_PROCESSOR_METADATA_KEY, TransferExpiryProcessor);

    expect(processorMetadata).toEqual({ name: Q_COMPANY_TRANSFER, configKey: TRANSFER_BULL_CONFIG_KEY });
  });
});

describe('TransferExpiryProcessor is reachable from the worker process', () => {
  const transferQueueWorkerModuleSource = fs.readFileSync(
    path.join(__dirname, 'transfer-queue-worker.module.ts'),
    'utf-8',
  );
  const workerModuleSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'worker.module.ts'),
    'utf-8',
  );
  const transferModuleSource = fs.readFileSync(path.join(__dirname, 'transfer.module.ts'), 'utf-8');

  it('TransferQueueWorkerModule provides TransferExpiryProcessor', () => {
    expect(transferQueueWorkerModuleSource).toMatch(/providers:\s*\[TransferExpiryProcessor\]/);
  });

  it('worker.module.ts (ROLE=worker) imports TransferQueueWorkerModule — unconditionally, since transfer has no enable/disable flag', () => {
    expect(workerModuleSource).toMatch(/TransferQueueWorkerModule/);
  });

  it('the HTTP-only TransferModule no longer carries the processor or the repeatable registration itself', () => {
    // Checks actual CODE, not prose: this module's own header explains the split in words that
    // legitimately name `TransferExpiryProcessor`/`OnApplicationBootstrap`, so a blanket string search
    // over the whole file would trip on its own comments — this checks the real `@Module({...})`
    // providers array and the class declaration instead.
    expect(transferModuleSource).toMatch(/providers:\s*\[MailService,\s*TransferService\]/);
    expect(transferModuleSource).not.toMatch(/implements OnApplicationBootstrap/);
  });
});
