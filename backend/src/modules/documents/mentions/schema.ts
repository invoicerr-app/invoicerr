/**
 * The country MANDATORY-MENTIONS file format — root TODO item 15, "mentions obligatoires". A mention
 * is a legal text a country requires on EVERY invoice (BG-1 in EN 16931 terms — BT-21 subject code +
 * BT-22 free text), resolved for a document's own issue date. Same file-per-country, load-time-gated
 * shape `transports/channel-policy/schema.ts` already established for a DIFFERENT country-is-data
 * concern — see this module's own `data/all.ts` header for why this format is LOADED, never SEEDED
 * into a table the way `country-policy/` is.
 *
 * REPRISE, near verbatim, of `compliance/profiles/schema.ts`'s own `InvoiceNoteRule`/`TemporalValue`
 * (git tag `avant-refonte-documents`) — see `invoice-notes.ts`'s own header for the resolver this
 * schema feeds, reprised the same way.
 *
 * France is the case that forced this: C. com. art. L441-9 I al. 5 puts THREE mentions in a single
 * sentence — the early-payment discount terms, the late-payment rate, and the fixed recovery
 * indemnity — and omitting them is an administrative offence (L441-9 II: up to 75 000 EUR for a
 * natural person, 375 000 EUR for a company). A real PDP sandbox deposit was REJECTED over exactly
 * this (fr:213 — see `../transports/pdp/pdp.live.spec.ts`'s own header for the round-trip this data
 * exists to fix), not a hypothetical.
 *
 * Declared as DATA, never as a branch on the country: `invoice-notes.ts#resolveInvoiceNotes` renders
 * whatever a country's file lists, and a country with no file lists nothing.
 */

/** Every rule list here is temporal. `validTo` is EXCLUSIVE; absence means "open-ended" — the exact
 *  convention `transports/channel-policy/schema.ts`'s own `mandatedFrom` half-open window follows,
 *  restated here as a proper `[validFrom, validTo)` pair because a mention (unlike a mandate) can
 *  also stop applying (a repealed article), not just start. */
export interface Temporal<T> {
  validFrom: string; // ISO date
  validTo?: string; // ISO date, exclusive
  value: T;
}

/**
 * A mention a country requires on every invoice — BG-1 in EN 16931 terms.
 *
 * `text` may carry `{placeholders}` resolved from a file's own `noteValues` — the French late-payment
 * rate changes every six months, so freezing it as a plain string here would silently print a stale
 * rate the day the ECB rate moves without this file being touched.
 */
export interface InvoiceNoteRule {
  /** UNTDID 4451 subject code (BT-21). Optional: BT-22 alone is a valid note. */
  subjectCode?: string;
  /** BT-22. `{name}` placeholders are substituted from the resolved values at the issue date. */
  text: string;
  /** The article this mention discharges — carried so a reader can check it, and shown in no UI.
   *  MANDATORY: `assertValidMentionRule` below refuses to load a rule with no `legalRef`, the same
   *  "a mandate without a citation does not load" discipline
   *  `transports/channel-policy/schema.ts#assertValidChannelPolicyFact` already holds for a
   *  `mandated` channel fact — a mandatory mention is exactly as much a legal claim as a channel
   *  mandate is. */
  legalRef: string;
  /**
   * Marks a mention the LAW supplies a value for, as opposed to one that states a commercial choice.
   * Only `statutory: true` rules are ever emitted by `resolveInvoiceNotes` — a mention that states a
   * COMMERCIAL choice (a stipulated rate different from the statutory one, real discount terms) must
   * come from the user; inventing one on their behalf would put a claim on their invoice they never
   * made. No shipped rule today sets this to `false` — the field exists so a FUTURE non-statutory
   * mention (were one ever added) is excluded by construction, not by a caller remembering to filter.
   */
  statutory: boolean;
  /** Free-form sourcing/maintenance note — same convention as `country-policy/schema.ts`'s own
   *  per-rule `notes`. JSON carries no comments, so a maintenance instruction that would be a code
   *  comment on a TS file (e.g. "update this twice a year") lives here instead. */
  notes?: string;
}

/**
 * A value that changes on a calendar schedule and must be FROZEN AT ISSUE DATE, never recomputed.
 *
 * France's supplementary late-payment rate is the ECB main refinancing rate plus ten points, read at
 * 1 January for the first half-year and 1 July for the second (C. com. art. L441-10 II). An invoice
 * issued in July carries July's rate FOR EVER — re-resolving it in a later semester would restate a
 * document that was correct when issued. This is the property `invoice-notes.ts#resolveInvoiceNotes`
 * exists to guarantee: it always resolves against the caller's `at` (the document's own issue date),
 * never `new Date()`.
 */
export interface TemporalValue {
  validFrom: string;
  validTo?: string;
  value: string;
  /** Free-form sourcing/maintenance note, same convention as `InvoiceNoteRule.notes`. */
  notes?: string;
}

export interface CountryMentionsFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  invoiceNotes: Temporal<InvoiceNoteRule>[];
  /** Named values the notes interpolate, each on its own calendar. Keyed by placeholder name. */
  noteValues?: Record<string, TemporalValue[]>;
  /** Free-form, file-level caveats — e.g. the "maintain this twice a year" instruction for a rate
   *  table, or a nuance about why a code is used that no local text actually names. Distinct from a
   *  per-rule `notes`, which explains ONE mention. */
  notes?: string;
}

export class InvalidMentionRuleError extends Error {}

/**
 * The one gate a mention cannot get past without a real citation — same role
 * `transports/channel-policy/schema.ts#assertValidChannelPolicyFact` plays for a channel mandate.
 * Called from `data/all.ts` at load time (see that file's header for why this is enough here, unlike
 * `country-policy/`'s own two-gate discipline: this format is never mirrored into a database the
 * `country-policy/` one is, so there is no second write path that could skip the file loader).
 */
export function assertValidMentionRule(entry: Temporal<InvoiceNoteRule>, context: string): void {
  const rule = entry.value as InvoiceNoteRule | null | undefined;
  const label = rule?.subjectCode ?? '(no subjectCode)';

  if (!rule || typeof rule.text !== 'string' || !rule.text.trim()) {
    throw new InvalidMentionRuleError(
      `${context}: mention "${label}" has no "text" — a mandatory mention may never exist with no ` +
        'content to print (BT-22 is what discharges the legal obligation).',
    );
  }
  if (!rule.legalRef?.trim()) {
    throw new InvalidMentionRuleError(
      `${context}: mention "${label}" has no "legalRef" — a mandatory mention may never be emitted ` +
        'without saying which legal text imposes it.',
    );
  }
  if (typeof rule.statutory !== 'boolean') {
    throw new InvalidMentionRuleError(
      `${context}: mention "${label}" has no boolean "statutory" flag — whether a mention may be ` +
        'emitted without asking the user anything must be stated explicitly, never assumed.',
    );
  }
  if (!entry.validFrom?.trim()) {
    throw new InvalidMentionRuleError(`${context}: mention "${label}" has no "validFrom" date.`);
  }
}
