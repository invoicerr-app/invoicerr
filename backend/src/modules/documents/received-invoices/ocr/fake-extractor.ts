/**
 * TODO_PRODUIT.md T5(c) — a deterministic, network-free stand-in for a real OCR plugin, registered
 * ONLY under `NODE_ENV=test` (`plugins/index.ts`'s own composition root) — the SAME discipline
 * `modules/documents/tax/vat-validation.ts`'s own `FakeSyntaxOnlyVatValidationClient` already
 * established for VAT validation, applied here so Cypress spec 36 can exercise "PDF -> pre-filled
 * OCR proposal" through a REAL browser, without a real Mistral API key.
 *
 * Unlike the VAT fake (which genuinely re-derives its answer from the input, checking the number's
 * OWN syntax), this fake does not attempt to simulate real text recognition — there is no cheap,
 * honest way to "fake" reading an arbitrary PDF's content. Instead it answers ONLY for a document
 * that OPTS IN, by carrying an exact, obscure marker string in its raw bytes (`FAKE_OCR_MARKER`) —
 * every OTHER PDF (in particular, `36-received-invoices.cy.ts`'s own pre-existing
 * `supplier-invoice-plain.pdf` fixture) still gets an honest `ExtractorNotReadyError`, the SAME "no
 * extractor available" outcome production gets by default (Mistral shipped but never toggled on) —
 * see that spec file's own "un PDF pur" test, extended by this task to assert exactly that. This is
 * what lets ONE fake, always registered in test environments, prove BOTH outcomes (absence AND a
 * successful proposal) without any per-test plugin activation dance.
 */
import { ExtractedInvoiceProposal, ExtractorNotReadyError, ReceivedDocumentExtractor } from './extractor';

/** An exact, obscure sentinel — chosen unlikely to ever appear in a real document by coincidence.
 *  `36-received-invoices.cy.ts`'s own OCR fixture embeds this verbatim in its raw bytes (the file is
 *  not a structurally valid PDF at all — see this file's own header: this fake never parses PDF
 *  structure, only scans raw bytes, exactly like `extraction.ts`'s own regex-based XML reading never
 *  depends on a full XML parser either). */
export const FAKE_OCR_MARKER = '__INVOICERR_FAKE_OCR_MARKER__';

const FAKE_PROPOSAL: ExtractedInvoiceProposal = {
  fields: {
    supplier: 'OCR Fake Fournisseur SARL',
    supplierVatId: 'FR11122233344',
    supplierNumber: 'OCR-FAKE-0001',
    issueDate: '2026-09-01',
    currency: 'EUR',
    netAmount: 500,
    vatAmount: 100,
    grossAmount: 600,
    lines: [{ description: 'OCR Fake Line', quantity: 1, unitPrice: 500, vatRate: '20' }],
  },
};

export class FakeReceivedInvoiceOcrExtractor implements ReceivedDocumentExtractor {
  id = 'fake-ocr-test';

  supports(mime: string): boolean {
    return mime === 'application/pdf';
  }

  async extract(bytes: Uint8Array): Promise<ExtractedInvoiceProposal> {
    const text = Buffer.from(bytes).toString('utf-8');
    if (!text.includes(FAKE_OCR_MARKER)) {
      throw new ExtractorNotReadyError(
        this.id,
        'Fake test OCR extractor declined — no fake-OCR marker found in this document (this is the ' +
          'expected, honest outcome for any real document; only a fixture that deliberately opts in ' +
          'is ever answered by this test-only extractor).',
      );
    }
    // A fixed, clearly-named canned proposal regardless of what else is in the document — this fake
    // exists to prove the WIRING (a proposal reaches the screen, pre-filled, still editable), not to
    // simulate OCR accuracy, so one deterministic case is sufficient (unlike the VAT fake, which
    // needed real per-input variation to make a VALID/INVALID transition observable at all).
    return FAKE_PROPOSAL;
  }
}
