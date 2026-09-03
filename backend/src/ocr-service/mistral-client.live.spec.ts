/**
 * REAL round-trip against the Mistral Document AI (OCR) API — TODO_PRODUIT.md T5(c).
 *
 * Gated `MISTRAL_OCR_LIVE=1` + `MISTRAL_API_KEY` (`../modules/documents/transports/live-gate.ts`),
 * the same shape every sibling channel's own live spec uses:
 *
 *   MISTRAL_OCR_LIVE=1 MISTRAL_API_KEY=... npx jest mistral-client.live --no-coverage
 *
 * HONEST STATUS AT THE END OF THIS TASK: **skipped, always** — this checkout holds no Mistral API
 * key (a real one costs money and was never provisioned for this task). What WAS independently,
 * live-verified (2026-09-03, real `curl`, credential-free, no API key needed at all) is reproduced by
 * the reachability block below: `POST https://api.mistral.ai/v1/ocr` with no `Authorization` header,
 * AND with an obviously-fake bearer token, both answer `HTTP 401` with body
 * `{"detail":"Invalid API Key"}` — confirming the host, the path, and the error shape are real, not
 * merely documented by `docs.mistral.ai` (see `mistral-client.ts`'s own header for the fuller
 * citation list). The mandant's own follow-up instruction is honoured here too: this spec tests the
 * OCR SERVICE'S OWN client (`mistral-client.ts`), the only code in this whole deployment that is
 * meant to ever hold `MISTRAL_API_KEY` — never the main backend's `MistralOcrProvider`
 * (`plugins/ocr/providers/mistral/mistral.ts`), which by design never sees a real Mistral key at all.
 */
import { PDFDocument } from 'pdf-lib';

import { liveDescribe } from '../modules/documents/transports/live-gate';
import { buildMistralOcrClient, MISTRAL_OCR_DEFAULT_BASE_URL } from './mistral-client';

const describeReachability = liveDescribe('MISTRAL_OCR_LIVE');

describeReachability('Mistral OCR — credential-free reachability proof', () => {
  it('the real API is reachable and names a missing/invalid API key, not a routing/network error', async () => {
    const res = await fetch(`${MISTRAL_OCR_DEFAULT_BASE_URL}/v1/ocr`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'mistral-ocr-latest',
        document: { type: 'document_url', document_url: 'https://arxiv.org/pdf/2201.04234' },
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ detail: 'Invalid API Key' });
  }, 15000);
});

const describeLive = liveDescribe('MISTRAL_OCR_LIVE', ['MISTRAL_API_KEY']);

describeLive('Mistral OCR live round-trip', () => {
  it('extracts SOMETHING structured off a real, minimal, real-text one-page PDF', async () => {
    // A REAL PDF, built with this backend's own `pdf-lib` dependency (never a hand-crafted binary
    // fixture) — one page, one line of real, renderable text a real OCR pass can actually read.
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    page.drawText('INVOICE FROM Acme Test Supplier — TOTAL 123.45 EUR', { x: 20, y: 150, size: 10 });
    const pdfBytes = await doc.save();

    const client = buildMistralOcrClient({ apiKey: process.env.MISTRAL_API_KEY! });

    // Never asserted against exact field VALUES (real OCR accuracy on a synthetic PDF is not this
    // task's own concern) — only that the round-trip completes and returns THIS shape, proving the
    // endpoint, auth, request body, and `document_annotation` JSON-string parsing all work against
    // the real API, not merely against this task's own stub.
    const proposal = await client.extract(pdfBytes, 'application/pdf');
    expect(proposal).toHaveProperty('fields');
    expect(typeof proposal.fields).toBe('object');
  }, 60000);
});
