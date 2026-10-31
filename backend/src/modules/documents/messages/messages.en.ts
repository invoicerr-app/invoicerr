/**
 * English text for every explanation the server composes and a screen or a PDF shows: tax warnings,
 * line-total warnings, credit warnings, currency-consolidation notes and the legal retention basis.
 *
 * Each entry is a template over `{{name}}` placeholders, the same interpolation syntax the frontend's
 * `t()` uses, so `frontend/src/locales/en/translation.json` holds the exact same strings under the
 * exact same keys. `messages.en.spec.ts` fails when the two drift: the backend needs the text to
 * render a PDF or a CSV, and the frontend needs it to translate, and a warning that says one thing in
 * the app and another in the PDF is worse than an untranslated one.
 *
 * Params are values, never sentences: a statute citation, a rule label or a raw stored rate is data
 * this catalog must not reword.
 */
export const SERVER_MESSAGES_EN = {
  'documents.messages.tax.buyerVatInvalid':
    'Buyer VAT number "{{vatNumber}}" is not syntactically valid for {{country}} ({{reason}}), so this buyer is treated as B2C, never a silent B2B.',
  'documents.messages.tax.buyerVatUnverified':
    'Buyer VAT number "{{vatNumber}}" has not been confirmed valid yet (status: {{status}}), so this buyer is treated as B2C until it is verified, never a silent B2B.',
  'documents.messages.tax.supplyTypeMissing':
    'Line {{line}} has no declared supply type (goods/services), so it is treated as SERVICES for cross-border VAT purposes; declare it explicitly if this line is actually a delivery of goods.',
  'documents.messages.tax.rateNotInCatalog':
    "Line {{line}}'s chosen VAT rate (\"{{rate}}\") is not one of {{country}}'s known VAT rates, so this cross-border B2C line is taxed in {{country}}, at {{country}}'s own standard rate instead, since there is no known rate on this invoice to honour.",
  'documents.messages.tax.exemptCountryUnsupported':
    'This company is marked "{{scheme}}" (VAT-exempt), but no VAT/GST tax system is known for its own country ({{country}}) in this catalog, so this invoice was left at the rate the user chose, since a small-business VAT exemption is not something this catalog can safely apply for a country with an unknown or non-VAT tax system, guessed either way.',
  'documents.messages.tax.ossStandardRate':
    "This invoice is an intra-Community distance sale taxed in {{country}} (EU One-Stop-Shop, Directive 2006/112/EC art. 33(a)), so {{country}}'s STANDARD VAT rate ({{rate}}%) was applied. {{country}}'s own reduced rates are not modelled here and an invoice line carries nothing that says which products they cover. Check the destination rate yourself if what you are selling is reduced-rated there, or this invoice over-charges the customer.",

  'documents.messages.totals.currencyMissing': 'Document currency not found, using the default (2 decimals).',
  'documents.messages.totals.nonNumericQuantity':
    'line {{line}} has a non-numeric quantity (received {{value}}), counted as 1',
  'documents.messages.totals.nonNumericUnitPrice':
    'line {{line}} has a non-numeric unit price (received {{value}}), counted as 0',
  'documents.messages.totals.vatRateMissing': 'line {{line}} has no usable VAT rate, counted in net only',

  'documents.messages.lineTotals.mismatch':
    "Line total mismatch ({{total}}): the {{lines}} line(s) sum to {{computed}} but the document states {{stated}}, a difference of {{difference}}, beyond the {{tolerance}} rounding tolerance for this many line(s). Kept as entered: this is the supplier's own document, not recomputed.",

  'documents.messages.credits.currencyMismatch':
    'Credit note "{{label}}" declares its own currency as {{noteCurrency}}, different from invoice\'s own {{invoiceCurrency}}. The credited amount is always computed from, and expressed in, the invoice\'s own currency; counted as {{invoiceCurrency}}, never converted (there is nothing to convert).',

  'documents.messages.currency.rateUsed': '{{from}}→{{to}} @ {{rate}} ({{source}}, {{date}})',
  'documents.messages.currency.rateMissing':
    'No {{from}}→{{to}} rate is set, so the consolidated total is omitted.',

  'documents.messages.widgets.invoicesCapped':
    'Showing the {{shown}} most recently updated invoices of {{total}}. Use the accounting export for a complete period.',
  'documents.messages.widgets.quotesCapped':
    'Showing the {{shown}} most recently updated quotes of {{total}}.',
  'documents.messages.widgets.expensesCapped':
    'Showing the {{shown}} most recently updated expenses of {{total}}.',
  'documents.messages.widgets.creditNotesCapped':
    'Showing the {{shown}} most recently updated credit notes of {{total}}.',
  'documents.messages.widgets.schedulesPeriodIgnored':
    'The selected period does not apply to this list: it always shows the next scheduled runs, regardless of the active period.',

  'documents.messages.retention.single': '{{rule}}.',
  'documents.messages.retention.longerOf':
    '{{rule}}: the longer of {{count}} obligations that apply simultaneously to the same company: {{rules}}.',
  'documents.messages.retention.longerOfSkipped':
    '{{rule}}: the longer of {{count}} obligations that apply simultaneously to the same company: {{rules}}. ({{skipped}} other declared rule(s) could not be resolved: missing issue date.)',
  'documents.messages.retention.unresolved':
    "{{country}} declares {{count}} retention rule(s) ({{rules}}) but none could be resolved: the document's own issue date is missing or unparseable, and no declared rule here runs from the archiving instant alone.",
  'documents.messages.retention.none':
    'No retention rule declared for this country, so no duration is invented.',
  'documents.messages.retention.noneForCountry':
    'No retention rule declared for {{country}}, so no duration is invented.',
} as const;

export type ServerMessageKey = keyof typeof SERVER_MESSAGES_EN;
