import { describe, expect, it } from 'vitest';

import { defaultReportingObligationCatalogV2 } from './obligation-catalog';
import { declarationDueDate, InvalidTriggerDateError } from './periods';

describe('declarationDueDate', () => {
  it('counts days after the trigger, across a month and a year end', () => {
    expect(declarationDueDate({ deadline: { daysAfterTrigger: 5 } }, '2026-12-29')).toBe('2027-01-03');
    expect(declarationDueDate({ deadline: { daysAfterTrigger: 0 } }, '2026-03-10')).toBe('2026-03-10');
  });

  it('lands on a day of a later month, whatever day of the month the trigger is', () => {
    const fifthOfNextMonth = { deadline: { monthsAfterTrigger: 1, dayOfMonth: 5 } };
    expect(declarationDueDate(fifthOfNextMonth, '2026-01-01')).toBe('2026-02-05');
    expect(declarationDueDate(fifthOfNextMonth, '2026-01-31')).toBe('2026-02-05');
    expect(declarationDueDate(fifthOfNextMonth, '2026-12-15')).toBe('2027-01-05');
  });

  it('a day of the same month can already be the trigger day or earlier', () => {
    expect(declarationDueDate({ deadline: { monthsAfterTrigger: 0, dayOfMonth: 15 } }, '2026-04-02')).toBe(
      '2026-04-15',
    );
  });

  it('has no per-document due date for a period obligation or no timing', () => {
    expect(declarationDueDate({ period: 'month' }, '2026-04-02')).toBeUndefined();
    expect(declarationDueDate(undefined, '2026-04-02')).toBeUndefined();
  });

  it('refuses a trigger date that is not a real calendar date', () => {
    expect(() => declarationDueDate({ deadline: { daysAfterTrigger: 1 } }, '2026-02-30')).toThrow(
      InvalidTriggerDateError,
    );
    expect(() => declarationDueDate({ deadline: { daysAfterTrigger: 1 } }, '02/03/2026')).toThrow(
      InvalidTriggerDateError,
    );
  });

  it('gives the shipped Portuguese obligations their legal deadline: the 5th of the following month', () => {
    for (const id of ['pt-at:invoice', 'pt-at:credit-note']) {
      const obligation = defaultReportingObligationCatalogV2
        .obligationsFor('PT')
        .find((candidate) => candidate.id === id);
      expect(obligation, id).toBeDefined();
      expect(declarationDueDate(obligation?.timing, '2026-11-19'), id).toBe('2026-12-05');
    }
  });
});
