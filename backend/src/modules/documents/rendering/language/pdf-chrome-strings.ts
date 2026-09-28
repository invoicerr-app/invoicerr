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
  /** Issue #373 ("quotes with options") - the badge printed next to the accepted option's own
   *  heading, once a choice has been recorded (`render-html.ts`'s option-groups block). Never shown
   *  before an option is accepted, and never shown at all for a 0/1-option document. */
  acceptedOptionBadge: string;
  /** Issue #373 follow-up ("common lines") - the heading of the group listing every line nobody
   *  tagged with an `option` at all ("Setup fee"), on a quote with 2+ options - see
   *  `render-html.ts`'s own `optionGroups.groups[].isCommon`. Never shown for a 0/1-option document,
   *  or for one where every line IS tagged. */
  commonToAllOptionsHeading: string;
  /** Issue #373 follow-up ("no meaningless common total") - the gross-row LABEL a real option's own
   *  totals block uses INSTEAD of the plain `total` above, whenever a common (untagged) group exists
   *  alongside it: the figure is unchanged (still that option's own tagged lines PLUS the common
   *  ones, `computeQuoteOptionTotals`'s own merge), only the label says so, since the common group
   *  itself no longer prints any total of its own for a reader to trace the inclusion back to - see
   *  `render-html.ts#renderOptionGroupsField`'s own header. */
  totalIncludingCommonLines: string;
  /** Issue #507 - "Corrects invoice {number} of {date}", the header line of a LINKED credit note
   *  (`render-html.ts`'s own `correctedInvoice` input). A full phrase for the same word-order reason
   *  as `vatOn`; callers pass already-escaped values. */
  correctsInvoice(number: string, date: string): string;
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
  acceptedOptionBadge: 'Accepted',
  commonToAllOptionsHeading: 'Common to all options',
  totalIncludingCommonLines: 'Total (including common lines)',
  correctsInvoice: (number, date) => `Corrects invoice ${number} of ${date}`,
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
  acceptedOptionBadge: 'Accepté',
  commonToAllOptionsHeading: 'Commun à toutes les options',
  totalIncludingCommonLines: 'Total (lignes communes incluses)',
  correctsInvoice: (number, date) => `Rectifie la facture ${number} du ${date}`,
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
  acceptedOptionBadge: 'Accettata',
  commonToAllOptionsHeading: 'Comune a tutte le opzioni',
  totalIncludingCommonLines: 'Totale (righe comuni incluse)',
  correctsInvoice: (number, date) => `Rettifica la fattura ${number} del ${date}`,
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
  acceptedOptionBadge: 'Zaakceptowano',
  commonToAllOptionsHeading: 'Wspólne dla wszystkich opcji',
  totalIncludingCommonLines: 'Razem (z pozycjami wspólnymi)',
  correctsInvoice: (number, date) => `Koryguje fakturę ${number} z dnia ${date}`,
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
  acceptedOptionBadge: 'Akzeptiert',
  commonToAllOptionsHeading: 'Gemeinsam für alle Optionen',
  totalIncludingCommonLines: 'Gesamt (inkl. gemeinsamer Positionen)',
  correctsInvoice: (number, date) => `Berichtigt die Rechnung ${number} vom ${date}`,
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
  acceptedOptionBadge: 'Aceite',
  commonToAllOptionsHeading: 'Comum a todas as opções',
  totalIncludingCommonLines: 'Total (incluindo linhas comuns)',
  correctsInvoice: (number, date) => `Retifica a fatura ${number} de ${date}`,
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
