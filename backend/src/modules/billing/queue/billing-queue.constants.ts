/**
 * A dedicated queue, registered only from within the flag-gated `BillingModule`, rather than reusing
 * the always-present `Q_DOCUMENT_ACTION`, so billing stays inert down to BullMQ when disabled.
 */
export const Q_BILLING_LIFECYCLE = 'billing-lifecycle';

/** `BullModule.forRoot()` is always global, so an unnamed config here would share
 *  `BULL_CONFIG_DEFAULT_TOKEN` with the documents queue and whichever resolves last would win for both. */
export const BILLING_BULL_CONFIG_KEY = 'billing';

export const BILLING_LIFECYCLE_SWEEP_JOB_NAME = 'billing-lifecycle-sweep';
export const BILLING_LIFECYCLE_SWEEP_JOB_ID = 'billing-lifecycle-sweep-singleton';

/** Default 1 hour so a trial expiring mid-day is blocked within the hour rather than up to a day late. */
export function readBillingLifecycleSweepIntervalMs(): number {
  return parseInt(process.env.BILLING_LIFECYCLE_SWEEP_INTERVAL_MS ?? '3600000', 10);
}
