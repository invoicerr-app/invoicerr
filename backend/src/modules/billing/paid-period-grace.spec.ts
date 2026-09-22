import {
  CompanySubscriptionPeriodFacts,
  firstOfMonthFollowing,
  isPaidPeriodStillRunning,
  isWithinPaidPeriodGrace,
  paidPeriodBindingDate,
  paidThroughEndOfDay,
} from './paid-period-grace';

/** A change published today, 2026-09-20 — the same day this Section 20.2 exception was drafted, so the
 *  calendar floor it produces (2026-10-01) is easy to eyeball against each case's own renewal date. */
const PUBLISHED_AT = new Date('2026-09-20T00:00:00.000Z');
const CALENDAR_FLOOR = new Date('2026-10-01T00:00:00.000Z');

function facts(overrides: Partial<CompanySubscriptionPeriodFacts>): CompanySubscriptionPeriodFacts {
  return { status: 'ACTIVE', currentPeriodEnd: null, ...overrides };
}

describe('firstOfMonthFollowing', () => {
  it('is midnight UTC on the 1st of the NEXT month', () => {
    expect(firstOfMonthFollowing(PUBLISHED_AT)).toEqual(CALENDAR_FLOOR);
  });

  it('rolls over the year boundary for a December publication', () => {
    expect(firstOfMonthFollowing(new Date('2026-12-19T00:00:00.000Z'))).toEqual(
      new Date('2027-01-01T00:00:00.000Z'),
    );
  });
});

