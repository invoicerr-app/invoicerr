/**
 * Ownership transfer gets its OWN BullMQ queue, the same shape (and for the same reason)
 * `billing/queue/billing-queue.constants.ts` gives itself rather than joining the documents module's
 * `Q_DOCUMENT_ACTION`: this feature is registered directly in `app.module.ts` (never conditionally, no
 * flag gates it — see `transfer.module.ts`'s own header), but the documents queue is owned by
 * `DocumentsCoreModule`/`document-queue-worker.module.ts`, files this feature has no business reaching
 * into just to register one more repeatable on top of an unrelated module's own queue.
 */
export const Q_COMPANY_TRANSFER = 'company-transfer';

/** `@nestjs/bullmq`'s own `BullModule.forRoot()` always returns a GLOBAL dynamic module regardless of
 *  who calls it — see `billing-queue.constants.ts`'s own header for the full reasoning this mirrors:
 *  naming this module's own config key is what keeps `TransferModule` genuinely self-contained rather
 *  than silently sharing (or racing) whichever OTHER `forRoot()` call the DI container resolves last. */
export const TRANSFER_BULL_CONFIG_KEY = 'company-transfer-bull';

export const TRANSFER_EXPIRY_SWEEP_JOB_NAME = 'company-transfer-expiry-sweep';
export const TRANSFER_EXPIRY_SWEEP_JOB_ID = 'company-transfer-expiry-sweep-singleton';

/** Default 1 hour — the transfer window itself is 7 DAYS (`transfer.service.ts#TRANSFER_WINDOW_MS`),
 *  so hourly resolution is already far tighter than the product needs; matches
 *  `billing-queue.constants.ts#readBillingLifecycleSweepIntervalMs`'s own default for the identical
 *  "day-granularity boundary, hourly sweep" reasoning. */
export function readTransferExpirySweepIntervalMs(): number {
  return parseInt(process.env.TRANSFER_EXPIRY_SWEEP_INTERVAL_MS ?? '3600000', 10);
}
