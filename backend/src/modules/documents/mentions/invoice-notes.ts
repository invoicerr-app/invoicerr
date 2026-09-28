/**
 * The mentions a country requires on every invoice (BG-1), resolved for a date.
 *
 * CARRIED OVER almost verbatim from `compliance/profiles/invoice-notes.ts` (git tag
 * `avant-refonte-documents`) -- the logic has not changed; only the input type becomes a
 * `CountryMentionsFile` from this module (`schema.ts`) rather than a `CountryComplianceProfile` from
 * the old engine, since this module knows only about mentions, not a whole country profile.
 *
 * Data in, text out. The engine names no jurisdiction: it renders whatever the country's file lists,
 * and a country that requires nothing lists nothing. France is the only file carrying any today --
 * C. com. art. L441-9 I al. 5 puts three mentions in one sentence, and omitting them is an
 * administrative offence, not a formatting nicety.
 *
 * Values are FROZEN AT ISSUE DATE, never recomputed. France's supplementary late-payment rate moves
 * every six months (ECB refi + 10 points, read at 1 January and 1 July -- L441-10 II); re-resolving
 * an old invoice in a later semester would restate a document that was correct when issued.
 *
 * FIXED (issue #519, 2026-09-28): a `{placeholder}` whose value table has RUN OUT (the last dated
 * window ended and nobody has entered the next one) used to hard-refuse the send with
 * `UnresolvedInvoiceNotePlaceholderError`, on every instance, self-hosted included, the moment the
 * clock crossed the table's own last `validTo` -- for `lateFeeRate` that is every six months, forever,
 * unless a maintainer happens to add the next entry first. `resolveNoteText` below now falls back to
 * a rule's own `fallbackText` (`schema.ts`) in exactly that one shape of gap, logging a WARN so the
 * table getting stale is an operator-visible signal rather than a silent countdown to a broken send.
 */
import { Logger } from '@nestjs/common';

import { CountryMentionsFile, InvoiceNoteRule, TemporalValue } from './schema';
import { pickByDate } from './temporal';

/** No Nest DI reaches this module (see this file's own header -- "Data in, text out"), so this is a
 *  plain `Logger` instance, never `@/logger/logger.service`'s DB-backed one (that one needs a
 *  request/job company context this pure resolver has neither access to nor any business assuming).
 *  A WARN here is exactly what an operator's log aggregation (self-hosted Docker logs, the SaaS
 *  cluster's own) is watched for -- see `resolveInvoiceNotes`'s own header for what triggers it. */
const logger = new Logger('InvoiceNotes');

export interface ResolvedInvoiceNote {
  /** BT-21, UNTDID 4451. */
  subjectCode?: string;
  /** BT-22, placeholders already substituted. */
  text: string;
  legalRef: string;
}

/**
 * Thrown by `resolveNoteText` (and so by `resolveInvoiceNotes`) when a mention's own `{placeholder}`
 * has no value in force for the date it is being resolved for AND the rule has no `fallbackText` to
 * use instead -- an invoice issued before its value table's own earliest `validFrom` (e.g. a pre-2012
 * date against `recoveryIndemnity`'s table, which only starts there -- still true after #519, see
 * `hasTableRunOut`'s own header for why that shape of gap is deliberately excluded from the
 * fallback), or a rule whose table ran out and which simply never declared a `fallbackText` at all.
 * Named so a caller can tell this apart from any other error and turn it into an actionable
 * 400/send-refusal (the same "a named hard block, never a generic throw" posture
 * `tax/resolve-invoice-tax.ts`'s own `isInvoiceTaxBlockError` siblings hold) rather than a document
 * quietly printing the raw `{token}` on a legally mandated mention -- the bug this type exists to make
 * impossible: printing "{lateFeeRate}" ON THE INVOICE ITSELF is not a degraded rendering, it is a
 * broken legal document that reads as though the software is broken, because it is.
 */
export class UnresolvedInvoiceNotePlaceholderError extends Error {}

function pickValue(table: TemporalValue[] | undefined, at: Date): string | null {
  return table?.length
    ? pickByDate(
        table.map((t) => ({ validFrom: t.validFrom, validTo: t.validTo, value: t.value })),
        at,
      )
    : null;
}

