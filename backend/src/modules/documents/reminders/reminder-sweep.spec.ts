import { RenderLanguage } from '../rendering/language/supported-languages';
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

  // Multilingual client-facing mail (step 4 of the multilingual-mail plan) — `language` is the
  // caller's own resolved value (reminder-sweep-runner.ts#resolveClientContact +
  // resolveRecipientLanguage), never decided here; this file's own job is only to prove the CATALOG
  // key is actually picked and interpolated correctly once a language is handed to it.
  describe('language — the recipient-resolved third argument', () => {
    it('builds a genuinely French reminder for a French client, distinct from the English default', () => {
      const en = buildReminderEmail(7, ctx, 'en');
      const fr = buildReminderEmail(7, ctx, 'fr');

      expect(fr.subject).toContain('Rappel de paiement');
      expect(fr.text).toContain('Bonjour,');
      expect(fr.text).toContain('INV-2026-0042'); // the invoice number is never translated
      expect(fr.text).toContain('1234.56 EUR');
      expect(fr.text).toContain('2026-06-01');
      expect(fr.text).toContain('Acme Corp');
      expect(fr).not.toEqual(en);
    });

    it('translates all three tiers into Italian, German, Polish and Portuguese too', () => {
      // One pattern per REMINDER_TIERS entry (7/14/30, in that order) — genuinely exercises tier14/
      // tier30's own catalog keys for each language, not just tier7 (a language check that only ever
      // calls `buildReminderEmail(7, ...)` would leave the other two tiers' translations unverified
      // despite a test name claiming "all three tiers").
      const expectations: Record<string, RegExp[]> = {
        it: [/Sollecito di pagamento/, /Secondo sollecito/, /URGENTE.*gravemente scaduta/],
        de: [/Zahlungserinnerung/, /Zweite Mahnung/, /DRINGEND.*erheblich überfällig/],
        pl: [/Przypomnienie o płatności/, /Drugie przypomnienie/, /PILNE.*znacznie przeterminowana/],
        pt: [/Lembrete de pagamento/, /Segundo lembrete/, /URGENTE.*significativamente em atraso/],
      };
      for (const [language, subjectPatterns] of Object.entries(expectations)) {
        REMINDER_TIERS.forEach((tier, index) => {
          const email = buildReminderEmail(tier.daysOverdue, ctx, language as RenderLanguage);
          expect(email.subject).toMatch(subjectPatterns[index]);
          expect(email.text).toContain('INV-2026-0042');
        });
      }
    });

    it('CLDR-pluralizes the day count correctly for a genuinely singular case (1 day overdue)', () => {
      const oneDayOverdue = { ...ctx, daysOverdue: 1 };
      const en = buildReminderEmail(7, oneDayOverdue, 'en');
      const fr = buildReminderEmail(7, oneDayOverdue, 'fr');

      expect(en.text).toContain('1 day overdue');
      expect(en.text).not.toContain('1 days overdue');
      expect(fr.text).toContain('1 jour');
      expect(fr.text).not.toContain('1 jours');
    });

    it('uses the plural form once the count is no longer exactly one', () => {
      const email = buildReminderEmail(7, { ...ctx, daysOverdue: 9 }, 'en');
      expect(email.text).toContain('9 days overdue');
    });

    it('falls back to English when the language is unsupported or unset — never a blocked send', () => {
      const defaulted = buildReminderEmail(7, ctx); // no third argument at all
      const unset = buildReminderEmail(7, ctx, undefined as unknown as RenderLanguage);
      const unsupported = buildReminderEmail(7, ctx, 'xx' as RenderLanguage);
      const en = buildReminderEmail(7, ctx, 'en');

      expect(defaulted).toEqual(en);
      expect(unset).toEqual(en);
      expect(unsupported).toEqual(en);
    });
  });
});
