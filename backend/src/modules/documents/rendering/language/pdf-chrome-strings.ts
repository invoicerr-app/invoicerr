import { RenderLanguage } from './supported-languages';

/**
 * The render layer's OWN chrome vocabulary — the handful of words `rendering/render-html.ts` prints
 * around the document's DATA (a status line, the totals section, a boolean's Yes/No, …), as opposed to
 * `DocumentTypeDescriptor.label`/`field.label`/`option.label`, which stay untranslated by design (see
 * `descriptors/types.ts`'s own comment: "plain data, not an i18n key — a plugin can name its type in
 * any language"). Translating THOSE would mean inventing a translation catalog for content a
 * third-party plugin author could write in any language to begin with, which is a different, larger
 * problem than this feature solves; this dictionary only ever covers strings this render layer itself
 * authored, in `render-html.ts` and nowhere else.
 *
 * This is a THIRD place, distinct from both:
 *  - the per-locale `translation.json` files under `frontend/src/locales` (`t()`), which only ever
 *    reach the SPA screen — no code path from a PDF/email render ever imports i18next or reads them;
 *  - the country-mandated wordings in `mentions/data/*.json` and `tax/tax-engine.ts`'s own
 *    `LOCALIZED_MENTION` table, which are statutory text selected by COUNTRY, never by this recipient
 *    language (see those files' own headers — this dictionary must never be reached for by anything
 *    that resolves a mention).
 *
 * `Record<RenderLanguage, PdfChromeStrings>`, not `Partial`: the compiler requires every field for
 * every one of the six supported languages, so there is no "supported language, missing chrome string"
 * state — the missing-translation POLICY below only ever applies to content this dictionary does not
 * cover (an unsupported language entirely, handled by `resolveRecipientLanguage` before this module is
 * ever consulted; or a document type's own email defaults, see `email-defaults.ts`).
 */
export interface PdfChromeStrings {
  status: string;
  date: string;
  totals: string;
  net: string;
  /** "VAT {ratePercent}% on {base}" — a full phrase, not a template, so word order can differ per
   *  language (French/Italian/Portuguese put the preposition before the base amount, same as English;
   *  German instead reads "USt. 20% auf {base}" — same shape here, kept as one function rather than a
   *  `{rate}%/{on}/{base}` triple so a future language is never tempted to reorder three independent
   *  strings incorrectly). Callers pass ALREADY-ESCAPED values (see `render-html.ts`), so this
   *  function only ever arranges its own trusted words around them. */
  vatOn(ratePercent: string, base: string): string;
  total: string;
  yes: string;
  no: string;
  draftNoNumberYet: string;
  /** Shown INSTEAD of `draftNoNumberYet` for a numbered document that has none - issue #471: a
   *  document issued before its type declared `numbering` at all (a legacy credit note) must never
   *  be numbered retroactively (see `numbering.onlyFrom`'s own header, backend
   *  `descriptors/types.ts`) - this is what `render-html.ts` prints for it instead, a distinct
   *  string from "draft, no number yet" since the two mean different things. */
  issuedWithoutNumber: string;
  scanToPaySepa: string;
  /** Heading of the "Payment methods" section — see `render-html.ts`'s own `paymentMethods` input and
   *  `descriptors/types.ts#usesPaymentMethods`. Each METHOD's own `label` (below the heading) stays
   *  untranslated, the same "plain data" convention every descriptor label already holds — only this
   *  section's heading is this render layer's OWN chrome. */
  paymentMethodsHeading: string;
  /** Heading of the "additional fields" section (custom fields) —
   *  see `render-html.ts`'s own `customFields` input. Each definition's own `label` stays untranslated
   *  (plain data, a company's own wording), only this section's heading is this render layer's OWN
   *  chrome. */
  customFieldsHeading: string;
}

const EN: PdfChromeStrings = {
  status: 'Status',
  date: 'Date',
  totals: 'Totals',
  net: 'Net',
  vatOn: (ratePercent, base) => `VAT ${ratePercent}% on ${base}`,
  total: 'Total',
  yes: 'Yes',
  no: 'No',
  draftNoNumberYet: 'Draft — no number yet',
  issuedWithoutNumber: 'Issued without a number',
  scanToPaySepa: 'Scan to pay (SEPA)',
  paymentMethodsHeading: 'Payment methods',
  customFieldsHeading: 'Additional fields',
};

