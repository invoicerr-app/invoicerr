/**
 * TODO_FEATURES.md rank 11 ("suivi du temps & facturation de projets") — turning billed time entries
 * into invoice LINES. Split the same way `documents/stock/apply-stock-on-issuance.ts` is (a pure
 * computation, unit-testable with no DB, plus a thin Prisma writer — see time-entries.service.ts's
 * `billToInvoice` for that half): this file only ever decides WHAT the lines should say, never
 * touches Prisma.
 */
import { fromMinor } from '@/utils/financial';

/** One TimeEntry, narrowed to what this module needs — never the raw Prisma row (see
 *  time-entries.service.ts's own mapping): both rate columns are read defensively because either can
 *  legitimately be null (see TimeEntry.hourlyRateMinor's own schema comment). */
export interface TimeEntryForBilling {
  id: string;
  projectName: string;
  durationMinutes: number;
  description: string | null;
  /** This entry's own rate override, or null to fall back to the project's. */
  hourlyRateMinor: number | null;
  /** The project's own default rate, or null if none was ever set. */
  projectHourlyRateMinor: number | null;
}

/** A generated line — deliberately the SAME four fields a hand-typed HOUR line's own
 *  `description`/`quantity`/`unit`/`unitPrice` carry (invoice.descriptor.ts), and nothing more:
 *  `vatRate`/`articleId`/`discountPercent` are never invented here — see this function's own header
 *  for why leaving them unset is the honest choice, not an oversight. */
export interface GeneratedInvoiceLine {
  description: string;
  quantity: number;
  unit: 'hour';
  unitPrice: number;
}

export interface TimeEntryBillingError {
  entryId: string;
  message: string;
}

export interface GenerateInvoiceLinesResult {
  lines: GeneratedInvoiceLine[];
  errors: TimeEntryBillingError[];
}

/** Hours, rounded to a hundredth — a duration logged in MINUTES (TimeEntry.durationMinutes' own
 *  schema comment) rarely divides evenly by 60 (50 minutes is 0.8333... h); a hundredth of an hour
 *  (36 seconds) is finer than anyone bills at, so this is the last rounding step, never propagated
 *  further into money (that stays `compute-totals.ts`'s own job, once this line reaches an invoice). */
function minutesToHours(durationMinutes: number): number {
  return Math.round((durationMinutes / 60) * 100) / 100;
}

/** `"<project> — <entry description>"`, or just the project's name when the entry carries none — a
 *  time entry has no designation field of its own the way a catalog Article has a `name`, so the
 *  project stands in for it, the same role an Article's `name` plays for `prefillFrom`
 *  (invoice.descriptor.ts's own comment on why `description` maps from `name`, not a separate field). */
function describeLine(entry: TimeEntryForBilling): string {
  const trimmed = entry.description?.trim();
  return trimmed ? `${entry.projectName} — ${trimmed}` : entry.projectName;
}

/**
 * Pure: turns billable time entries into invoice lines shaped EXACTLY like a hand-typed HOUR line —
 * see `GeneratedInvoiceLine`'s own header for why `vatRate` is never among them. This mirrors
 * `actions/convert-to-invoice.ts`'s own `dueDate` (left unset because "the invoice descriptor
 * requires it, but this call bypasses that descriptor's validation entirely... an unset value here
 * means exactly what it should: a draft the user still has to finish") — a time entry carries no VAT
 * rate to carry over, so inventing one would be exactly the kind of unsourced tax fact this
 * codebase's country-policy/tax-engine catalogs refuse to guess (CLAUDE.md's own "a country is
 * data"). The user picks a real rate once, in the opened draft, the same as any hand-typed line.
 *
 * ONE LINE PER ENTRY, never aggregated — a merged line would have to average mismatched
 * descriptions/rates across entries, a real design decision this feature does not make (see
 * TODO_FEATURES.md's own rank-11 entry: "logger des heures... les convertir en lignes HOUR", never
 * "en UNE ligne"). An entry with NO resolvable rate (neither its own override nor its project's
 * default) is reported as an error instead of silently priced at 0 — a free line is not what "no
 * rate set yet" means.
 */
export function computeGeneratedInvoiceLines(
  entries: TimeEntryForBilling[],
  currency: string,
): GenerateInvoiceLinesResult {
  const lines: GeneratedInvoiceLine[] = [];
  const errors: TimeEntryBillingError[] = [];

  for (const entry of entries) {
    const rateMinor = entry.hourlyRateMinor ?? entry.projectHourlyRateMinor;
    if (rateMinor === null || rateMinor === undefined) {
      errors.push({
        entryId: entry.id,
        message: 'has no hourly rate — set one on the entry or on its project before billing it.',
      });
      continue;
    }

    lines.push({
      description: describeLine(entry),
      quantity: minutesToHours(entry.durationMinutes),
      unit: 'hour',
      unitPrice: fromMinor(rateMinor, currency),
    });
  }

  return { lines, errors };
}
