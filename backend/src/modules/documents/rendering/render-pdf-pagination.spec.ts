import { vi } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { computeDocumentTotals } from '../totals/compute-totals';
import { renderDocumentHtml, RenderDocumentHtmlInput } from './render-html';
import { renderPdf } from './render-pdf';
import { buildEpcPayload, renderSepaQrDataUri } from './sepa-qr';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { log: { create: vi.fn().mockResolvedValue({}) } },
}));

vi.setConfig({ testTimeout: 30_000 });

const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="64"><rect width="240" height="64" fill="#334"/></svg>';
const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

const LEGAL_MENTIONS = [
  'Payment due within 30 days of the invoice date. No discount is granted for early payment.',
  'Late payment penalties: three times the statutory interest rate, applicable from the day after the due date.',
  'A fixed indemnity of 40 EUR for recovery costs is due on any late payment, in addition to late penalties.',
  'VAT is charged on the basis of receipts.',
].map((text) => ({ text, legalRef: 'fixture' }));

const PAYMENT_METHODS = [
  {
    id: 'bank-transfer',
    label: 'Bank transfer',
    lines: ['IBAN: DE89 3704 0044 0532 0130 00', 'BIC: COBADEFFXXX'],
  },
];

/** Two markers per line, at both ends of a description long enough to wrap inside its cell: a row cut
 *  by a page break puts them on different pages. */
function lineDescription(index: number): string {
  const n = String(index).padStart(2, '0');
  return `L${n}start Consulting services, workshop preparation and follow-up report L${n}end`;
}

function lines(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    description: lineDescription(i + 1),
    quantity: 2,
    unit: 'HUR',
    unitPrice: 450,
    vatRate: '20',
  }));
}

async function documentInput(
  descriptor: DocumentTypeDescriptor,
  data: Record<string, unknown>,
): Promise<RenderDocumentHtmlInput> {
  const totals = computeDocumentTotals(descriptor, data);
  const payload = buildEpcPayload({
    beneficiaryName: 'Atelier Numérique SARL',
    iban: 'DE89370400440532013000',
    amountMinor: totals.grossMinor,
    currency: 'EUR',
    remittance: 'INV-2026-0042',
  });
  return {
    descriptor,
    instance: {
      id: 'doc-1',
      status: 'sent',
      data,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      displayNumber: 'INV-2026-0042',
    },
    company: {
      name: 'Atelier Numérique SARL',
      address: '12 rue des Lilas',
      postalCode: '69003',
      city: 'Lyon',
      country: 'France',
    },
    recipient: {
      fieldKey: 'client',
      name: 'Globex Industries GmbH',
      address: 'Friedrichstrasse 123',
      postalCode: '10117',
      city: 'Berlin',
      country: 'Germany',
    },
    referenceLabels: { client: 'Globex Industries GmbH' },
    totals,
    legalMentions: LEGAL_MENTIONS,
    paymentQr: payload ? { dataUri: await renderSepaQrDataUri(payload) } : undefined,
    paymentMethods: PAYMENT_METHODS,
    branding: { logoDataUri: LOGO_DATA_URI },
  };
}

function invoiceData(lineCount: number): Record<string, unknown> {
  return {
    client: 'client-1',
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    currency: 'EUR',
    notes: 'Thank you for your trust.\nPlease quote the invoice number with your payment.',
    clientReference: 'PO-7781',
    lines: lines(lineCount),
  };
}

/** One string per page, the text items of that page joined. */
async function pagesText(pdf: Buffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(pdf), isEvalSupported: false });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await task.destroy();
  return pages;
}

function pageOf(pages: string[], needle: string): number {
  const found = pages.flatMap((text, index) => (text.includes(needle) ? [index] : []));
  expect(found, `"${needle}" should appear on exactly one page`).toHaveLength(1);
  return found[0];
}

