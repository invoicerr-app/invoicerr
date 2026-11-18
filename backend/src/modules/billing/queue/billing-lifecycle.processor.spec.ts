import { vi } from 'vitest';
import type { Job } from 'bullmq';

import type { BillingLifecycleSweepRunner } from '../billing-lifecycle-sweep-runner';
import type { SubscriptionInvoiceIssuer } from '../subscription-invoice-issuer';
import { BillingLifecycleProcessor } from './billing-lifecycle.processor';
import { BILLING_LIFECYCLE_SWEEP_JOB_NAME } from './billing-queue.constants';

const SWEEP = { advanced: 0 } as never;

function build(issuePending: () => Promise<unknown>) {
  const runner = { runSweep: vi.fn().mockResolvedValue(SWEEP) };
  const issuer = { issuePending: vi.fn(issuePending) };
  const processor = new BillingLifecycleProcessor(
    runner as unknown as BillingLifecycleSweepRunner,
    issuer as unknown as SubscriptionInvoiceIssuer,
  );
  return { processor, runner, issuer };
}

const sweepJob = { name: BILLING_LIFECYCLE_SWEEP_JOB_NAME } as Job;

describe('the billing sweep job', () => {
  it('runs the lifecycle sweep, then issues the pending subscription invoices', async () => {
    const { processor, runner, issuer } = build(async () => ({}));
    await expect(processor.process(sweepJob)).resolves.toBe(SWEEP);
    expect(runner.runSweep).toHaveBeenCalledTimes(1);
    expect(issuer.issuePending).toHaveBeenCalledTimes(1);
  });

  it('still succeeds when issuing fails', async () => {
    const { processor } = build(async () => {
      throw new Error('boom');
    });
    await expect(processor.process(sweepJob)).resolves.toBe(SWEEP);
  });

  it('refuses an unknown job', async () => {
    const { processor, issuer } = build(async () => ({}));
    await expect(processor.process({ name: 'other' } as Job)).rejects.toThrow(/Unknown job "other"/);
    expect(issuer.issuePending).not.toHaveBeenCalled();
  });
});
