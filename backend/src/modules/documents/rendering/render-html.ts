import { CoreFieldKind } from '../descriptors/types';
import { DocumentTypeDescriptor, DocumentFieldDescriptor } from '../descriptors/types';
import { decimalsFor, fromMinor } from '@/utils/financial';
import type { DocumentTotals } from '../totals/compute-totals';

/**
 * Escapes HTML special characters — applied to ALL values from data to prevent injection.
 */
function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

// Fallback for Node.js environment where document doesn't exist
function escapeHtmlNode(value: string): string {
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
      return value ? 'Yes' : 'No';
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
      const subFields = field.fields ?? [];
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
          const cellValue = renderFieldValue(subField, row[subField.key], referenceLabels, row);
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
}

/**
 * Pure function: renders a document as self-contained HTML with inline styles.
 * Never relies on external CSS or fonts — everything is inline.
 */
export function renderDocumentHtml(input: RenderDocumentHtmlInput): string {
  const { descriptor, instance, company, referenceLabels } = input;

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
          ? `<div class="document-number">${escapeHtmlSafe(instance.displayNumber ?? 'Draft — no number yet')}</div>`
          : ''
      }
      <div class="document-meta">
        <div><strong>Status:</strong> ${escapeHtmlSafe(instance.status)}</div>
        <div><strong>Date:</strong> ${escapeHtmlSafe(createdDate)}</div>
      </div>
    </div>
`;

  // Render each field
  for (const field of descriptor.fields) {
    const value = instance.data[field.key];
    const renderedValue = renderFieldValue(field, value, referenceLabels, instance.data);

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
      <div class="totals-label">Totals</div>
`;

    // Net amount
    const netDisplay = `${fromMinor(totals.netMinor, currency).toFixed(decimals)} ${currency}`;
    html += `
      <div class="totals-row">
        <span>Net</span>
        <span class="totals-amount">${escapeHtmlSafe(netDisplay)}</span>
      </div>
`;

    // VAT breakdown (one row per rate)
    for (const entry of totals.vatBreakdown) {
      const baseDisplay = `${fromMinor(entry.baseMinor, currency).toFixed(decimals)} ${currency}`;
      const vatDisplay = `${fromMinor(entry.vatMinor, currency).toFixed(decimals)} ${currency}`;
      html += `
      <div class="totals-row">
        <span>VAT ${escapeHtmlSafe(entry.ratePercent.toString())}% on ${escapeHtmlSafe(baseDisplay)}</span>
        <span class="totals-amount">${escapeHtmlSafe(vatDisplay)}</span>
      </div>
`;
    }

    // Gross total
    const grossDisplay = `${fromMinor(totals.grossMinor, currency).toFixed(decimals)} ${currency}`;
    html += `
      <div class="totals-row summary">
        <span>Total</span>
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

  html += `
  </div>
</body>
</html>
`;

  return html;
}
