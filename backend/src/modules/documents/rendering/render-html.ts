import { DocumentTypeDescriptor, DocumentFieldDescriptor } from '../descriptors/types';
import { decimalsFor, fromMinor } from '@/utils/financial';
import type { PaymentMethodPresentation } from '../payment-methods/types';
import type { DocumentTotals } from '../totals/compute-totals';
import { pdfChromeStrings, PdfChromeStrings } from './language/pdf-chrome-strings';
import { DEFAULT_RENDER_LANGUAGE, RenderLanguage } from './language/supported-languages';

/**
 * Escapes HTML special characters — applied to ALL values from data to prevent injection.
 */
function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

// Fallback for Node.js environment where document doesn't exist
export function escapeHtmlNode(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeHtmlSafe(value: string): string {
  try {
    return escapeHtml(value);
  } catch {
    return escapeHtmlNode(value);
  }
}

/**
 * Render a single field's value as HTML, by kind. Returns the HTML representation of the value,
 * or a visible error marker for unknown kinds.
 */
function renderFieldValue(
  field: DocumentFieldDescriptor,
  value: unknown,
  referenceLabels: Record<string, string>,
  data: Record<string, unknown>,
  strings: PdfChromeStrings,
): string {
  // Value is missing — render em-dash
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  switch (field.kind) {
    case 'text': {
      const stringValue = String(value);
      return escapeHtmlSafe(stringValue);
    }

    case 'longText': {
      const stringValue = String(value);
      return `<pre style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtmlSafe(stringValue)}</pre>`;
    }

    case 'number': {
      return escapeHtmlSafe(String(value));
    }

    case 'money': {
      const currency = field.currencyField ? String(data[field.currencyField] ?? '') : field.currency;
      const amount = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(amount)) {
        return escapeHtmlSafe(String(value));
      }
      const decimals = decimalsFor(currency ?? '');
      const formatted = amount.toFixed(decimals);
      return `${escapeHtmlSafe(formatted)} ${escapeHtmlSafe(currency ?? '')}`;
    }

    case 'date': {
      const dateStr = String(value);
      const parsed = new Date(dateStr);
      if (Number.isNaN(parsed.getTime())) {
        return escapeHtmlSafe(dateStr);
      }
      return dateStr; // YYYY-MM-DD format
    }

    case 'boolean': {
      return value ? strings.yes : strings.no;
    }

    case 'select': {
      const option = field.options?.find((o) => o.value === String(value));
      return escapeHtmlSafe(option?.label ?? String(value));
    }

    case 'reference': {
      // field.key -> referenceLabels lookup
      const label = referenceLabels[field.key];
      if (label) {
        return escapeHtmlSafe(label);
      }
      return escapeHtmlSafe(String(value));
    }

    case 'array': {
      const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      if (rows.length === 0) {
        return '—';
      }
      // 'hiddenReference' subfields (e.g. a line's `articleId`) are excluded
      // BEFORE the header/body loops below even run — not via `hideWhenEmpty`'s "skip a per-row cell
      // that happens to be empty" check (this loop never applies that hint to subfields at all, and a
      // populated `articleId` is exactly the case that must still never print), so there is neither a
      // header column nor a per-row cell for one, ever, regardless of value. See types.ts's own
      // `entity` doc comment ("ALSO the target hint for 'hiddenReference'") for the full rationale.
      const subFields = (field.fields ?? []).filter((subField) => subField.kind !== 'hiddenReference');
      let html = '<table style="border-collapse: collapse; width: 100%; margin-top: 8px;">';
      // Header
      html += '<thead><tr style="border-bottom: 1px solid #ccc;">';
      for (const subField of subFields) {
        html += `<th style="padding: 8px; text-align: left; font-weight: bold;">${escapeHtmlSafe(subField.label)}</th>`;
      }
      html += '</tr></thead>';
      // Body
      html += '<tbody>';
      for (const row of rows) {
        html += '<tr style="border-bottom: 1px solid #eee;">';
        for (const subField of subFields) {
          const cellValue = renderFieldValue(subField, row[subField.key], referenceLabels, row, strings);
          html += `<td style="padding: 8px;">${cellValue}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      return html;
    }

    case 'rowSelection': {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      if (ids.length === 0) {
        return '—';
      }
      let html = '<ul style="margin: 8px 0 8px 20px;">';
      for (const id of ids) {
        html += `<li>${escapeHtmlSafe(id)}</li>`;
      }
      html += '</ul>';
      return html;
    }

    default: {
      // Unknown kind — visible marker that never hides
      return `[unrendered field kind &quot;${escapeHtmlSafe(field.kind)}&quot; for &quot;${escapeHtmlSafe(field.key)}&quot;]`;
    }
  }
}

/** One country-mandated mention to print in the footer block — see `RenderDocumentHtmlInput.legalMentions`.
 *  `legalRef` is deliberately UNUSED by the renderer below: it is carried so a reader of the DATA can
 *  check it, never surfaced on the document itself — the same convention
 *  `mentions/invoice-notes.ts#ResolvedInvoiceNote` already documents at its own source. */
export interface RenderableLegalMention {
  text: string;
  legalRef: string;
}

export interface RenderDocumentHtmlInput {
  descriptor: DocumentTypeDescriptor;
  instance: {
    id: string;
    status: string;
    data: Record<string, unknown>;
    createdAt: Date;
    /** See DocumentInstance's own schema comment and numbering/ — absent/null before the type's own
     *  `numbering.onEnterStatus` is first reached, or for a type that never declares `numbering` at
     *  all (e.g. "expense", "credit-note" — see their own descriptors). Optional so every existing
     *  caller/fixture that never mentions numbering keeps compiling unchanged. */
    displayNumber?: string | null;
    /** Portugal's ATCUD (`ATCUD:CodigodeValidação-NumeroSequencial`, Portaria n.º 195/2020, art. 4.º
     *  n.º 1) — frozen onto the instance the same moment `displayNumber` is (`actions/
     *  atcud-issuance.ts`). Absent/null for every document that is not a numbered Portuguese invoice.
     *  Printed once here, near the document number, for anyone reading this HTML directly; the "on
     *  EVERY page" legal requirement (art. 4.º n.º 3) is instead satisfied by a REPEATING PDF footer —
     *  see `render-pdf.ts#RenderPdfOptions.footerText` and `render-instance-pdf.ts`, which is the only
     *  caller that ever fills this same string into both places. */
    atcud?: string | null;
  };
  company: {
    name: string;
    address?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
  referenceLabels: Record<string, string>;
  totals?: DocumentTotals;
  /**
   * The mentions to print in their OWN footer block, resolved by the caller (`render-instance-pdf.ts`'s
   * `legalMentionsFor`, gated on `descriptor.usesLegalMentions`): the country-mandated ones (from the
   * seller's country and this instance's own issue date) FOLLOWED by the tax engine's own
   * `__crossBorderMentions` sidecar, when this instance has one (a cross-border invoice, or a domestic
   * invoice from a seller under a non-STANDARD tax scheme — see that function's own comment). Absent
   * or empty prints NO block at all — not an empty framed section, nothing (see this file's
   * own `renderDocumentHtml`) — so a country with no mentions, or a document type that never opts
   * in, produces byte-for-byte the same HTML this function always produced.
   *
   * Deliberately a SEPARATE parameter from the descriptor's own `fields` loop below, never folded
   * into the document's user-editable `notes` field: mixing the two would let a user delete or edit
   * a mention whose absence is an administrative offence — this is a fact about a JURISDICTION, not
   * about this one document instance.
   */
  legalMentions?: RenderableLegalMention[];
  /**
   * "QR SEPA / GiroCode" — the pre-rendered EPC069-12 QR bitmap (already a
   * `data:image/png;base64,...` URI, from `sepa-qr.ts#renderSepaQrDataUri`) to print near the totals,
   * so the payer can scan it straight from the PDF. A TOP-LEVEL input, deliberately not folded into
   * `company` above: unlike the company's own address, this is not a fact ABOUT the company, it is the
   * outcome of gating THIS document instance's own currency/amount/type (see `render-instance-pdf.ts`'s
   * `sepaPaymentQrFor`, the only caller that ever fills this in). Absent prints NO block at all — same
   * "nothing, not an empty frame" discipline `legalMentions` above already holds — so a document with
   * no IBAN on file, a non-EUR currency, a zero/negative total, or a type that never opts in
   * (`descriptor.usesPaymentQr`) renders byte-for-byte the same HTML this function always produced.
   */
  paymentQr?: { dataUri: string };
  /**
   * "Payment methods" — every ENABLED payment method's own presentation
   * (payment-methods/persistence.ts#resolveEnabledPaymentMethodPresentations, gated by the caller on
   * `descriptor.usesPaymentMethods` — see that flag's own header in descriptors/types.ts). A TOP-LEVEL
   * input, the same reasoning `paymentQr` right above already gives: this is the outcome of resolving
   * THIS company's own configuration against THIS document's own amount/currency, not a fact about the
   * company header block. Absent OR EMPTY prints NO block at all — the same "nothing, not an empty
   * frame" discipline `paymentQr`/`legalMentions` already hold, so a company with no method enabled
   * yet, or a document type that never opts in, renders byte-for-byte the same HTML this function
   * always produced.
   */
  paymentMethods?: PaymentMethodPresentation[];
  /**
   * TODO_FEATURES.md rank 15 ("champs personnalisés") — the company's OWN custom fields that
   * actually carry a value on THIS instance, resolved by the caller
   * (`render-instance-pdf.ts#companyCustomFieldsFor`) from `company-custom-fields/`. Deliberately its
   * OWN top-level block, never merged into the ordinary `descriptor.fields` loop above: the feature's
   * own spec calls for a single "additional fields" section at the END of the document, not scattered
   * insertions among the type's native fields — the same "a dedicated block, not a free insertion"
   * decision `legalMentions` already models for a different, country-mandated concern. Absent or
   * empty prints NO block at all — the same "nothing, not an empty frame" discipline every other
   * optional block on this page already holds, so a document whose company has defined no custom
   * field (or filled none in) renders byte-for-byte the same HTML it always did.
   *
   * Carries the RAW descriptor + value pair (not a pre-formatted string): the block below runs each
   * one through this file's own `renderFieldValue`, the exact same per-KIND formatter (money/date/
   * boolean/select, …) the main fields loop above already uses, rather than a second, divergent
   * formatting path the caller (`render-instance-pdf.ts#companyCustomFieldsFor`) would have to keep
   * in sync with this one by hand.
   */
  customFields?: { field: DocumentFieldDescriptor; value: unknown }[];
  /**
   * TODO_FEATURES.md rank 14 ("langue du document par destinataire") — which language this render's
   * OWN chrome vocabulary (`language/pdf-chrome-strings.ts`: "Status", "Totals", "VAT … on …", …) is
   * printed in. Resolved by the caller (`render-instance-pdf.ts`, from the document's own client and
   * the company's default — see `language/resolve-recipient-language.ts`), never guessed here.
   *
   * Absent defaults to `DEFAULT_RENDER_LANGUAGE` ('en') rather than being required: every pre-existing
   * caller of this function (dozens of specs, plus any third-party code built against this signature
   * before this feature existed) keeps producing byte-for-byte the same English chrome it always did,
   * without having to learn about a language it never asked for. This does NOT extend to
   * `descriptor.label`/`field.label`/`option.label` — those stay exactly what the descriptor wrote,
   * whatever language that is (see `descriptors/types.ts`'s own comment on `label`: "plain data, not
   * an i18n key").
   */
  language?: RenderLanguage;
}

/**
 * Pure function: renders a document as self-contained HTML with inline styles.
 * Never relies on external CSS or fonts — everything is inline.
 */
export function renderDocumentHtml(input: RenderDocumentHtmlInput): string {
  const { descriptor, instance, company, referenceLabels } = input;
  const strings = pdfChromeStrings(input.language ?? DEFAULT_RENDER_LANGUAGE);

  const createdDate = new Date(instance.createdAt).toISOString().split('T')[0];

  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtmlSafe(descriptor.label)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background: white;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
    }
    .header {
      border-bottom: 2px solid #007bff;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .company-info {
      margin-bottom: 16px;
    }
    .company-name {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .company-address {
      font-size: 13px;
      color: #666;
    }
    .document-title {
      font-size: 24px;
      font-weight: bold;
      margin: 16px 0 8px 0;
    }
    .document-number {
      font-size: 15px;
      color: #555;
      margin-bottom: 8px;
    }
    .document-atcud {
      font-size: 12px;
      color: #555;
      margin-bottom: 8px;
      font-family: monospace;
    }
    .document-meta {
      display: flex;
      gap: 32px;
      font-size: 13px;
      color: #666;
      margin-top: 12px;
    }
    .field-row {
      margin-bottom: 20px;
      padding: 12px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .field-label {
      font-weight: bold;
      font-size: 13px;
      color: #007bff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .field-value {
      font-size: 14px;
      color: #333;
      word-break: break-word;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-top: 8px;
    }
    thead tr {
      background: #f0f0f0;
      border-bottom: 2px solid #ddd;
    }
    th {
      padding: 8px;
      text-align: left;
      font-weight: bold;
      font-size: 12px;
    }
    tbody tr {
      border-bottom: 1px solid #eee;
    }
    td {
      padding: 8px;
      font-size: 13px;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: monospace;
      font-size: 12px;
      background: #f5f5f5;
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
    }
    ul {
      margin: 8px 0 8px 20px;
    }
    li {
      margin-bottom: 4px;
    }
    .totals-section {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #ddd;
    }
    .totals-label {
      font-weight: bold;
      font-size: 13px;
      color: #007bff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      font-size: 14px;
      border-bottom: 1px solid #eee;
    }
    .totals-row.summary {
      font-weight: bold;
      border-bottom: 2px solid #333;
      margin-top: 8px;
      padding-top: 12px;
    }
    .totals-amount {
      text-align: right;
      min-width: 120px;
    }
    .warnings-section {
      margin-top: 16px;
      padding: 8px;
      background: #fff9f0;
      border-left: 3px solid #ff9800;
      border-radius: 2px;
    }
    .warning-item {
      font-size: 11px;
      color: #e65100;
      margin-bottom: 4px;
    }
    .legal-mentions {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #ddd;
    }
    .legal-mention-item {
      font-size: 11px;
      color: #555;
      margin-bottom: 4px;
    }
    .custom-fields-section {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #ddd;
    }
    .custom-fields-heading {
      font-weight: bold;
      font-size: 13px;
      color: #007bff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .custom-field-item {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      font-size: 13px;
      padding: 4px 0;
    }
    .custom-field-label {
      color: #666;
    }
    .payment-qr-section {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-top: 16px;
      padding: 12px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .payment-qr-image {
      width: 130px;
      height: 130px;
    }
    .payment-qr-label {
      font-size: 12px;
      color: #555;
    }
    .payment-methods-section {
      margin-top: 16px;
      padding: 12px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .payment-methods-heading {
      font-size: 12px;
      font-weight: bold;
      color: #333;
      margin-bottom: 8px;
    }
    .payment-method-item {
      margin-bottom: 8px;
    }
    .payment-method-item:last-child {
      margin-bottom: 0;
    }
    .payment-method-label {
      font-size: 12px;
      font-weight: bold;
      color: #333;
    }
    .payment-method-line {
      font-size: 11px;
      color: #555;
    }
    .payment-method-link {
      font-size: 11px;
      color: #1a5fb4;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="company-info">
        <div class="company-name">${escapeHtmlSafe(company.name)}</div>
        <div class="company-address">
          ${company.address ? escapeHtmlSafe(company.address) : ''}
          ${company.postalCode ? escapeHtmlSafe(company.postalCode) : ''}
          ${company.city ? escapeHtmlSafe(company.city) : ''}
          ${company.country ? escapeHtmlSafe(company.country) : ''}
        </div>
      </div>
      <div class="document-title">${escapeHtmlSafe(descriptor.label)}</div>
      ${
        descriptor.numbering
          ? `<div class="document-number">${escapeHtmlSafe(instance.displayNumber ?? strings.draftNoNumberYet)}</div>`
          : ''
      }
      ${instance.atcud ? `<div class="document-atcud">${escapeHtmlSafe(instance.atcud)}</div>` : ''}
      <div class="document-meta">
        <div><strong>${escapeHtmlSafe(strings.status)}:</strong> ${escapeHtmlSafe(instance.status)}</div>
        <div><strong>${escapeHtmlSafe(strings.date)}:</strong> ${escapeHtmlSafe(createdDate)}</div>
      </div>
    </div>
`;

  // Render each field
  for (const field of descriptor.fields) {
    // 'hiddenReference' is not merely `hideWhenEmpty` — it never gets a row
    // AT ALL, set or not (see types.ts's own `entity` doc comment for why a dedicated kind, not a
    // flag, was chosen). No top-level field is one today (only a line's own `articleId` is), but this
    // guard holds the SAME "never printed" contract if one ever is, exactly like the 'array' case's
    // own subfield filter just above holds it for a nested row.
    if (field.kind === 'hiddenReference') {
      continue;
    }

    const value = instance.data[field.key];

    // See `DocumentFieldDescriptor.hideWhenEmpty`'s own header (types.ts) — an opt-in escape from the
    // otherwise-universal "every field gets a row, even an empty one shows a '—' placeholder" rule
    // right below. Checked with the SAME emptiness test `validate.ts#isMissing` uses for required-ness
    // (undefined/null/'' — a 0 or `false` value is NOT empty), so a field that legitimately holds a
    // falsy value is never hidden by mistake.
    if (field.hideWhenEmpty && (value === undefined || value === null || value === '')) {
      continue;
    }

    const renderedValue = renderFieldValue(field, value, referenceLabels, instance.data, strings);

    html += `
    <div class="field-row">
      <div class="field-label">${escapeHtmlSafe(field.label)}</div>
      <div class="field-value">${renderedValue}</div>
    </div>
`;
  }

  // Render totals section if provided
  if (input.totals) {
    const { totals } = input;
    const currency = totals.currency || '—';
    const decimals = decimalsFor(currency);

    html += `
    <div class="totals-section">
      <div class="totals-label">${escapeHtmlSafe(strings.totals)}</div>
`;

    // Net amount
    const netDisplay = `${fromMinor(totals.netMinor, currency).toFixed(decimals)} ${currency}`;
    html += `
      <div class="totals-row">
        <span>${escapeHtmlSafe(strings.net)}</span>
        <span class="totals-amount">${escapeHtmlSafe(netDisplay)}</span>
      </div>
`;

    // VAT breakdown (one row per rate)
    for (const entry of totals.vatBreakdown) {
      const baseDisplay = `${fromMinor(entry.baseMinor, currency).toFixed(decimals)} ${currency}`;
      const vatDisplay = `${fromMinor(entry.vatMinor, currency).toFixed(decimals)} ${currency}`;
      html += `
      <div class="totals-row">
        <span>${escapeHtmlSafe(strings.vatOn(entry.ratePercent.toString(), baseDisplay))}</span>
        <span class="totals-amount">${escapeHtmlSafe(vatDisplay)}</span>
      </div>
`;
    }

    // Gross total
    const grossDisplay = `${fromMinor(totals.grossMinor, currency).toFixed(decimals)} ${currency}`;
    html += `
      <div class="totals-row summary">
        <span>${escapeHtmlSafe(strings.total)}</span>
        <span class="totals-amount">${escapeHtmlSafe(grossDisplay)}</span>
      </div>
`;

    // Warnings (if any)
    if (totals.warnings.length > 0) {
      html += `
      <div class="warnings-section">
`;
      for (const warning of totals.warnings) {
        html += `        <div class="warning-item">${escapeHtmlSafe(warning)}</div>\n`;
      }
      html += `      </div>\n`;
    }

    html += `
    </div>
`;
  }

  // "QR SEPA / GiroCode" — sits right after the totals block it pays, before
  // the legal mentions footer. Absent (no IBAN on file, non-EUR currency, a zero/negative total, or a
  // type that never opts in — see `paymentQr`'s own header above) prints NOTHING here, not an empty
  // frame, same rule `legalMentions` right below already holds.
  if (input.paymentQr) {
    html += `
    <div class="payment-qr-section">
      <img class="payment-qr-image" src="${input.paymentQr.dataUri}" alt="SEPA payment QR code" width="130" height="130">
      <div class="payment-qr-label">${escapeHtmlSafe(strings.scanToPaySepa)}</div>
    </div>
`;
  }

  // "Payment methods" — see `paymentMethods`'s own header above. Prints NOTHING
  // when the array is absent or empty (no method enabled, or a type that never opts in) — same rule
  // `paymentQr` right above already holds.
  if (input.paymentMethods && input.paymentMethods.length > 0) {
    html += `
    <div class="payment-methods-section">
      <div class="payment-methods-heading">${escapeHtmlSafe(strings.paymentMethodsHeading)}</div>
`;
    for (const method of input.paymentMethods) {
      html += `
      <div class="payment-method-item">
        <div class="payment-method-label">${escapeHtmlSafe(method.label)}</div>
`;
      for (const line of method.lines) {
        html += `        <div class="payment-method-line">${escapeHtmlSafe(line)}</div>\n`;
      }
      if (method.link) {
        html += `        <div class="payment-method-link">${escapeHtmlSafe(method.link)}</div>\n`;
      }
      html += `      </div>\n`;
    }
    html += `    </div>\n`;
  }

  // Mandatory mentions get their OWN footer block, never mixed into the fields
  // loop above (see this parameter's own doc comment on `RenderDocumentHtmlInput.legalMentions`). A
  // country with no mentions, or a document type that never opts in, gets NOTHING here — not an
  // empty framed section, no `<div class="legal-mentions">` at all.
  if (input.legalMentions && input.legalMentions.length > 0) {
    html += `
    <div class="legal-mentions">
`;
    for (const mention of input.legalMentions) {
      html += `      <div class="legal-mention-item">${escapeHtmlSafe(mention.text)}</div>\n`;
    }
    html += `    </div>\n`;
  }

  // TODO_FEATURES.md rank 15 ("champs personnalisés") — the company's own custom fields, LAST on the
  // page (after the legal mentions footer): see `RenderDocumentHtmlInput.customFields`'s own header
  // for why this is a dedicated, end-of-document block rather than an insertion into the ordinary
  // fields loop above. Absent or empty prints NOTHING here — same "nothing, not an empty frame"
  // discipline every other optional block on this page already holds.
  if (input.customFields && input.customFields.length > 0) {
    html += `
    <div class="custom-fields-section">
      <div class="custom-fields-heading">${escapeHtmlSafe(strings.customFieldsHeading)}</div>
`;
    for (const entry of input.customFields) {
      const renderedValue = renderFieldValue(
        entry.field,
        entry.value,
        referenceLabels,
        instance.data,
        strings,
      );
      html += `
      <div class="custom-field-item">
        <span class="custom-field-label">${escapeHtmlSafe(entry.field.label)}</span>
        <span>${renderedValue}</span>
      </div>
`;
    }
    html += `    </div>\n`;
  }

  html += `
  </div>
</body>
</html>
`;

  return html;
}
