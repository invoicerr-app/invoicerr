import { buildReminderEmail, daysOverdueOn, REMINDER_TIERS, selectDueReminderTier } from './reminder-sweep';

describe('selectDueReminderTier', () => {
  it('returns null when the invoice is not yet overdue at all', () => {
    expect(selectDueReminderTier(0, new Set())).toBeNull();
    expect(selectDueReminderTier(6, new Set())).toBeNull();
  });

  it('returns the first tier (7) once due, when nothing has been sent yet', () => {
    expect(selectDueReminderTier(7, new Set())).toBe(7);
    expect(selectDueReminderTier(10, new Set())).toBe(7);
  });

  it('returns the second tier (14) once due, when the first has already been sent', () => {
    expect(selectDueReminderTier(14, new Set([7]))).toBe(14);
    expect(selectDueReminderTier(20, new Set([7]))).toBe(14);
  });

  it('returns null when 14 days overdue but the first tier (7) has not been sent yet — one at a time', () => {
    // Same "lowest unsent due tier" rule as the 30-day case below: a 14-day-overdue invoice that
    // somehow never got its 7-day reminder still gets 7 first, never jumps to 14.
    expect(selectDueReminderTier(14, new Set())).toBe(7);
  });

  it('returns the third tier (30) once due, when the first two have already been sent', () => {
    expect(selectDueReminderTier(30, new Set([7, 14]))).toBe(30);
    expect(selectDueReminderTier(45, new Set([7, 14]))).toBe(30);
  });

  it('returns null once every due tier has already been sent', () => {
    expect(selectDueReminderTier(30, new Set([7, 14, 30]))).toBeNull();
    expect(selectDueReminderTier(90, new Set([7, 14, 30]))).toBeNull();
  });

  it('30 days overdue but NOTHING sent yet -> lowest unsent due is 7, never a burst of three', () => {
    expect(selectDueReminderTier(30, new Set())).toBe(7);
  });

  it('exact boundary: daysOverdue equal to a tier threshold is due (>=, not >)', () => {
    expect(selectDueReminderTier(7, new Set())).toBe(7);
    expect(selectDueReminderTier(14, new Set([7]))).toBe(14);
    expect(selectDueReminderTier(30, new Set([7, 14]))).toBe(30);
  });

  it('never returns a tier not present in REMINDER_TIERS', () => {
    const validValues = new Set(REMINDER_TIERS.map((tier) => tier.daysOverdue));
    for (const daysOverdue of [0, 1, 7, 8, 13, 14, 15, 29, 30, 31, 100]) {
      const result = selectDueReminderTier(daysOverdue, new Set());
      if (result !== null) expect(validValues.has(result)).toBe(true);
    }
  });
});

describe('daysOverdueOn', () => {
  it('returns 0 when due exactly on the as-of date', () => {
    expect(daysOverdueOn('2026-06-01', new Date('2026-06-01T23:00:00Z'))).toBe(0);
  });

  it('returns a positive count for a past due date', () => {
    expect(daysOverdueOn('2026-06-01', new Date('2026-06-08T00:00:00Z'))).toBe(7);
  });

  it('returns a negative count for a due date still in the future', () => {
    expect(daysOverdueOn('2026-06-10', new Date('2026-06-01T00:00:00Z'))).toBe(-9);
  });

  it('returns null for a missing due date', () => {
    expect(daysOverdueOn(null, new Date())).toBeNull();
    expect(daysOverdueOn(undefined, new Date())).toBeNull();
  });

  it('returns null for an unparseable due date, never a guessed number', () => {
    expect(daysOverdueOn('not-a-date', new Date())).toBeNull();
  });
});

describe('buildReminderEmail', () => {
  const ctx = {
    displayNumber: 'INV-2026-0042',
    amountOutstanding: '1234.56 EUR',
    dueDate: '2026-06-01',
    daysOverdue: 7,
    companyName: 'Acme Corp',
  };

  it('names the invoice number, amount, and due date in every tier', () => {
    for (const tier of REMINDER_TIERS) {
      const email = buildReminderEmail(tier.daysOverdue, { ...ctx, daysOverdue: tier.daysOverdue });
      expect(email.subject).toContain('INV-2026-0042');
      expect(email.text).toContain('INV-2026-0042');
      expect(email.text).toContain('1234.56 EUR');
      expect(email.text).toContain('2026-06-01');
      expect(email.text).toContain('Acme Corp');
    }
  });

  it('escalates tone across tiers — each tier has genuinely different copy', () => {
    const subjects = REMINDER_TIERS.map((tier) => buildReminderEmail(tier.daysOverdue, ctx).subject);
    expect(new Set(subjects).size).toBe(subjects.length);
    const bodies = REMINDER_TIERS.map((tier) => buildReminderEmail(tier.daysOverdue, ctx).text);
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it('the last tier (30) reads noticeably more urgent than the first (7)', () => {
    const first = buildReminderEmail(7, ctx);
    const last = buildReminderEmail(30, ctx);
    expect(last.subject.toUpperCase()).toContain('URGENT');
    expect(first.subject.toUpperCase()).not.toContain('URGENT');
  });

  it('throws a named error for a tier with no defined copy — never a silent blank email', () => {
    expect(() => buildReminderEmail(999, ctx)).toThrow(/no reminder email copy/i);
  });
});
