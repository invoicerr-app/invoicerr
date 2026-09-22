/**
 * Maps the invoice line's free-text `unit` (`invoice.descriptor.ts`'s own field — deliberately NOT a
 * closed list; see that file's header) to a UN/ECE Recommendation N°20 unit-of-measure code.
 *
 * ## A real pitfall, found empirically, not assumed
 *
 * The vendored EN 16931 Schematron itself does NOT constrain `unitCode`'s vocabulary (checked before
 * writing this file — only presence is required, BR-23). But `@e-invoice-eu/core`'s OWN internal
 * ajv schema DOES: it rejects any `cbc:InvoicedQuantity/@unitCode` that is not a member of its
 * embedded UN/ECE Rec20 code list, with `must be equal to one of the allowed values` and several
 * hundred candidates — discovered by actually calling `generate()` with the descriptor's own
 * example unit strings ("hour", "day") before writing this file, not assumed from reading the old
 * code. `invoice.descriptor.ts`'s own header explicitly reserves the freedom to add "a closed
 * `options` list (or a dedicated field kind)" once a real consumer needs one — this IS that
 * consumer, and this file is the adapter, not a change to the descriptor's own field.
 *
 * This is a BEST-EFFORT mapping for the descriptor's own suggested examples ("hour", "day", "kg",
 * "unit" — see that field's `helpText`) plus a few more common ones, matched case-insensitively.
 * Anything unrecognized falls back to 'C62' ("one" / piece — UN/ECE Rec20's own generic "unit"
 * code), the same fallback the old, removed engine used for anything it did not have a dedicated
 * code for (`invoice-rendering.service.ts`'s own line-building code, git tag
 * `avant-refonte-documents`) — a defensible default, never a fabricated precision the user's own
 * free text did not actually express.
 */
const UNIT_CODES: Readonly<Record<string, string>> = {
  hour: 'HUR',
  hours: 'HUR',
  day: 'DAY',
  days: 'DAY',
  week: 'WEE',
  weeks: 'WEE',
  month: 'MON',
  months: 'MON',
  year: 'ANN',
  years: 'ANN',
  unit: 'C62',
  units: 'C62',
  piece: 'C62',
  pieces: 'C62',
  kg: 'KGM',
  kilogram: 'KGM',
  kilograms: 'KGM',
  g: 'GRM',
  gram: 'GRM',
  grams: 'GRM',
  l: 'LTR',
  litre: 'LTR',
  litres: 'LTR',
  liter: 'LTR',
  liters: 'LTR',
  m: 'MTR',
  meter: 'MTR',
  meters: 'MTR',
  metre: 'MTR',
  metres: 'MTR',
  km: 'KMT',
  set: 'SET',
  box: 'BX',
};

export function unitCodeFor(unit: string): string {
  return UNIT_CODES[unit.trim().toLowerCase()] ?? 'C62';
}