function expectTotalsWithLastLine(pages: string[], input: RenderDocumentHtmlInput, lineCount: number): void {
  expect(pages.length).toBeGreaterThan(1);
  for (let i = 1; i <= lineCount; i++) {
    const n = String(i).padStart(2, '0');
    expect(pageOf(pages, `L${n}start`), `line ${n}`).toBe(pageOf(pages, `L${n}end`));
  }
  const lastLinePage = pageOf(pages, `L${String(lineCount).padStart(2, '0')}end`);
  const gross = `${(input.totals!.grossMinor / 100).toFixed(2)} EUR`;
  expect(pageOf(pages, gross)).toBe(lastLinePage);
  expect(pageOf(pages, 'Net')).toBe(lastLinePage);
}

async function renderPages(input: RenderDocumentHtmlInput): Promise<string[]> {
  return pagesText(await renderPdf(renderDocumentHtml(input)));
}

// A developer machine may have no Chromium at all; CI always does, so it never skips there.
let rendererAvailable = true;
// A full render, not just a browser launch: on a hosted runner the first page after launch costs seconds.
beforeAll(async () => {
  const startedAt = Date.now();
  try {
    await renderPages(await documentInput(buildInvoiceDescriptor(), invoiceData(1)));
  } catch (error) {
    if (process.env.CI || !String(error).includes('PDF renderer unavailable')) throw error;
    rendererAvailable = false;
  }
  process.stderr.write(`[render-pdf-pagination] PDF pipeline warm-up took ${Date.now() - startedAt}ms\n`);
}, 180_000);

describe('PDF pagination', () => {
  beforeEach((context) => {
    if (!rendererAvailable) context.skip();
  });

  it.each([
    ['invoice', buildInvoiceDescriptor(), invoiceData(1)],
    ['quote', buildQuoteDescriptor(), invoiceData(1)],
    [
      'credit note',
      buildCreditNoteDescriptor(),
      {
        issueDate: '2026-10-01',
        currency: 'EUR',
        reason: 'Duplicate billing of the workshop.',
        lines: lines(1),
      },
    ],
  ])('fits a one-line %s on a single page', async (_label, descriptor, data) => {
    const pages = await renderPages(await documentInput(descriptor, data));

    expect(pages).toHaveLength(1);
  });

  it.each([25, 30, 34, 38, 42, 48])(
    'never separates the totals from the last of %i lines, nor cuts a line in half',
    async (lineCount) => {
      const input = await documentInput(buildInvoiceDescriptor(), invoiceData(lineCount));
      const pages = await renderPages(input);

      expectTotalsWithLastLine(pages, input, lineCount);
    },
  );

  it.each(Array.from({ length: 13 }, (_, i) => 24 + i))(
    'keeps the totals of a linked credit note with the last of %i corrected lines',
    async (lineCount) => {
      const invoiceDescriptor = buildInvoiceDescriptor();
      const linesField = invoiceDescriptor.fields.find((field) => field.key === 'lines')!;
      const rows = lines(lineCount);
      const base = await documentInput(buildCreditNoteDescriptor(), {
        invoice: 'invoice-1',
        issueDate: '2026-10-01',
        currency: 'EUR',
        correctedLines: rows.map((_, i) => `row-${i}`),
        lines: [],
      });
      const input: RenderDocumentHtmlInput = {
        ...base,
        totals: computeDocumentTotals(invoiceDescriptor, { currency: 'EUR', lines: rows }),
        correctedInvoice: { displayNumber: 'INV-2026-0042', issueDate: '2026-09-01' },
        resolvedRowSelections: { correctedLines: { field: linesField, rows } },
      };
      const pages = await renderPages(input);

      expectTotalsWithLastLine(pages, input, lineCount);
    },
  );

  it('repeats the line table header on every page the table spans', async () => {
    const pages = await renderPages(await documentInput(buildInvoiceDescriptor(), invoiceData(40)));

    const pagesWithLines = pages.filter((text) => /L\d\dstart/.test(text));
    expect(pagesWithLines.length).toBeGreaterThan(1);
    for (const text of pagesWithLines) {
      expect(text).toContain('Designation');
    }
  });
});
