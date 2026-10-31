/**
 * The BullMQ wiring of the transfer queue, and the proof that the processor is reachable from
 * `worker.module.ts`: a dedicated worker must be able to consume the queue, not only an API replica.
 *
 * Reads module source text rather than booting the real graph, keeping it fast.
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
