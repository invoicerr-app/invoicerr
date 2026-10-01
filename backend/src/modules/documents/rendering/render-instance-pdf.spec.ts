/**
 * `legalMentionsFor` and `sepaPaymentQrFor` are the two
 * pieces of `render-instance-pdf.ts` that need neither Prisma nor Puppeteer to exercise -- everything
 * else in that file needs both (see this file's own header for why no broader spec exists here today).
 * `legalMentionsFor` is proven directly, against the REAL shipped `data/fr.json`, the same discipline
 * `mentions/invoice-notes.spec.ts` already holds for the resolver itself -- including the
 * `__crossBorderMentions` sidecar it now also merges in (2026-09-13), proven with a plain literal
 * (`tax/resolve-invoice-tax.spec.ts`/`tax/load-and-resolve.spec.ts` already prove the ENGINE actually
 * produces one of these for a real cross-border or exempt-seller invoice; this file's own job is only
 * "does the PDF's footer merge whatever sidecar it is handed", not re-proving the engine).
 * `sepaPaymentQrFor` is proven
 * the same way, against the REAL `sepa-qr.ts` (already exhaustively unit-tested on its own in
 * `sepa-qr.spec.ts`) -- this file only proves the GATING for each (which flag, which company/document
 * fact must hold before either one produces anything), never the underlying resolution/encoding logic
 * a second time.
 */
import { vi, type Mock, type MockedFunction } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { resolveDocumentCustomFieldDescriptors } from '../company-custom-fields/persistence';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { resolveEnabledPaymentMethodPresentations } from '../payment-methods/persistence';
import { PaymentMethodPresentation } from '../payment-methods/types';
import { DocumentTotals } from '../totals/compute-totals';
import { renderPdf } from './render-pdf';
import {
  legalMentionsFor,
  paymentMethodsFor,
  renderDocumentInstance,
  sepaPaymentQrFor,
} from './render-instance-pdf';

// The option-groups test below (review point #3) needs the FINAL composed HTML - never launches
// real Chromium: `renderPdf` is mocked so the html string it was called with can be captured, the
// same "capture what the pipeline actually produced, skip the rendering engine itself" split this
// file's own header already draws for legalMentionsFor/sepaPaymentQrFor.
vi.mock('./render-pdf');
const mockedRenderPdf = renderPdf as MockedFunction<typeof renderPdf>;

// `paymentMethodsFor` needs neither Prisma nor Puppeteer EITHER, once its one real dependency
// (`resolveEnabledPaymentMethodPresentations`, which DOES touch Prisma -- see persistence.spec.ts for
// that half's own coverage) is mocked at this boundary: this file's own job is only "does the gating
// (`descriptor.usesPaymentMethods`, the amountMinor>0 guard) forward the right context", the exact
// same split `sepaPaymentQrFor`'s own header already draws for its own underlying mechanism.
vi.mock('../payment-methods/persistence');
const mockedResolvePresentations = resolveEnabledPaymentMethodPresentations as MockedFunction<
  typeof resolveEnabledPaymentMethodPresentations
>;

// Needed ONLY by the dedicated `renderDocumentInstance` describe block further down -- every test
// ABOVE it never reaches these two boundaries at all (`legalMentionsFor`/`sepaPaymentQrFor` are pure
// synchronous helpers, per this file's own header).
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUnique: vi.fn() }, client: { findFirst: vi.fn() } },
}));
vi.mock('../company-custom-fields/persistence');
const mockedResolveCustomFields = resolveDocumentCustomFieldDescriptors as MockedFunction<
  typeof resolveDocumentCustomFieldDescriptors