/**
 * True only for the "ran out going forward" shape of gap -- the table exists, has at least one
 * window, and its own chronologically LAST entry (by `validFrom`) carries a `validTo` that `at` has
 * already reached or passed, with nothing newer added to replace it. This is issue #519: a
 * maintenance lapse past the table's own next scheduled check (`noteValues.lateFeeRate`'s own header
 * in `data/fr.json` -- the ECB rate is read again every 1 January and 1 July, L441-10 II).
 *
 * Deliberately FALSE for the opposite shape -- `at` before the table's own earliest `validFrom` (a
 * pre-2026 backdated/imported French invoice against `lateFeeRate`, still tested by
 * `invoice-notes.spec.ts`) -- that is a different, pre-existing gap this issue does not touch: a
 * document dated before the statute's own value table begins has no formula to fall back to either,
 * so it keeps refusing exactly as before.
 *
 * An entry with no `validTo` at all is open-ended and would already have matched in `pickValue`
 * above, so this function is never even asked about it -- `resolveNoteText` below only calls this
 * once `pickValue` has already returned `null`.
 */
function hasTableRunOut(table: TemporalValue[] | undefined, at: Date): boolean {
  if (!table?.length) return false;
  const latestEntry = table.reduce((latest, entry) =>
    new Date(entry.validFrom).getTime() > new Date(latest.validFrom).getTime() ? entry : latest,
  );
  if (!latestEntry.validTo) return false;
  return at.getTime() >= new Date(latestEntry.validTo).getTime();
}

/**
 * Resolves every `{placeholder}` in `rule.text` against `values` for `at`.
 *
 * A placeholder with no value in force normally throws `UnresolvedInvoiceNotePlaceholderError` --
 * never silently leaves the raw `{name}` token in place. The ONE exception (issue #519): a rule that
 * declares a `fallbackText` (`schema.ts`'s own field doc), used verbatim -- no further interpolation --
 * when the unresolved placeholder's own table has RUN OUT (`hasTableRunOut` above), never when it has
 * not started yet. A send must never fail only because nobody has entered the next dated figure yet;
 * using the fallback is logged at WARN so an operator's log aggregation catches the table needing
 * maintenance, exactly the same "actionable, needs a human" signal
 * `documents.service.ts#warnAboutUndeclaredStatuses` already logs for its own integrity check.
 */
function resolveNoteText(
  rule: InvoiceNoteRule,
  values: Record<string, TemporalValue[]> | undefined,
  at: Date,
): string {
  const names = new Set<string>();
  for (const match of rule.text.matchAll(/\{(\w+)\}/g)) names.add(match[1]);

  for (const name of names) {
    const table = values?.[name];
    if (pickValue(table, at) != null) continue;

    if (rule.fallbackText && hasTableRunOut(table, at)) {
      logger.warn(
        `Mention "${rule.legalRef}" fell back to its statutory rule wording: its "{${name}}" value ` +
          `table has no entry covering ${at.toISOString().slice(0, 10)} because the last dated window ` +
          'has already ended. Add the next dated entry to noteValues to resume printing a computed ' +
          'figure.',
        { legalRef: rule.legalRef, placeholder: name, issueDate: at.toISOString().slice(0, 10) },
      );
      return rule.fallbackText;
    }

    throw new UnresolvedInvoiceNotePlaceholderError(
      `Mention "${rule.legalRef}" declares the placeholder "{${name}}", but no value is in force for ` +
        `it on ${at.toISOString().slice(0, 10)} -- refusing to print the raw template token on a ` +
        'legally mandated mention.',
    );
  }

  return rule.text.replace(/\{(\w+)\}/g, (_whole, name: string) => pickValue(values?.[name], at) as string);
}

/**
 * The notes to put on a document issued on `at`.
 *
 * Only `statutory` rules are emitted. A mention that states a COMMERCIAL choice -- a stipulated rate
 * different from the statutory one, real discount terms -- must come from the user, and inventing one
 * on their behalf would put a claim on their invoice that they never made.
 */
export function resolveInvoiceNotes(file: CountryMentionsFile | undefined, at: Date): ResolvedInvoiceNote[] {
  const rules = (file?.invoiceNotes ?? [])
    .filter((t) => new Date(t.validFrom) <= at && (!t.validTo || new Date(t.validTo) > at))
    .map((t) => t.value as InvoiceNoteRule)
    .filter((r) => r.statutory);

  return rules.map((r) => ({
    subjectCode: r.subjectCode,
    text: resolveNoteText(r, file?.noteValues, at),
    legalRef: r.legalRef,
  }));
}

/**
 * EN 16931 UBL carries BT-21 as a `#CODE#` prefix on `cbc:Note` -- the shape BR-CL-08 validates
 * ("Invoiced note subject code shall be coded using UNCL4451", testing the three characters between
 * two hashes). CII splits them into `ram:SubjectCode` and `ram:Content`
 * (`../formats/semantic/cii-post-process.ts#splitCiiIncludedNotes`, which already parses exactly this
 * `#CODE#` shape) -- one encoding serves both syntaxes.
 */
export function toUblNote(note: ResolvedInvoiceNote): string {
  return note.subjectCode ? `#${note.subjectCode}#${note.text}` : note.text;
}
