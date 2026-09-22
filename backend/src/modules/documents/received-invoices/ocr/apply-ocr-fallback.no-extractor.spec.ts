/**
 * A DEDICATED file, deliberately separate from `apply-ocr-fallback.spec.ts`: Jest gives every spec
 * FILE its own fresh module registry, so `receivedDocumentExtractorRegistry` here is guaranteed
 * pristine (nothing registered) — the one scenario `apply-ocr-fallback.spec.ts` itself cannot cover
 * in isolation, since ITS OWN stub stays registered for that file's whole run (the registry has no
 * `unregister` — see `extractor.ts`'s own header on why one was never needed).
 */
import { ExtractionResult } from '../extraction';
import { applyOcrFallback } from './apply-ocr-fallback';

describe('applyOcrFallback — with LITERALLY nothing registered (a deployment before the OCR plugin ever existed)', () => {
  it('reports "unavailable" for an unstructured PDF — never throws, never crashes the upload', async () => {
    const structural: ExtractionResult = { syntax: null, fields: {} };

    const result = await applyOcrFallback(structural, new Uint8Array([1, 2, 3]), 'application/pdf', 'x.pdf');

    expect(result).toEqual({ syntax: null, fields: {}, ocr: { outcome: 'unavailable' } });
  });
});