>;

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

  it('the same company, an invoice issued after 1 July, prints the second-half rate -- the freeze is per-document, not per-render', () => {
    const mentions = legalMentionsFor(invoiceDescriptor, 'France', { issueDate: '2026-07-02' });
    expect(mentions.find((m) => m.subjectCode === 'PMD')?.text).toContain('12,40 %');
  });

  it('a document type that does not declare usesLegalMentions gets none, whatever its data says', () => {
    expect(legalMentionsFor(plainDescriptor, 'France', { issueDate: '2026-08-30' })).toEqual([]);
  });

  it('a country with no mentions file gets none -- no invented mandate for Germany', () => {
    expect(legalMentionsFor(invoiceDescriptor, 'Germany', { issueDate: '2026-08-30' })).toEqual([]);
  });

  it('a company with no resolvable country gets none -- never a guessed jurisdiction', () => {
    expect(legalMentionsFor(invoiceDescriptor, null, { issueDate: '2026-08-30' })).toEqual([]);
    expect(legalMentionsFor(invoiceDescriptor, 'Nowhereland', { issueDate: '2026-08-30' })).toEqual([]);
  });

  it('a missing or unparsable issueDate gets none -- never a guessed "today"', () => {
    expect(legalMentionsFor(invoiceDescriptor, 'France', {})).toEqual([]);
    expect(legalMentionsFor(invoiceDescriptor, 'France', { issueDate: 'not-a-date' })).toEqual([]);
  });

  // ISSUE #519: `lateFeeRate`'s own value table ends 2027-01-01 -- before this fix, both dates below
  // threw `UnresolvedInvoiceNotePlaceholderError` out of `legalMentionsFor` itself (caught by
  // `renderDocumentInstance` below and turned into a 400 -- see that describe block), refusing to send
  // ANY French invoice dated 2027 or later. They now resolve, printing PMD's own statutory rule
  // wording instead of a stale or invented number.
  it('a French invoice dated 2027-01-02 (first half of 2027) still gets all three mentions, PMD falling back to the rule wording', () => {
    const mentions = legalMentionsFor(invoiceDescriptor, 'France', { issueDate: '2027-01-02' });
    expect(mentions.map((m) => m.subjectCode)).toEqual(['PMT', 'PMD', 'AAB']);
    const pmd = mentions.find((m) => m.subjectCode === 'PMD');
    expect(pmd?.text).toContain('Banque centrale européenne');
    expect(pmd?.text).not.toContain('{lateFeeRate}');
  });

  it('a French invoice dated 2027-07-02 (second half of 2027) also falls back -- the gap has not been maintained either half', () => {
    const mentions = legalMentionsFor(invoiceDescriptor, 'France', { issueDate: '2027-07-02' });
    const pmd = mentions.find((m) => m.subjectCode === 'PMD');
    expect(pmd?.text).toContain('Banque centrale européenne');
  });

  // The PDF's own footer used to show NOTHING from `__crossBorderMentions` -- only the downloaded
  // EN 16931 XML did (`formats/shared-build.ts`'s own `extractCrossBorderMentions`, reused here
  // rather than re-filtered). Fixed 2026-09-13 alongside the VAT-exemption checkbox: a mailed PDF is
  // the common case, not everyone downloads the XML, so a mention the law requires printed cannot
  // exist in one output and not the other.
  describe('__crossBorderMentions -- the tax engine sidecar (cross-border, or a domestic exempt seller)', () => {
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
        __crossBorderMentions: [{ code: 'FRANCHISE', text: 'VAT exempt -- small business scheme' }],
      };
      const mentions = legalMentionsFor(invoiceDescriptor, 'Germany', data);
      expect(mentions).toEqual([{ text: 'VAT exempt -- small business scheme', legalRef: 'FRANCHISE' }]);
    });

    it('a document type that does not declare usesLegalMentions still gets none, even with a sidecar present', () => {
      const data = {
        issueDate: '2026-06-30',
        __crossBorderMentions: [{ code: 'FR_293B', text: 'TVA non applicable, art. 293 B du CGI' }],
      };
      expect(legalMentionsFor(plainDescriptor, 'France', data)).toEqual([]);
    });

    it('an absent, malformed, or empty sidecar changes nothing -- same three FR mentions as before this fix', () => {
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

  // Same shape "quote"/"credit-note"/"expense" descriptors actually ship with -- `usesPaymentQr` absent.
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

  it('resolves undefined when the total is zero -- nothing to collect', async () => {
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

describe('paymentMethodsFor', () => {
  // Issue #416 ("payment methods per client") - a real 'client' reference field, the SAME shape
  // `invoice.descriptor.ts` actually declares, so `clientIdFromData` has something to resolve against
  // in the tests below that care about it. The pre-existing tests in this block (which pass data with
  // no 'client' key) are unaffected - `clientIdFromData` simply resolves to `undefined` for them, same
  // as it always implicitly did before this field existed on the fixture.
  const paymentMethodsDescriptor: DocumentTypeDescriptor = {
    id: 'invoice',
    label: 'Invoice',
    fields: [{ key: 'client', kind: 'reference', label: 'Client', entity: 'client' }],
    actions: [],
    usesPaymentMethods: true,
  };

  const nonOptedInDescriptor: DocumentTypeDescriptor = {
    id: 'quote',
    label: 'Quote',
    fields: [],
    actions: [],
  };

  const positiveEurTotals: DocumentTotals = {
    currency: 'EUR',
    lines: [],
    netMinor: 10000,
    vatMinor: 2000,
    grossMinor: 12000,
    vatBreakdown: [],
    warnings: [],
  };

  const somePresentations: PaymentMethodPresentation[] = [{ id: 'cash', label: 'Cash', lines: [] }];

  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolvePresentations.mockResolvedValue(somePresentations);
  });

  it('never calls the resolver at all when the type does not opt in -- the exact same gate usesPaymentQr holds', async () => {
    const result = await paymentMethodsFor(nonOptedInDescriptor, 'company-1', positiveEurTotals, {}, null);
    expect(result).toEqual([]);
    expect(mockedResolvePresentations).not.toHaveBeenCalled();
  });

  it('forwards the document’s own currency, a POSITIVE amount, and the display number as the reference', async () => {
    const result = await paymentMethodsFor(
      paymentMethodsDescriptor,
      'company-1',
      positiveEurTotals,
      { currency: 'EUR' },
      'INV-2026-0001',
    );

    expect(result).toBe(somePresentations);
    expect(mockedResolvePresentations).toHaveBeenCalledWith(
      'company-1',
      { amountMinor: 12000, currency: 'EUR', reference: 'INV-2026-0001' },
      undefined, // no 'client' value on this document's own `data`
    );
  });

  it('omits `amountMinor` for a zero/negative total -- never hands a method a nonsensical amount', async () => {
    await paymentMethodsFor(
      paymentMethodsDescriptor,
      'company-1',
      { ...positiveEurTotals, grossMinor: 0 },
      { currency: 'EUR' },
      null,
    );

    expect(mockedResolvePresentations).toHaveBeenCalledWith(
      'company-1',
      { amountMinor: undefined, currency: 'EUR', reference: undefined },
      undefined,
    );
  });

  it('omits `currency` when the document data carries none', async () => {
    await paymentMethodsFor(paymentMethodsDescriptor, 'company-1', positiveEurTotals, {}, null);

    expect(mockedResolvePresentations).toHaveBeenCalledWith(
      'company-1',
      { amountMinor: 12000, currency: undefined, reference: undefined },
      undefined,
    );
  });

  // Issue #416 ("payment methods per client") - the whole point of threading a client id through at
  // all: a document naming one must have it reach the resolver, so a client-scoped restriction (proven
  // in persistence.spec.ts) actually gets applied to THIS document's own render.
  describe('issue #416 - forwards the document’s own client id', () => {
    it('reads the id straight off the descriptor’s own "client" reference field', async () => {
      await paymentMethodsFor(
        paymentMethodsDescriptor,
        'company-1',
        positiveEurTotals,
        { currency: 'EUR', client: 'client-42' },
        'INV-1',
      );

      expect(mockedResolvePresentations).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({ currency: 'EUR' }),
        'client-42',
      );
    });

    it('a document type with no "client" field at all forwards `undefined`, never throws', async () => {
      const noClientFieldDescriptor: DocumentTypeDescriptor = {
        id: 'expense',
        label: 'Expense',
        fields: [],
        actions: [],
        usesPaymentMethods: true,
      };

      await paymentMethodsFor(noClientFieldDescriptor, 'company-1', positiveEurTotals, {}, null);

      expect(mockedResolvePresentations).toHaveBeenCalledWith('company-1', expect.anything(), undefined);
    });

    it('a present but wrong-typed "client" value forwards `undefined`, never a crash', async () => {
      await paymentMethodsFor(
        paymentMethodsDescriptor,
        'company-1',
        positiveEurTotals,
        { currency: 'EUR', client: 12345 },
        null,
      );

      expect(mockedResolvePresentations).toHaveBeenCalledWith('company-1', expect.anything(), undefined);
    });
  });
});

// THE MUTATION TARGET: `legalMentionsFor` above is a pure, synchronous helper -- this describe block
// is the one place in this file that reaches `renderDocumentInstance` itself, the ACTUAL entry point
// a PDF download/send goes through, to prove the named error it can throw is converted to a
// `BadRequestException` (never a bare 500) BEFORE any HTML/Chromium work is even attempted -- the
// throw happens while resolving legal mentions, strictly before `renderDocumentHtml`/`renderPdf` are
// ever called, so this test needs no Puppeteer at all despite exercising the real function.
describe('renderDocumentInstance -- an unresolvable legal-mention placeholder becomes a named 400', () => {
  beforeEach(() => {
    mockedResolveCustomFields.mockResolvedValue([]);
    (prisma.company.findUnique as Mock).mockResolvedValue({
      name: 'Dupont Consulting',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      iban: null,
      language: null,
      brandingAccentColor: null,
      brandingFont: null,
      brandingLogoId: null,
    });
  });

  it('a pre-2026 French invoice (before lateFeeRate has any value) rejects with BadRequestException, never a raw crash', async () => {
    await expect(
      renderDocumentInstance(
        { referenceRegistry: new EntityReferenceRegistry() },
        'company-1',
        invoiceDescriptor,
        {
          id: 'doc-1',
          status: 'sent',
          data: { issueDate: '2025-11-15', currency: 'EUR', lines: [] },
          createdAt: new Date(),
          displayNumber: 'INV-2025-0001',
          atcud: null,
        },
        'on-demand',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ISSUE #519: same real entry point, now proven to SUCCEED for the two dates the issue names --
  // before this fix both rejected with the exact same `BadRequestException` as the pre-2026 test just
  // above, because `lateFeeRate`'s own table ends 2027-01-01. `legalMentionsFor`'s own describe block
  // above already proves the fallback text itself; this proves the actual PDF/send entry point never
  // throws for it any more.
  it('a French invoice dated 2027-01-02 renders successfully -- the send is no longer refused', async () => {
    mockedRenderPdf.mockResolvedValue(Buffer.from('pdf-bytes'));

    const result = await renderDocumentInstance(
      { referenceRegistry: new EntityReferenceRegistry() },
      'company-1',
      invoiceDescriptor,
      {
        id: 'doc-2027-1',
        status: 'sent',
        data: { issueDate: '2027-01-02', currency: 'EUR', lines: [] },
        createdAt: new Date(),
        displayNumber: 'INV-2027-0001',
        atcud: null,
      },
      'on-demand',
    );

    expect(mockedRenderPdf).toHaveBeenCalledTimes(1);
    expect(result.pdf).toEqual(Buffer.from('pdf-bytes'));
    const html = mockedRenderPdf.mock.calls[0][0];
    expect(html).toContain('Banque centrale européenne');
    expect(html).not.toContain('{lateFeeRate}');
  });

  it('a French invoice dated 2027-07-02 renders successfully too -- the gap is not a one-off, it recurs every half-year', async () => {
    mockedRenderPdf.mockResolvedValue(Buffer.from('pdf-bytes'));

    await renderDocumentInstance(
      { referenceRegistry: new EntityReferenceRegistry() },
      'company-1',
      invoiceDescriptor,
      {
        id: 'doc-2027-2',
        status: 'sent',
        data: { issueDate: '2027-07-02', currency: 'EUR', lines: [] },
        createdAt: new Date(),
        displayNumber: 'INV-2027-0002',
        atcud: null,
      },
      'on-demand',
    );

    expect(mockedRenderPdf).toHaveBeenCalledTimes(1);
    const html = mockedRenderPdf.mock.calls[0][0];
    expect(html).toContain('Banque centrale européenne');
  });
});

/**
 * Review point #3 ("wrong VAT line for VAT-exempt companies") - `computeQuoteOptionTotals` used to
 * be called without `sellerExemptVat`, so a franchise-base seller (art. 293 B CGI) whose lines still
 * carried a non-zero rate printed "VAT 20%" under EVERY option, even though the ordinary single-total
 * path (`computeDocumentTotals(..., { sellerExemptVat: company.exemptVat })` right above it) already
 * hid that same row. Proven against the REAL quote descriptor and the REAL render-html.ts pipeline -
 * `renderPdf` mocked only to capture the html it was handed, never the composition itself.
 */
describe("renderDocumentInstance - a VAT-exempt company's quote with 2+ options (review point #3)", () => {
  const quoteDescriptor = buildQuoteDescriptor();

  const exemptCompany = {
    name: 'Dupont Consulting',
    address: '12 Rue de la Paix',
    city: 'Paris',
    postalCode: '75002',
    country: 'France',
    iban: null,
    language: null,
    exemptVat: true,
    brandingAccentColor: null,
    brandingFont: null,
    brandingLogoId: null,
  };

  const quoteWithOptions = {
    id: 'quote-1',
    status: 'sent' as const,
    data: {
      currency: 'EUR',
      issueDate: '2026-06-30',
      lines: [
        { description: 'Basic package', quantity: 1, unitPrice: 100, vatRate: '20', option: 'Basic' },
        { description: 'Premium package', quantity: 1, unitPrice: 300, vatRate: '20', option: 'Premium' },
      ],
    },
    createdAt: new Date(),
    displayNumber: 'Q-2026-0001',
    atcud: null,
    acceptedOption: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveCustomFields.mockResolvedValue([]);
    mockedRenderPdf.mockResolvedValue(Buffer.from('pdf-bytes'));
  });

  it('prints NO "VAT 20%" line under either option once the company is VAT-exempt', async () => {
    (prisma.company.findUnique as Mock).mockResolvedValue(exemptCompany);

    await renderDocumentInstance(
      { referenceRegistry: new EntityReferenceRegistry() },
      'company-1',
      quoteDescriptor,
      quoteWithOptions,
      'on-demand',
    );

    expect(mockedRenderPdf).toHaveBeenCalledTimes(1);
    const html = mockedRenderPdf.mock.calls[0][0];
    expect(html).not.toContain('VAT 20%');
    // The gross figures still print - only the VAT breakdown row is hidden, same as the single-total
    // exempt path (`render-html.spec.ts`'s own "showVat: false" describe block). The arithmetic itself
    // is untouched by the exemption flag (the stray non-zero rate is a data fact, not zeroed here) -
    // Basic's own 100.00 net still grosses to 120.00, Premium's 300.00 net to 360.00.
    expect(html).toContain('120.00 EUR');
    expect(html).toContain('360.00 EUR');
  });

  it('prints "VAT 20%" under each option for the SAME quote when the company is NOT exempt', async () => {
    (prisma.company.findUnique as Mock).mockResolvedValue({ ...exemptCompany, exemptVat: false });

    await renderDocumentInstance(
      { referenceRegistry: new EntityReferenceRegistry() },
      'company-1',
      quoteDescriptor,
      quoteWithOptions,
      'on-demand',
    );

    const html = mockedRenderPdf.mock.calls[0][0];
    expect(html).toContain('VAT 20%');
  });
});

/**
 * Issue #494 - the delivered PDF is rendered while the record is still "sending" and used to print
 * "Status: sending". The purpose the caller passes decides the status line, through the real
 * descriptors (see `status-line-policy.ts` for the rule and `status-line-policy.spec.ts` for every
 * type and status); this proves the composition actually hands that decision to the HTML.
 */
describe('renderDocumentInstance - the status line follows the render purpose (issue #494)', () => {
  const quoteDescriptor = buildQuoteDescriptor();
  const quote = (status: string) => ({
    id: 'quote-1',
    status,
    data: { currency: 'EUR', issueDate: '2026-06-30', lines: [] },
    createdAt: new Date(),
    displayNumber: 'Q-2026-0001',
    atcud: null,
    acceptedOption: null,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveCustomFields.mockResolvedValue([]);
    mockedRenderPdf.mockResolvedValue(Buffer.from('pdf-bytes'));
    (prisma.company.findUnique as Mock).mockResolvedValue({
      name: 'Dupont Consulting',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      iban: null,
      language: null,
      exemptVat: false,
      brandingAccentColor: null,
      brandingFont: null,
      brandingLogoId: null,
    });
  });

  async function htmlFor(status: string, purpose: 'delivery' | 'on-demand'): Promise<string> {
    await renderDocumentInstance(
      { referenceRegistry: new EntityReferenceRegistry() },
      'company-1',
      quoteDescriptor,
      quote(status),
      purpose,
    );
    return mockedRenderPdf.mock.calls[0][0];
  }

  it('the delivery render of a quote being sent prints no status line and never "sending"', async () => {
    const html = await htmlFor('sending', 'delivery');
    expect(html).not.toContain('>Status:<');
    expect(html).not.toContain('sending');
    // The rest of the header is untouched: the number and the date still print.
    expect(html).toContain('Q-2026-0001');
    expect(html).toContain('>Date:<');
  });

  it('an on-demand render of a draft still prints "Status: draft", the working copy\'s warning', async () => {
    const html = await htmlFor('draft', 'on-demand');
    expect(html).toContain('<div><strong>Status:</strong> draft</div>');
  });

  it('an on-demand render of an issued quote (signed) prints none: it stands in for the delivered copy', async () => {
    const html = await htmlFor('signed', 'on-demand');
    expect(html).not.toContain('>Status:<');
  });
});
