/**
 * `legalMentionsFor` and `sepaPaymentQrFor` are the two
 * pieces of `render-instance-pdf.ts` that need neither Prisma nor Puppeteer to exercise — everything
 * else in that file needs both (see this file's own header for why no broader spec exists here today).
 * `legalMentionsFor` is proven directly, against the REAL shipped `data/fr.json`, the same discipline
 * `mentions/invoice-notes.spec.ts` already holds for the resolver itself — including the
 * `__crossBorderMentions` sidecar it now also merges in (2026-09-13), proven with a plain literal
 * (`tax/resolve-invoice-tax.spec.ts`/`tax/load-and-resolve.spec.ts` already prove the ENGINE actually
 * produces one of these for a real cross-border or exempt-seller invoice; this file's own job is only
 * "does the PDF's footer merge whatever sidecar it is handed", not re-proving the engine).
 * `sepaPaymentQrFor` is proven
 * the same way, against the REAL `sepa-qr.ts` (already exhaustively unit-tested on its own in
 * `sepa-qr.spec.ts`) — this file only proves the GATING for each (which flag, which company/document
 * fact must hold before either one produces anything), never the underlying resolution/encoding logic
 * a second time.
 */
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentTotals } from '../totals/compute-totals';
import { legalMentionsFor, sepaPaymentQrFor } from './render-instance-pdf';

const invoiceDescriptor: DocumentTypeDescriptor = {
  id: 'invoice',
  label: 'Invoice',
  fields: [],
  actions: [],
  usesLegalMentions: true,
};

const plainDescriptor: DocumentTypeDescriptor = {
  id: 'expense',
  label: 'Expense',
  fields: [],
  actions: [],
};

describe('legalMentionsFor', () => {
  it('a French company printing an invoice gets the three mentions, frozen at the document’s own issue date', () => {
    const mentions = legalMentionsFor(invoiceDescriptor, 'France', { issueDate: '2026-06-30' });
    expect(mentions.map((m) => m.subjectCode)).toEqual(['PMT', 'PMD', 'AAB']);
    expect(mentions.find((m) => m.subjectCode === 'PMD')?.text).toContain('12,15 %');
  });

  it('the same company, an invoice issued after 1 July, prints the second-half rate — the freeze is per-document, not per-render', () => {
    const mentions = legalMentionsFor(invoiceDescriptor, 'France', { issueDate: '2026-07-02' });
    expect(mentions.find((m) => m.subjectCode === 'PMD')?.text).toContain('12,40 %');
  });

  it('a document type that does not declare usesLegalMentions gets none, whatever its data says', () => {
    expect(legalMentionsFor(plainDescriptor, 'France', { issueDate: '2026-08-30' })).toEqual([]);
  });

  it('a country with no mentions file gets none — no invented mandate for Germany', () => {
    expect(legalMentionsFor(invoiceDescriptor, 'Germany', { issueDate: '2026-08-30' })).toEqual([]);
  });

  it('a company with no resolvable country gets none — never a guessed jurisdiction', () => {
    expect(legalMentionsFor(invoiceDescriptor, null, { issueDate: '2026-08-30' })).toEqual([]);
    expect(legalMentionsFor(invoiceDescriptor, 'Nowhereland', { issueDate: '2026-08-30' })).toEqual([]);
  });

  it('a missing or unparsable issueDate gets none — never a guessed "today"', () => {
    expect(legalMentionsFor(invoiceDescriptor, 'France', {})).toEqual([]);
    expect(legalMentionsFor(invoiceDescriptor, 'France', { issueDate: 'not-a-date' })).toEqual([]);
  });

  // The PDF's own footer used to show NOTHING from `__crossBorderMentions` — only the downloaded
  // EN 16931 XML did (`formats/shared-build.ts`'s own `extractCrossBorderMentions`, reused here
  // rather than re-filtered). Fixed 2026-09-13 alongside the VAT-exemption checkbox: a mailed PDF is
  // the common case, not everyone downloads the XML, so a mention the law requires printed cannot
  // exist in one output and not the other.
  describe('__crossBorderMentions — the tax engine sidecar (cross-border, or a domestic exempt seller)', () => {
    it('APPENDS the sidecar mention after the country-mandated ones, for a French seller', () => {
      const data = {
        issueDate: '2026-06-30',
        __crossBorderMentions: [{ code: 'FR_293B', text: 'TVA non applicable, art. 293 B du CGI' }],
      };
      const mentions = legalMentionsFor(invoiceDescriptor, 'France', data);
      expect(mentions.map((m) => m.subjectCode)).toEqual(['PMT', 'PMD', 'AAB', undefined]);
      expect(mentions[mentions.length - 1]).toEqual({
        text: 'TVA non applicable, art. 293 B du CGI',
        legalRef: 'FR_293B',
      });
    });

    it('still appears for a country with NO country-mandated mentions file at all (Germany)', () => {
      const data = {
        issueDate: '2026-06-30',
        __crossBorderMentions: [{ code: 'FRANCHISE', text: 'VAT exempt — small business scheme' }],
      };
      const mentions = legalMentionsFor(invoiceDescriptor, 'Germany', data);
      expect(mentions).toEqual([{ text: 'VAT exempt — small business scheme', legalRef: 'FRANCHISE' }]);
    });

    it('a document type that does not declare usesLegalMentions still gets none, even with a sidecar present', () => {
      const data = {
        issueDate: '2026-06-30',
        __crossBorderMentions: [{ code: 'FR_293B', text: 'TVA non applicable, art. 293 B du CGI' }],
      };
      expect(legalMentionsFor(plainDescriptor, 'France', data)).toEqual([]);
    });

    it('an absent, malformed, or empty sidecar changes nothing — same three FR mentions as before this fix', () => {
      const base = { issueDate: '2026-06-30' };
      const withoutSidecar = legalMentionsFor(invoiceDescriptor, 'France', base);
      const withEmptySidecar = legalMentionsFor(invoiceDescriptor, 'France', {
        ...base,
        __crossBorderMentions: [],
      });
      const withMalformedSidecar = legalMentionsFor(invoiceDescriptor, 'France', {
        ...base,
        __crossBorderMentions: 'not-an-array',
      });
      expect(withoutSidecar).toHaveLength(3);
      expect(withEmptySidecar).toEqual(withoutSidecar);
      expect(withMalformedSidecar).toEqual(withoutSidecar);
    });
  });
});