const FR: PdfChromeStrings = {
  status: 'Statut',
  date: 'Date',
  totals: 'Totaux',
  net: 'Net',
  vatOn: (ratePercent, base) => `TVA ${ratePercent}% sur ${base}`,
  total: 'Total',
  yes: 'Oui',
  no: 'Non',
  draftNoNumberYet: 'Brouillon — pas encore de numéro',
  issuedWithoutNumber: 'Émis sans numéro',
  scanToPaySepa: 'Scannez pour payer (SEPA)',
  paymentMethodsHeading: 'Moyens de paiement',
  customFieldsHeading: 'Champs supplémentaires',
};

const IT: PdfChromeStrings = {
  status: 'Stato',
  date: 'Data',
  totals: 'Totali',
  net: 'Netto',
  vatOn: (ratePercent, base) => `IVA ${ratePercent}% su ${base}`,
  total: 'Totale',
  yes: 'Sì',
  no: 'No',
  draftNoNumberYet: 'Bozza — numero non ancora assegnato',
  issuedWithoutNumber: 'Emesso senza numero',
  scanToPaySepa: 'Scansiona per pagare (SEPA)',
  paymentMethodsHeading: 'Metodi di pagamento',
  customFieldsHeading: 'Campi aggiuntivi',
};

const PL: PdfChromeStrings = {
  status: 'Status',
  date: 'Data',
  totals: 'Podsumowanie',
  net: 'Netto',
  vatOn: (ratePercent, base) => `VAT ${ratePercent}% od ${base}`,
  total: 'Razem',
  yes: 'Tak',
  no: 'Nie',
  draftNoNumberYet: 'Wersja robocza — brak numeru',
  issuedWithoutNumber: 'Wystawiono bez numeru',
  scanToPaySepa: 'Zeskanuj, aby zapłacić (SEPA)',
  paymentMethodsHeading: 'Metody płatności',
  customFieldsHeading: 'Dodatkowe pola',
};

const DE: PdfChromeStrings = {
  status: 'Status',
  date: 'Datum',
  totals: 'Summe',
  net: 'Netto',
  vatOn: (ratePercent, base) => `USt. ${ratePercent}% auf ${base}`,
  total: 'Gesamt',
  yes: 'Ja',
  no: 'Nein',
  draftNoNumberYet: 'Entwurf — noch keine Nummer',
  issuedWithoutNumber: 'Ohne Nummer ausgestellt',
  scanToPaySepa: 'Zum Bezahlen scannen (SEPA)',
  paymentMethodsHeading: 'Zahlungsmethoden',
  customFieldsHeading: 'Zusätzliche Felder',
};

const PT: PdfChromeStrings = {
  status: 'Estado',
  date: 'Data',
  totals: 'Totais',
  net: 'Líquido',
  vatOn: (ratePercent, base) => `IVA ${ratePercent}% sobre ${base}`,
  total: 'Total',
  yes: 'Sim',
  no: 'Não',
  draftNoNumberYet: 'Rascunho — sem número ainda',
  issuedWithoutNumber: 'Emitido sem número',
  scanToPaySepa: 'Digitalize para pagar (SEPA)',
  paymentMethodsHeading: 'Formas de pagamento',
  customFieldsHeading: 'Campos adicionais',
};

const CHROME_STRINGS: Record<RenderLanguage, PdfChromeStrings> = {
  en: EN,
  fr: FR,
  it: IT,
  pl: PL,
  de: DE,
  pt: PT,
};

/** Looks up this render layer's OWN vocabulary for `language`. Every member of
 *  `SUPPORTED_RENDER_LANGUAGES` is a key of `CHROME_STRINGS` by construction (the `Record` type above
 *  is exhaustive, not `Partial`), so this never actually falls through to `EN` for a well-typed
 *  caller — the `?? EN` exists only as the same defensive floor `resolveRecipientLanguage` already is
 *  for a caller that reaches this with an unchecked value (e.g. straight from the database). */
export function pdfChromeStrings(language: RenderLanguage): PdfChromeStrings {
  return CHROME_STRINGS[language] ?? EN;
}
