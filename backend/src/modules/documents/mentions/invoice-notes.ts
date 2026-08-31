/**
 * The mentions a country requires on every invoice (BG-1), resolved for a date.
 *
 * REPRISE quasi verbatim de `compliance/profiles/invoice-notes.ts` (git tag `avant-refonte-documents`)
 * — la logique n'a pas changé ; seul le type d'entrée devient un `CountryMentionsFile` de ce module
 * (`schema.ts`) plutôt qu'un `CountryComplianceProfile` de l'ancien moteur, puisque ce module ne
 * connaît que les mentions, pas tout un profil pays.
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
export function resolveInvoiceNotes(file: CountryMentionsFile | undefined, at: Date): ResolvedInvoiceNote[] {
  const rules = (file?.invoiceNotes ?? [])
    .filter((t) => new Date(t.validFrom) <= at && (!t.validTo || new Date(t.validTo) > at))
    .map((t) => t.value as InvoiceNoteRule)
    .filter((r) => r.statutory);

  return rules.map((r) => ({
    subjectCode: r.subjectCode,
    text: interpolate(r.text, file?.noteValues, at),
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