describe('sepaPaymentQrFor', () => {
  const paymentQrDescriptor: DocumentTypeDescriptor = {
    id: 'invoice',
    label: 'Invoice',
    fields: [],
    actions: [],
    usesPaymentQr: true,
  };

  // Same shape "quote"/"credit-note"/"expense" descriptors actually ship with — `usesPaymentQr` absent.
  const nonOptedInDescriptor: DocumentTypeDescriptor = {
    id: 'quote',
    label: 'Quote',
    fields: [],
    actions: [],
  };

  const company = { name: 'Acme Corp', iban: 'FR1420041010050500013M02606' };

  const positiveEurTotals: DocumentTotals = {
    currency: 'EUR',
    lines: [],
    netMinor: 10000,
    vatMinor: 2000,
    grossMinor: 12000,
    vatBreakdown: [],
    warnings: [],
  };

  it('resolves a QR when the type opts in, the company has an IBAN, the data currency is EUR and the total is positive', async () => {
    const result = await sepaPaymentQrFor(
      paymentQrDescriptor,
      company,
      positiveEurTotals,
      { currency: 'EUR' },
      'INV-2026-0001',
    );

    expect(result).toBeDefined();
    expect(result?.dataUri.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('resolves undefined when the company has no IBAN on file', async () => {
    const result = await sepaPaymentQrFor(
      paymentQrDescriptor,
      { name: 'Acme Corp', iban: null },
      positiveEurTotals,
      { currency: 'EUR' },
      null,
    );

    expect(result).toBeUndefined();
  });

  it('resolves undefined when the document currency is not EUR', async () => {
    const result = await sepaPaymentQrFor(
      paymentQrDescriptor,
      company,
      { ...positiveEurTotals, currency: 'USD' },
      { currency: 'USD' },
      null,
    );

    expect(result).toBeUndefined();
  });

  it('resolves undefined when the descriptor never declares `usesPaymentQr`', async () => {
    const result = await sepaPaymentQrFor(
      nonOptedInDescriptor,
      company,
      positiveEurTotals,
      { currency: 'EUR' },
      null,
    );

    expect(result).toBeUndefined();
  });

  it('resolves undefined when the total is zero — nothing to collect', async () => {
    const result = await sepaPaymentQrFor(
      paymentQrDescriptor,
      company,
      { ...positiveEurTotals, grossMinor: 0 },
      { currency: 'EUR' },
      null,
    );

    expect(result).toBeUndefined();
  });
});
