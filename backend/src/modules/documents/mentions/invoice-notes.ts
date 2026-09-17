/**
 * The mentions a country requires on every invoice (BG-1), resolved for a date.
 *
 * CARRIED OVER almost verbatim from `compliance/profiles/invoice-notes.ts` (git tag
 * `avant-refonte-documents`) — the logic has not changed; only the input type becomes a
 * `CountryMentionsFile` from this module (`schema.ts`) rather than a `CountryComplianceProfile` from
 * the old engine, since this module knows only about mentions, not a whole country profile.
 *
 * Data in, text out. The engine names no jurisdiction: it renders whatever the country's file lists,
 * and a country that requires nothing lists nothing. France is the only file carrying any today —
 * C. com. art. L441-9 I al. 5 puts three mentions in one sentence, and omitting them is an
 * administrative offence, not a formatting nicety.
 *
 * Values are FROZEN AT ISSUE DATE, never recomputed. France's supplementary late-payment rate moves
 * every six months (ECB refi + 10 points, read at 1 January and 1 July — L441-10 II); re-resolving
 * an old invoice in a later semester would restate a document that was correct when issued.
 */
import { CountryMentionsFile, InvoiceNoteRule, TemporalValue } from './schema';
import { pickByDate } from './temporal';

export interface ResolvedInvoiceNote {
  /** BT-21, UNTDID 4451. */
  subjectCode?: string;
  /** BT-22, placeholders already substituted. */
  text: string;
  legalRef: string;
}

/**
 * Thrown by `interpolate` (and so by `resolveInvoiceNotes`) when a mention's own `{placeholder}`
 * has no value in force for the date it is being resolved for — an invoice issued before its value
 * table's own earliest `validFrom` (e.g. a pre-2012 date against `recoveryIndemnity`'s table, which
 * only starts there), or on/after its last window's `validTo` because nobody has entered the NEXT
 * one yet (see `mentions/data/fr.json`'s own `lateFeeRate` header on the semi-annual ECB check this
 * is what makes fail loudly rather than silently). Named so a caller can tell this apart from any
 * other error and turn it into an actionable 400/send-refusal (the same "a named hard block, never a
 * generic throw" posture `tax/resolve-invoice-tax.ts`'s own `isInvoiceTaxBlockError` siblings hold)
 * rather than a document quietly printing the raw `{token}` on a legally mandated mention — the bug
 * this type exists to make impossible: printing "{lateFeeRate}" ON THE INVOICE ITSELF is not a
 * degraded rendering, it is a broken legal document that reads as though the software is broken,
 * because it is.
 */
export class UnresolvedInvoiceNotePlaceholderError extends Error {}

/** `{name}` → the value in force at `at` — throws `UnresolvedInvoiceNotePlaceholderError` (never
 *  silently leaves the raw `{name}` token in place) when the value table is absent, empty, or simply
 *  has no window covering `at`. */
function interpolate(
  text: string,
  values: Record<string, TemporalValue[]> | undefined,
  at: Date,
  legalRef: string,
): string {
  return text.replace(/\{(\w+)\}/g, (_whole, name: string) => {
    const table = values?.[name];
    const hit = table?.length
      ? pickByDate(
          table.map((t) => ({ validFrom: t.validFrom, validTo: t.validTo, value: t.value })),
          at,
        )
      : null;
    if (hit == null) {
      throw new UnresolvedInvoiceNotePlaceholderError(
        `Mention "${legalRef}" declares the placeholder "{${name}}", but no value is in force for it ` +
          `on ${at.toISOString().slice(0, 10)} — refusing to print the raw template token on a legally ` +
          'mandated mention.',
      );
    }
    return hit;
  });
}

/**
 * The notes to put on a document issued on `at`.
 *
 * Only `statutory` rules are emitted. A mention that states a COMMERCIAL choice — a stipulated rate
 * different from the statutory one, real discount terms — must come from the user, and inventing one
 * on their behalf would put a claim on their invoice that they never made.
 */
export function resolveInvoiceNotes(file: CountryMentionsFile | undefined, at: Date): ResolvedInvoiceNote[] {
  const rules = (file?.invoiceNotes ?? [])
    .filter((t) => new Date(t.validFrom) <= at && (!t.validTo || new Date(t.validTo) > at))
    .map((t) => t.value as InvoiceNoteRule)
    .filter((r) => r.statutory);

  return rules.map((r) => ({
    subjectCode: r.subjectCode,
    text: interpolate(r.text, file?.noteValues, at, r.legalRef),
    legalRef: r.legalRef,
  }));
}

/**
 * EN 16931 UBL carries BT-21 as a `#CODE#` prefix on `cbc:Note` — the shape BR-CL-08 validates
 * ("Invoiced note subject code shall be coded using UNCL4451", testing the three characters between
 * two hashes). CII splits them into `ram:SubjectCode` and `ram:Content`
 * (`../formats/semantic/cii-post-process.ts#splitCiiIncludedNotes`, which already parses exactly this
 * `#CODE#` shape) — one encoding serves both syntaxes.
 */
export function toUblNote(note: ResolvedInvoiceNote): string {
  return note.subjectCode ? `#${note.subjectCode}#${note.text}` : note.text;
}