describe('paidPeriodBindingDate — the later of the calendar floor and the renewal date', () => {
  it(
    'the RENEWAL DATE wins when the Company is only two days into its own period at publication — its ' +
      'monthly renewal (~28 days out) falls after the calendar floor (~11 days out)',
    () => {
      // Period started two days before publication, monthly cadence: renews 2026-10-18.
      const currentPeriodEnd = new Date('2026-10-18T00:00:00.000Z');
      const sub = facts({ currentPeriodEnd });

      expect(paidPeriodBindingDate(sub, PUBLISHED_AT)).toEqual(currentPeriodEnd);
      expect(currentPeriodEnd.getTime()).toBeGreaterThan(CALENDAR_FLOOR.getTime());
    },
  );

  it(
    'the CALENDAR FLOOR wins when the Company renews only two days after publication — sooner than the ' +
      'first day of the following month',
    () => {
      const currentPeriodEnd = new Date('2026-09-22T00:00:00.000Z');
      const sub = facts({ currentPeriodEnd });

      expect(paidPeriodBindingDate(sub, PUBLISHED_AT)).toEqual(CALENDAR_FLOOR);
      expect(currentPeriodEnd.getTime()).toBeLessThan(CALENDAR_FLOOR.getTime());
    },
  );

  it('the calendar floor also wins on an exact tie (renewal falls exactly on the floor)', () => {
    const sub = facts({ currentPeriodEnd: CALENDAR_FLOOR });
    expect(paidPeriodBindingDate(sub, PUBLISHED_AT)).toEqual(CALENDAR_FLOOR);
  });

  it('the renewal date always wins for an annual period — the calendar floor never binds an annual plan', () => {
    const currentPeriodEnd = new Date('2027-06-15T00:00:00.000Z');
    const sub = facts({ currentPeriodEnd });
    expect(paidPeriodBindingDate(sub, PUBLISHED_AT)).toEqual(currentPeriodEnd);
  });

  it.each([
    ['TRIAL', 'never paid for a period at all'],
    ['PAST_DUE', 'the last renewal already failed — nothing currently paid-for to protect'],
    ['BLOCKED', 'already in the Section 13.1 non-payment suspension'],
    ['ZIPPED', 'already past the suspension, archive already sent'],
  ] as const)('is null for status %s (%s) even with a future currentPeriodEnd on file', (status) => {
    const sub = facts({ status, currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z') });
    expect(paidPeriodBindingDate(sub, PUBLISHED_AT)).toBeNull();
  });

  it('is null for an ACTIVE row with no currentPeriodEnd on file yet (no webhook has carried one)', () => {
    const sub = facts({ status: 'ACTIVE', currentPeriodEnd: null });
    expect(paidPeriodBindingDate(sub, PUBLISHED_AT)).toBeNull();
  });
});

describe('isWithinPaidPeriodGrace', () => {
  const sub = facts({ currentPeriodEnd: new Date('2026-10-18T00:00:00.000Z') });

  it('true the instant before the binding date', () => {
    const now = new Date(sub.currentPeriodEnd!.getTime() - 1);
    expect(isWithinPaidPeriodGrace(sub, PUBLISHED_AT, now)).toBe(true);
  });

  it('false exactly at, and after, the binding date — the ordinary pending-acceptance gate resumes', () => {
    expect(isWithinPaidPeriodGrace(sub, PUBLISHED_AT, sub.currentPeriodEnd!)).toBe(false);
    expect(isWithinPaidPeriodGrace(sub, PUBLISHED_AT, new Date(sub.currentPeriodEnd!.getTime() + 1))).toBe(
      false,
    );
  });

  it('false for a company already blocked for non-payment, regardless of how "now" compares to its stale currentPeriodEnd', () => {
    const blocked = facts({
      status: 'BLOCKED',
      currentPeriodEnd: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(isWithinPaidPeriodGrace(blocked, PUBLISHED_AT, PUBLISHED_AT)).toBe(false);
  });

  it('false for a company with no subscription period in progress (still in trial)', () => {
    const trial = facts({ status: 'TRIAL', currentPeriodEnd: null });
    expect(isWithinPaidPeriodGrace(trial, PUBLISHED_AT, PUBLISHED_AT)).toBe(false);
  });
});

describe('paidThroughEndOfDay', () => {
  it('is midnight UTC opening the day AFTER the one the period ends in', () => {
    expect(paidThroughEndOfDay(new Date('2026-10-18T09:14:02.000Z'))).toEqual(
      new Date('2026-10-19T00:00:00.000Z'),
    );
  });

  it.each([
    ['2026-10-18T00:30:00.000Z', '2026-10-19T00:00:00.000Z'],
    ['2026-10-18T23:30:00.000Z', '2026-10-19T00:00:00.000Z'],
  ])("reads %s in UTC, never in the deployment's own timezone — landing on %s", (periodEnd, expected) => {
    // The pair matters: a renewal at 00:30 UTC falls on the PREVIOUS calendar day west of
    // Greenwich, one at 23:30 UTC on the NEXT one east of it. An implementation reading local
    // components instead of UTC gets exactly one of these two wrong on any machine whose offset is
    // not zero, whichever side of Greenwich it sits on.
    expect(paidThroughEndOfDay(new Date(periodEnd))).toEqual(new Date(expected));
  });

  it('carries the overflow into the next month, and the next year', () => {
    expect(paidThroughEndOfDay(new Date('2026-11-30T12:00:00.000Z'))).toEqual(
      new Date('2026-12-01T00:00:00.000Z'),
    );
    expect(paidThroughEndOfDay(new Date('2026-12-31T23:59:59.999Z'))).toEqual(
      new Date('2027-01-01T00:00:00.000Z'),
    );
  });

  it('is null when nothing is on file — no period, nothing paid for, nothing to protect', () => {
    expect(paidThroughEndOfDay(null)).toBeNull();
    expect(paidThroughEndOfDay(undefined)).toBeNull();
  });
});

describe('isPaidPeriodStillRunning', () => {
  const periodEnd = new Date('2026-10-31T06:00:00.000Z');

  it('true for every instant of the last day paid for, its final millisecond included', () => {
    expect(isPaidPeriodStillRunning(periodEnd, new Date('2026-10-20T00:00:00.000Z'))).toBe(true);
    expect(isPaidPeriodStillRunning(periodEnd, periodEnd)).toBe(true);
    expect(isPaidPeriodStillRunning(periodEnd, new Date('2026-10-31T23:59:59.999Z'))).toBe(true);
  });

  it('false from the first instant of the day after', () => {
    expect(isPaidPeriodStillRunning(periodEnd, new Date('2026-11-01T00:00:00.000Z'))).toBe(false);
    expect(isPaidPeriodStillRunning(periodEnd, new Date('2026-11-14T00:00:00.000Z'))).toBe(false);
  });

  it('false with no period on file at all', () => {
    expect(isPaidPeriodStillRunning(null, new Date('2026-10-20T00:00:00.000Z'))).toBe(false);
  });
});
