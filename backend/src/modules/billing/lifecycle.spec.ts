import {
  BLOCKED_DAYS,
  MIN_RETRIEVAL_DAYS,
  PAID_ZIP_GRACE_DAYS,
  TRIAL_DAYS,
  addDays,
  computeDueBillingWarnings,
  computeLifecycleTransition,
  computeRecoveredStatus,
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
  it('is exactly 14 days from the given start', () => {
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

  it('sends the zip exactly at the 14-day mark, with a 30-day deletionDueAt (the statutory floor)', () => {
    const sub = facts({ status: 'BLOCKED', blockedAt, polarSubscriptionId: null });
    expect(computeLifecycleTransition(sub, zipDueAt)).toEqual({
      type: 'send_zip_and_enter_zipped',
      zipSentAt: zipDueAt,
      deletionDueAt: addDays(zipDueAt, MIN_RETRIEVAL_DAYS),
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

describe('computeLifecycleTransition — zipped, never-paid cycle (30-day statutory floor)', () => {
  const zipSentAt = T0;
  const deletionDueAt = addDays(zipSentAt, MIN_RETRIEVAL_DAYS);

  it('does nothing one millisecond before the 30-day mark', () => {
    const sub = facts({ status: 'ZIPPED', zipSentAt, deletionDueAt, polarSubscriptionId: null });
    expect(computeLifecycleTransition(sub, new Date(deletionDueAt.getTime() - 1))).toEqual({ type: 'none' });
  });

  it('deletes exactly at the 30-day mark', () => {
    const sub = facts({ status: 'ZIPPED', zipSentAt, deletionDueAt, polarSubscriptionId: null });
    expect(computeLifecycleTransition(sub, deletionDueAt)).toEqual({ type: 'delete_company' });
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

describe('computeDueBillingWarnings — OWNER warning-email milestones', () => {
  it('is empty well before the blocked_d7 mark', () => {
    const blockedAt = T0;
    expect(
      computeDueBillingWarnings(
        { status: 'BLOCKED', blockedAt, zipSentAt: null, deletionDueAt: null },
        addDays(T0, 3),
      ),
    ).toEqual([]);
  });

  it('blocked_d7 becomes due exactly 7 days into BLOCKED, blocked_d1 not yet', () => {
    const blockedAt = T0;
    expect(
      computeDueBillingWarnings(
        { status: 'BLOCKED', blockedAt, zipSentAt: null, deletionDueAt: null },
        addDays(blockedAt, 7),
      ),
    ).toEqual(['blocked_d7']);
  });

  it('both blocked_d7 and blocked_d1 are due once 13 days have elapsed (a missed tick catches up on both)', () => {
    const blockedAt = T0;
    expect(
      computeDueBillingWarnings(
        { status: 'BLOCKED', blockedAt, zipSentAt: null, deletionDueAt: null },
        addDays(blockedAt, BLOCKED_DAYS - 1),
      ),
    ).toEqual(['blocked_d7', 'blocked_d1']);
  });

  it('is empty for a status other than BLOCKED/ZIPPED, whatever the clock', () => {
    expect(
      computeDueBillingWarnings(
        { status: 'ACTIVE', blockedAt: T0, zipSentAt: T0, deletionDueAt: T0 },
        addDays(T0, 9999),
      ),
    ).toEqual([]);
  });

  it('zipped_d7 becomes due exactly 7 days before deletionDueAt (paid-then-stopped, 180-day grace), zipped_d1 not yet', () => {
    const zipSentAt = T0;
    const deletionDueAt = addDays(zipSentAt, PAID_ZIP_GRACE_DAYS);
    expect(
      computeDueBillingWarnings(
        { status: 'ZIPPED', blockedAt: null, zipSentAt, deletionDueAt },
        addDays(deletionDueAt, -7),
      ),
    ).toEqual(['zipped_d7']);
  });

  it('both zipped_d7 and zipped_d1 are due exactly at deletionDueAt', () => {
    const zipSentAt = T0;
    const deletionDueAt = addDays(zipSentAt, PAID_ZIP_GRACE_DAYS);
    expect(
      computeDueBillingWarnings(
        { status: 'ZIPPED', blockedAt: null, zipSentAt, deletionDueAt },
        deletionDueAt,
      ),
    ).toEqual(['zipped_d7', 'zipped_d1']);
  });

  it('a never-paid company also gets zipped_d7/zipped_d1, counted off its own 30-day floor', () => {
    const zipSentAt = T0;
    const deletionDueAt = addDays(zipSentAt, MIN_RETRIEVAL_DAYS);
    expect(
      computeDueBillingWarnings(
        { status: 'ZIPPED', blockedAt: null, zipSentAt, deletionDueAt },
        deletionDueAt,
      ),
    ).toEqual(['zipped_d7', 'zipped_d1']);
  });

  it('a row somehow written with a sub-7-day window (should not happen) never owes a ZIPPED warning', () => {
    const zipSentAt = T0;
    const deletionDueAt = addDays(zipSentAt, 3); // defensive case — see hasRealZippedGraceWindow's own comment
    expect(
      computeDueBillingWarnings(
        { status: 'ZIPPED', blockedAt: null, zipSentAt, deletionDueAt },
        deletionDueAt,
      ),
    ).toEqual([]);
  });
});

describe('computeRecoveredStatus', () => {
  const trialEndsAt = addDays(T0, TRIAL_DAYS);

  it('reverts to TRIAL while the original trial window has not ended yet', () => {
    const anchor = addDays(T0, 5);
    const now = addDays(T0, 10); // still before trialEndsAt (day 14)
    expect(computeRecoveredStatus(trialEndsAt, anchor, now)).toEqual({ status: 'TRIAL', blockedAt: null });
  });

  it('is PAST_DUE, blockedAt null, right at the trialEndsAt boundary with a fresh anchor', () => {
    expect(computeRecoveredStatus(trialEndsAt, trialEndsAt, trialEndsAt)).toEqual({
      status: 'PAST_DUE',
      blockedAt: null,
    });
  });

  it('stays PAST_DUE for fewer than BLOCKED_DAYS since the anchor', () => {
    const anchor = addDays(trialEndsAt, 10);
    const now = addDays(anchor, BLOCKED_DAYS - 1);
    expect(computeRecoveredStatus(trialEndsAt, anchor, now)).toEqual({ status: 'PAST_DUE', blockedAt: null });
  });

  it('becomes BLOCKED, backdated to the anchor (never now), once BLOCKED_DAYS elapsed since it', () => {
    const anchor = addDays(trialEndsAt, 10);
    const now = addDays(anchor, BLOCKED_DAYS);
    expect(computeRecoveredStatus(trialEndsAt, anchor, now)).toEqual({
      status: 'BLOCKED',
      blockedAt: anchor,
    });
  });

  it('stays BLOCKED with the SAME backdated blockedAt long after the anchor, never resetting to now', () => {
    const anchor = addDays(trialEndsAt, 10);
    const now = addDays(anchor, 90); // long past BLOCKED_DAYS
    expect(computeRecoveredStatus(trialEndsAt, anchor, now)).toEqual({
      status: 'BLOCKED',
      blockedAt: anchor,
    });
  });

  it('falls back to PAST_DUE when the anchor itself is `now` (no better anchor known)', () => {
    const now = addDays(trialEndsAt, 30);
    expect(computeRecoveredStatus(trialEndsAt, now, now)).toEqual({ status: 'PAST_DUE', blockedAt: null });
  });
});
