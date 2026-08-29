/**
 * The mentions a country requires on every invoice (BG-1), resolved for a date.
 *
 * Data in, text out. The engine names no jurisdiction: it renders whatever the profile lists, and a
 * country that requires nothing lists nothing. France is the only profile carrying any today —
 * C. com. art. L441-9 I al. 5 puts three mentions in one sentence, and omitting them is an
 * administrative offence, not a formatting nicety.
 *
 * Values are FROZEN AT ISSUE DATE, never recomputed. France's supplementary late-payment rate moves
 * every six months (ECB refi + 10 points, read at 1 January and 1 July — L441-10 II); re-resolving
 * an old invoice in a later semester would restate a document that was correct when issued.
 */
import { CountryComplianceProfile, InvoiceNoteRule, TemporalValue } from './schema';
import { pickByDate } from './temporal';

export interface ResolvedInvoiceNote {
  /** BT-21, UNTDID 4451. */
  subjectCode?: string;
  /** BT-22, placeholders already substituted. */
  text: string;
  legalRef: string;
}

/** `{name}` → the value in force at `at`, or the placeholder left untouched when none is. */
function interpolate(text: string, values: Record<string, TemporalValue[]> | undefined, at: Date): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const table = values?.[name];
    if (!table?.length) return whole;
    const hit = pickByDate(
      table.map((t) => ({ validFrom: t.validFrom, validTo: t.validTo, value: t.value })),
      at,
    );
    return hit ?? whole;
  });
}

/**
 * The notes to put on a document issued on `at`.
 *
 * Only `statutory` rules are emitted. A mention that states a COMMERCIAL choice — a stipulated rate
 * different from the statutory one, real discount terms — must come from the user, and inventing one
 * on their behalf would put a claim on their invoice that they never made.
 */
export function resolveInvoiceNotes(
  profile: CountryComplianceProfile | undefined,
  at: Date,
): ResolvedInvoiceNote[] {
  const rules = (profile?.invoiceNotes ?? [])
    .filter((t) => new Date(t.validFrom) <= at && (!t.validTo || new Date(t.validTo) > at))
    .map((t) => t.value as InvoiceNoteRule)
    .filter((r) => r.statutory);

  return rules.map((r) => ({
    subjectCode: r.subjectCode,
    text: interpolate(r.text, profile?.noteValues, at),
    legalRef: r.legalRef,
  }));
}

/**
 * EN 16931 UBL carries BT-21 as a `#CODE#` prefix on `cbc:Note` — the shape BR-CL-08 validates
 * ("Invoiced note subject code shall be coded using UNCL4451", testing the three characters between
 * two hashes). CII splits them into `ram:SubjectCode` and `ram:Content`; the generator derives that
 * from this form, so one encoding serves both syntaxes.
 */
export function toUblNote(note: ResolvedInvoiceNote): string {
  return note.subjectCode ? `#${note.subjectCode}#${note.text}` : note.text;
}
