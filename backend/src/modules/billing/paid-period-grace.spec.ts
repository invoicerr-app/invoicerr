import {
  CompanySubscriptionPeriodFacts,
  firstOfMonthFollowing,
  isWithinPaidPeriodGrace,
  paidPeriodBindingDate,
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
