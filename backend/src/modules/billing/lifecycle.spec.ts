import {
  BLOCKED_DAYS,
  PAID_ZIP_GRACE_DAYS,
  TRIAL_DAYS,
  addDays,
  computeLifecycleTransition,
  computeTrialWindow,
  CompanySubscriptionLifecycleFacts,
} from './lifecycle';

const T0 = new Date('2026-09-15T00:00:00.000Z');

function facts(overrides: Partial<CompanySubscriptionLifecycleFacts>): CompanySubscriptionLifecycleFacts {
  return {
    status: 'TRIAL',
    trialEndsAt: addDays(T0, TRIAL_DAYS),
    blockedAt: null,
    zipSentAt: null,
    deletionDueAt: null,
    polarSubscriptionId: null,
    ...overrides,
  };
}

describe('computeTrialWindow', () => {
  it('is exactly 7 days from the given start', () => {
    const { trialStartedAt, trialEndsAt } = computeTrialWindow(T0);
    expect(trialStartedAt).toEqual(T0);
    expect(trialEndsAt).toEqual(addDays(T0, TRIAL_DAYS));
  });
});

describe('computeLifecycleTransition — trial', () => {
  const trialEndsAt = addDays(T0, TRIAL_DAYS);

  it('does nothing one millisecond before trialEndsAt', () => {
    const sub = facts({ status: 'TRIAL', trialEndsAt });
    expect(computeLifecycleTransition(sub, new Date(trialEndsAt.getTime() - 1))).toEqual({ type: 'none' });
  });

  it('enters blocked exactly at trialEndsAt', () => {
    const sub = facts({ status: 'TRIAL', trialEndsAt });
    expect(computeLifecycleTransition(sub, trialEndsAt)).toEqual({
      type: 'enter_blocked',
      blockedAt: trialEndsAt,
    });
  });

  it('enters blocked well after trialEndsAt too (a sweep tick that was missed)', () => {
    const sub = facts({ status: 'TRIAL', trialEndsAt });
    const later = addDays(trialEndsAt, 30);
    expect(computeLifecycleTransition(sub, later)).toEqual({ type: 'enter_blocked', blockedAt: later });
  });
});

describe('computeLifecycleTransition — active / deleted are never advanced by the sweep', () => {
  it('active does nothing regardless of the clock', () => {
    const sub = facts({ status: 'ACTIVE' });
    expect(computeLifecycleTransition(sub, addDays(T0, 10_000))).toEqual({ type: 'none' });
  });

  it('deleted does nothing (terminal, the row should not even exist any more)', () => {
    const sub = facts({ status: 'DELETED' });
    expect(computeLifecycleTransition(sub, addDays(T0, 10_000))).toEqual({ type: 'none' });
  });
});

describe('computeLifecycleTransition — past_due folds straight into blocked, no window of its own', () => {
  it('enters blocked immediately, whatever the clock', () => {
    const sub = facts({ status: 'PAST_DUE' });
    expect(computeLifecycleTransition(sub, T0)).toEqual({ type: 'enter_blocked', blockedAt: T0 });
  });
});

describe('computeLifecycleTransition — blocked, never-paid cycle (polarSubscriptionId null)', () => {
  const blockedAt = T0;
  const zipDueAt = addDays(blockedAt, BLOCKED_DAYS);

  it('does nothing one millisecond before the 14-day mark', () => {
    const sub = facts({ status: 'BLOCKED', blockedAt, polarSubscriptionId: null });
    expect(computeLifecycleTransition(sub, new Date(zipDueAt.getTime() - 1))).toEqual({ type: 'none' });
  });

  it('sends the zip exactly at the 14-day mark, with an IMMEDIATE deletionDueAt (no grace)', () => {
    const sub = facts({ status: 'BLOCKED', blockedAt, polarSubscriptionId: null });
    expect(computeLifecycleTransition(sub, zipDueAt)).toEqual({
      type: 'send_zip_and_enter_zipped',
      zipSentAt: zipDueAt,
      deletionDueAt: zipDueAt,
    });
  });

  it('defensively does nothing if blockedAt is somehow null on a blocked row', () => {
    const sub = facts({ status: 'BLOCKED', blockedAt: null, polarSubscriptionId: null });
    expect(computeLifecycleTransition(sub, addDays(T0, 999))).toEqual({ type: 'none' });
  });
});

describe('computeLifecycleTransition — blocked, paid-then-stopped cycle (polarSubscriptionId set)', () => {
  const blockedAt = T0;
  const zipDueAt = addDays(blockedAt, BLOCKED_DAYS);

  it('sends the zip at the 14-day mark, with a 180-day deletionDueAt', () => {
    const sub = facts({ status: 'BLOCKED', blockedAt, polarSubscriptionId: 'polar_sub_123' });
    expect(computeLifecycleTransition(sub, zipDueAt)).toEqual({
      type: 'send_zip_and_enter_zipped',
      zipSentAt: zipDueAt,
      deletionDueAt: addDays(zipDueAt, PAID_ZIP_GRACE_DAYS),
    });
  });
});

describe('computeLifecycleTransition — zipped, never-paid cycle (deletionDueAt == zipSentAt)', () => {
  it('does not delete before deletionDueAt (defensive — should not normally be reachable)', () => {
    const zipSentAt = T0;
    const sub = facts({ status: 'ZIPPED', zipSentAt, deletionDueAt: zipSentAt, polarSubscriptionId: null });
    expect(computeLifecycleTransition(sub, new Date(zipSentAt.getTime() - 1))).toEqual({ type: 'none' });
  });

  it('deletes on the very next tick (deletionDueAt == zipSentAt)', () => {
    const zipSentAt = T0;
    const sub = facts({ status: 'ZIPPED', zipSentAt, deletionDueAt: zipSentAt, polarSubscriptionId: null });
    expect(computeLifecycleTransition(sub, zipSentAt)).toEqual({ type: 'delete_company' });
  });
});

describe('computeLifecycleTransition — zipped, paid-then-stopped cycle (180-day grace)', () => {
  const zipSentAt = T0;
  const deletionDueAt = addDays(zipSentAt, PAID_ZIP_GRACE_DAYS);

  it('does nothing one millisecond before the 180-day mark', () => {
    const sub = facts({ status: 'ZIPPED', zipSentAt, deletionDueAt, polarSubscriptionId: 'polar_sub_123' });
    expect(computeLifecycleTransition(sub, new Date(deletionDueAt.getTime() - 1))).toEqual({ type: 'none' });
  });

  it('deletes exactly at the 180-day mark', () => {
    const sub = facts({ status: 'ZIPPED', zipSentAt, deletionDueAt, polarSubscriptionId: 'polar_sub_123' });
    expect(computeLifecycleTransition(sub, deletionDueAt)).toEqual({ type: 'delete_company' });
  });

  it('does nothing if deletionDueAt is somehow null on a zipped row', () => {
    const sub = facts({ status: 'ZIPPED', zipSentAt, deletionDueAt: null, polarSubscriptionId: 'x' });
    expect(computeLifecycleTransition(sub, addDays(T0, 999))).toEqual({ type: 'none' });
  });
});
