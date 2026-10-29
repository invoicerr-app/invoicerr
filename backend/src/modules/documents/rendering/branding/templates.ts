/**
 * The document templates a company can pick for its PDFs. A template only changes presentation: it
 * adds one stylesheet over the same markup, so every word, legal mention, table and the Factur-X
 * attachment stay exactly what the classic template prints. `classic` adds nothing at all, byte for
 * byte, which is what keeps every existing rendering snapshot valid.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { logger } from '@/logger/logger.service';

export type DocumentTemplateKey = 'classic' | 'atelier';

export const DOCUMENT_TEMPLATES: readonly { key: DocumentTemplateKey; label: string }[] = [
  { key: 'classic', label: 'Classic' },
  { key: 'atelier', label: 'Atelier' },
];

/** The product default. Migration 20261029070000 moved every pre-existing company to it; new companies start on it too. A null template only remains on an image older than 2026-10-29. */
export const NEW_COMPANY_TEMPLATE: DocumentTemplateKey = 'atelier';

export function isDocumentTemplateKey(value: unknown): value is DocumentTemplateKey {
  return typeof value === 'string' && DOCUMENT_TEMPLATES.some((entry) => entry.key === value);
}

const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT_RANGE =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const TEMPLATE_FONTS = [
  { family: 'InvoicerrTemplateFigtree', dir: 'figtree', weights: [400, 600] },
  { family: 'InvoicerrTemplateNewsreader', dir: 'newsreader', weights: [400, 500] },
] as const;

let templateFontCss: string | null = null;

/** Read once per process: the files never change at runtime. A missing file drops that one face
 *  and the system fallback in the stack takes over, never a failed render. */
function templateFontFaceCss(): string {
  if (templateFontCss !== null) return templateFontCss;
  const rules: string[] = [];
  for (const font of TEMPLATE_FONTS) {
    for (const weight of font.weights) {
      for (const [subset, range] of [
        ['latin', LATIN_RANGE],
        ['latin-ext', LATIN_EXT_RANGE],
      ] as const) {
        const fileName = `${font.dir}-${subset}-${weight}.woff2`;
        try {
          const base64 = readFileSync(join(__dirname, '..', 'fonts', font.dir, fileName)).toString('base64');
          rules.push(
            `@font-face { font-family: "${font.family}"; font-style: normal; font-weight: ${weight}; ` +
              `src: url(data:font/woff2;base64,${base64}) format("woff2"); unicode-range: ${range}; }`,
          );
        } catch (err) {
          logger.warn('Document template font file unreadable, falling back to the system font', {
            category: 'documents',
            details: { fileName, message: err instanceof Error ? err.message : String(err) },
          });
        }
      }
    }
  }
  templateFontCss = rules.join('\n');
  return templateFontCss;
}

const TITLE_STACK = '"InvoicerrTemplateNewsreader", Georgia, "Times New Roman", serif';
const UI_STACK = '"InvoicerrTemplateFigtree", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * The stylesheet a template adds after the classic one, or an empty string for `classic`. The
 * company's accent tints the information band and the totals box; a font the company picked keeps
 * the body text, the template then only sets titles and figures.
 */
export function templateStyleBlock(
  template: string | null | undefined,
  accentColor: string,
  companyFontStack: string | null,
): string {
  if (template !== 'atelier') return '';
  const body = companyFontStack ?? UI_STACK;
  const tint = `color-mix(in srgb, ${accentColor} 9%, white)`;
  return `
  <style data-template-style="atelier">${templateFontFaceCss()}
    body { font-family: ${body}; color: #16242c; font-size: 12.5px; }
    .header { flex-direction: column; border-bottom: none; padding-bottom: 0; margin-bottom: 24px; gap: 18px; }
    .document-heading { margin-left: 0; text-align: left; }
    .document-title { font-family: ${TITLE_STACK}; font-weight: 400; font-size: 44px; line-height: 1; letter-spacing: -0.02em; color: #102330; }
    .document-number { margin-top: 8px; font-size: 13px; color: #4f616c; }
    .document-meta { color: #4f616c; }
    .parties { gap: 40px; margin-bottom: 22px; }
    .company-name { font-size: 14px; font-weight: 600; }
    .company-address, .party-identifiers { color: #4f616c; }
    .field-label, .totals-label, .custom-fields-heading { text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 11px; color: #4f616c; }
    .meta-grid { background: ${tint}; border-radius: 10px; padding: 14px 18px; gap: 10px 20px; margin-bottom: 24px; }
    .meta-grid .field-value { font-weight: 600; }
    thead tr { background: transparent; border-bottom: 1px solid #d9e1e6; }
    th { font-weight: 500; color: #4f616c; font-size: 11px; padding: 8px; }
    tbody tr { border-bottom: 1px solid #e3e9ec; }
    td { padding: 10px 8px; }
    td { font-variant-numeric: tabular-nums; }
    .totals-amount { font-family: ${TITLE_STACK}; font-variant-numeric: tabular-nums lining-nums; font-size: 14px; }
    .totals-section { background: ${tint}; border-radius: 10px; padding: 14px 18px; }
    .totals-row { border-bottom: none; padding: 5px 0; }
    .totals-row.summary { border-top: 1px solid #c9d3d9; border-bottom: none; margin-top: 6px; padding-top: 12px; align-items: baseline; }
    .totals-row.summary .totals-amount { font-size: 26px; font-weight: 500; }
    .payment-qr-section, .payment-methods-section { background: white; border: 1px solid #d9e1e6; border-radius: 10px; padding: 14px 18px; }
    .payment-methods-heading { font-size: 12px; font-weight: 600; }
    .legal-mentions, .custom-fields-section { border-top: 1px solid #e3e9ec; }
    .legal-mention-item { color: #4f616c; }
    .option-group-heading { font-family: ${TITLE_STACK}; font-weight: 500; font-size: 16px; }
    .option-group-heading .accepted-badge { text-transform: none; letter-spacing: 0; }
  </style>`;
}
