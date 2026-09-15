/**
 * Billing gets its OWN queue rather than joining `Q_DOCUMENT_ACTION` — the documents module's own
 * queue, always present in the graph regardless of the billing flag (`DocumentQueueModule` is
 * `@Global()`, imported unconditionally via `DocumentsModule`). Reusing it would mean the billing
 * lifecycle sweep's repeatable registration living inside a module this feature must never touch when
 * disabled; a dedicated queue, registered ONLY from within `BillingModule` (itself only ever imported
 * behind the flag — see that module's own header), is what keeps the "invisible and inert" guarantee
 * true all the way down to BullMQ, not just at the HTTP/DI surface.
 */
export const Q_BILLING_LIFECYCLE = 'billing-lifecycle';

export const BILLING_LIFECYCLE_SWEEP_JOB_NAME = 'billing-lifecycle-sweep';
export const BILLING_LIFECYCLE_SWEEP_JOB_ID = 'billing-lifecycle-sweep-singleton';

/** Default 1 hour — every `lifecycle.ts` boundary is day-granularity (7/14/180 days), so hourly is
 *  already far more resolution than the product needs; it exists mainly so a trial that expires at,
 *  say, 14:03 is blocked within the hour rather than up to a day late, unlike the (deliberately
 *  slower) 24h default the currency-rate/conformity sweeps use for feeds that only publish once a
 *  day. Same env-var/parseInt/numeric-fallback shape as every sibling sweep interval reader. */
export function readBillingLifecycleSweepIntervalMs(): number {
  return parseInt(process.env.BILLING_LIFECYCLE_SWEEP_INTERVAL_MS ?? '3600000', 10);
}
