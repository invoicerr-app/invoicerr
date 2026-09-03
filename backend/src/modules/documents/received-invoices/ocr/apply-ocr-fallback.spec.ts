import { ExtractionResult } from '../extraction';
import { applyOcrFallback } from './apply-ocr-fallback';
import { ExtractorNotReadyError, receivedDocumentExtractorRegistry } from './extractor';

const STRUCTURAL_EMPTY: ExtractionResult = { syntax: null, fields: {} };
const STRUCTURAL_CII: ExtractionResult = {
  syntax: 'CII',
  fields: { supplier: 'Structural Supplier', netAmount: 100 },
};

describe('applyOcrFallback', () => {
  // ONE stub, registered once, reconfigured per test via its own mock — see this file's own header
  // reasoning against registering/unregistering per test (the registry has no `unregister`, on
  // purpose: nothing in the real system ever needs one — see `extractor.ts`'s own header).
  const extract = jest.fn();
  const stub = { id: 'stub-extractor', supports: (mime: string) => mime === 'application/pdf', extract };

  beforeAll(() => {
    receivedDocumentExtractorRegistry.register(stub);
  });

  beforeEach(() => {
    extract.mockReset();
  });

  it('never attempts OCR when structural extraction already found something — a working Factur-X is never second-guessed', async () => {
    const result = await applyOcrFallback(STRUCTURAL_CII, new Uint8Array([1]), 'application/pdf', 'x.pdf');

    expect(result).toEqual({
      syntax: 'CII',
      fields: STRUCTURAL_CII.fields,
      ocr: { outcome: 'not-attempted' },
    });
    expect(extract).not.toHaveBeenCalled();
  });

  it('never attempts OCR for a non-PDF file, even with nothing structural — an XML upload has nothing OCR could read', async () => {
    const result = await applyOcrFallback(STRUCTURAL_EMPTY, new Uint8Array([1]), 'application/xml', 'x.xml');

    expect(result).toEqual({ syntax: null, fields: {}, ocr: { outcome: 'not-attempted' } });
    expect(extract).not.toHaveBeenCalled();
  });

  it('a non-PDF file (neither mime nor filename) never even reaches the registry — "not-attempted"', async () => {
    const result = await applyOcrFallback(STRUCTURAL_EMPTY, new Uint8Array([1]), 'image/png', 'x.png');

    expect(result.ocr).toEqual({ outcome: 'not-attempted' });
    expect(extract).not.toHaveBeenCalled();
  });

  it('detects a PDF by FILENAME even when the mime is generic — the same two-signal check extraction.ts uses — and resolves/calls the extractor with the NORMALIZED "application/pdf" mime, not the generic one', async () => {
    extract.mockResolvedValue({ fields: { supplier: 'From OCR' } });

    const result = await applyOcrFallback(
      STRUCTURAL_EMPTY,
      new Uint8Array([1]),
      'application/octet-stream',
      'scan.pdf',
    );

    expect(result.ocr).toEqual({ outcome: 'extracted', extractorId: 'stub-extractor' });
    expect(extract).toHaveBeenCalledWith(expect.any(Uint8Array), 'application/pdf');
  });

  it('merges the OCR proposal into fields and tags syntax "OCR" on success', async () => {
    extract.mockResolvedValue({
      fields: { supplier: 'OCR Supplier', supplierVatId: 'FR12345678901', netAmount: 500 },
    });

    const result = await applyOcrFallback(STRUCTURAL_EMPTY, new Uint8Array([1]), 'application/pdf', 'x.pdf');

    expect(result).toEqual({
      syntax: 'OCR',
      fields: { supplier: 'OCR Supplier', supplierVatId: 'FR12345678901', netAmount: 500 },
      ocr: { outcome: 'extracted', extractorId: 'stub-extractor' },
    });
  });

  it('an ExtractorNotReadyError (plugin off/unconfigured) reports "unavailable" — the SAME honest outcome as nothing registered at all', async () => {
    extract.mockRejectedValue(new ExtractorNotReadyError('stub-extractor', 'not configured'));

    const result = await applyOcrFallback(STRUCTURAL_EMPTY, new Uint8Array([1]), 'application/pdf', 'x.pdf');

    expect(result).toEqual({ syntax: null, fields: {}, ocr: { outcome: 'unavailable' } });
  });

  it('any OTHER thrown error is a NAMED "failed" outcome — never swallowed, never folded into "unavailable"', async () => {
    extract.mockRejectedValue(new Error('Mistral OCR quota or rate limit exceeded (429).'));

    const result = await applyOcrFallback(STRUCTURAL_EMPTY, new Uint8Array([1]), 'application/pdf', 'x.pdf');

    expect(result).toEqual({
      syntax: null,
      fields: {},
      ocr: {
        outcome: 'failed',
        extractorId: 'stub-extractor',
        message: 'Mistral OCR quota or rate limit exceeded (429).',
      },
    });
  });

  it('a non-Error throw still produces a named "failed" message, via String()', async () => {
    extract.mockRejectedValue('a bare string rejection');

    const result = await applyOcrFallback(STRUCTURAL_EMPTY, new Uint8Array([1]), 'application/pdf', 'x.pdf');

    expect(result.ocr).toEqual({
      outcome: 'failed',
      extractorId: 'stub-extractor',
      message: 'a bare string rejection',
    });
  });
});
