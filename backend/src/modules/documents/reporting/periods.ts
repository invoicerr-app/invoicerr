/**
 * When a per-document declaration is due. An obligation's `timing.deadline` is counted from the date
 * of its trigger (the issue, send or payment date of the document it declares), either as a number
 * of days or as a day of a later calendar month. This file turns that rule and a trigger date into
 * one calendar date, and nothing else: it reads no clock, no database and no country, so the same
 * rule always gives the same date for the same trigger.
 *
 * A period-based obligation (`timing.period`) and an obligation with no timing have no per-document
 * due date: the answer is `undefined`, never a guessed date. Dates are plain `YYYY-MM-DD` calendar
 * days, computed in UTC so a server's time zone never moves a deadline by a day.
 */
import { ObligationTiming } from './obligation-v2';

export class InvalidTriggerDateError extends Error {}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value: string): Date {
  const match = DATE_ONLY.exec(value);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (date?.toISOString().slice(0, 10) !== value) {
    throw new InvalidTriggerDateError(`"${value}" is not a calendar date in the YYYY-MM-DD form.`);
  }
  return date;
}

/** The date a per-document declaration triggered on `triggerDate` must be filed by, inclusive. */
export function declarationDueDate(
  timing: ObligationTiming | undefined,
  triggerDate: string,
): string | undefined {
  if (!timing || !('deadline' in timing)) return undefined;
  const trigger = parseDateOnly(triggerDate);
  const deadline = timing.deadline;
  if ('daysAfterTrigger' in deadline) {
    trigger.setUTCDate(trigger.getUTCDate() + deadline.daysAfterTrigger);
    return trigger.toISOString().slice(0, 10);
  }
  // `dayOfMonth` is at most 28 (enforced at load by `obligation-v2.ts`), so the target day exists in
  // every month and Date.UTC never rolls it over into the month after.
  const due = new Date(
    Date.UTC(
      trigger.getUTCFullYear(),
      trigger.getUTCMonth() + deadline.monthsAfterTrigger,
      deadline.dayOfMonth,
    ),
  );
  return due.toISOString().slice(0, 10);
}
