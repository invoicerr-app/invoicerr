import * as http from 'node:http';

import {
  buildMistralOcrClient,
  mapMistralResponseToProposal,
  MistralOcrError,
  MistralOcrTimeoutError,
} from './mistral-client';

/**
 * `document_annotation` sample CITED VERBATIM from `docs.mistral.ai/capabilities/OCR/annotations/`'s
 * own worked example response (fetched 2026-09-03, see `client.ts`'s own header) — proves the ONE
 * mechanic this task could not have gotten right by guessing: the field is a JSON-ENCODED STRING,
 * not a nested object, REGARDLESS of what schema was requested. This particular sample used a
 * language-detection schema (chapter titles of a paper), not an invoice — none of ITS fields
 * (`language`/`chapter_titles`/`urls`) exist in `INVOICE_ANNOTATION_JSON_SCHEMA`, so mapping it
 * through OUR schema-shaped reader correctly yields an EMPTY proposal, never a crash on an
 * unexpected shape — exactly like `extraction.ts`'s own `EMPTY_RESULT` for anything it cannot read.
 */
const CITED_DOCUMENT_ANNOTATION_SAMPLE =
  '{\n"language": "English",\n"chapter_titles": "Pixtral 12B, Abstract, 1 Introduction",\n' +
  '"urls": "https://mistral.ai/news/pixtal-12b/"\n}';

describe('mapMistralResponseToProposal', () => {
  it('parses document_annotation as a JSON-ENCODED STRING — the cited real Mistral shape', () => {
    const proposal = mapMistralResponseToProposal({ document_annotation: CITED_DOCUMENT_ANNOTATION_SAMPLE });

    // None of this cited sample's OWN fields exist in our invoice schema — an honest empty read,
    // never a crash on the unexpected shape.
    expect(proposal).toEqual({ fields: {} });
  });

  it("maps a full invoice-shaped annotation (this task's own schema) to ExtractedInvoiceFields", () => {
    const annotation = JSON.stringify({
      supplier: 'Fournisseur OCR SARL',
      supplierVatId: 'FR12345678901',
      supplierNumber: 'INV-2026-042',
      issueDate: '2026-08-20',
      currency: 'EUR',
      netAmount: 750,
      vatAmount: 150,
      grossAmount: 900,
      lines: [{ description: 'Prestation', quantity: 3, unitPrice: 250, vatRate: '20' }],
    });

    const proposal = mapMistralResponseToProposal({ document_annotation: annotation });

    expect(proposal).toEqual({
      fields: {
        supplier: 'Fournisseur OCR SARL',
        supplierVatId: 'FR12345678901',
        supplierNumber: 'INV-2026-042',
        issueDate: '2026-08-20',
        currency: 'EUR',
        netAmount: 750,
        vatAmount: 150,
        grossAmount: 900,
        lines: [{ description: 'Prestation', quantity: 3, unitPrice: 250, vatRate: '20' }],
      },
    });
  });

  it('every `null` field is OMITTED, never carried as an explicit null — the same convention extraction.ts already uses', () => {
    const annotation = JSON.stringify({
      supplier: 'Fournisseur OCR SARL',
      supplierVatId: null,
      supplierNumber: null,
      issueDate: null,
      currency: null,
      netAmount: null,
      vatAmount: null,
      grossAmount: null,
      lines: [],
    });

    const proposal = mapMistralResponseToProposal({ document_annotation: annotation });

    expect(proposal).toEqual({ fields: { supplier: 'Fournisseur OCR SARL' } });
    expect(proposal.fields).not.toHaveProperty('supplierVatId');
    expect(proposal.fields).not.toHaveProperty('lines');
  });

  it('a missing/null document_annotation is an empty proposal, never a throw', () => {
    expect(mapMistralResponseToProposal({})).toEqual({ fields: {} });
    expect(mapMistralResponseToProposal({ document_annotation: null })).toEqual({ fields: {} });
  });

  it('an unparseable document_annotation string degrades to an empty proposal, never a throw', () => {
    expect(mapMistralResponseToProposal({ document_annotation: 'not json at all {' })).toEqual({
      fields: {},
    });
  });
});

/** A tiny real `node:http` server this file fully controls — the same pattern
 *  `nav-client.spec.ts` already established for a wire-level client (bind port 0, read the real
 *  assigned port, tear down in a `finally`). */
async function withStubServer(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stub server did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

describe('buildMistralOcrClient — against a real HTTP stub (never a mocked fetch)', () => {
  it('extract() posts the base64 data URI and maps a successful response', async () => {
    let receivedPath = '';
    let receivedAuth = '';
    let receivedBody: Record<string, unknown> = {};

    await withStubServer(
      async (req, res) => {
        receivedPath = req.url ?? '';
        receivedAuth = req.headers.authorization ?? '';
        receivedBody = JSON.parse(await readBody(req));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            pages: [{ index: 0, markdown: 'irrelevant to this client', images: [], dimensions: {} }],
            model: 'mistral-ocr-2505-completion',
            document_annotation: JSON.stringify({
              supplier: 'Fournisseur OCR SARL',
              supplierVatId: 'FR12345678901',
              supplierNumber: null,
              issueDate: null,
              currency: 'EUR',
              netAmount: null,
              vatAmount: null,
              grossAmount: null,
              lines: null,
            }),
            usage_info: { pages_processed: 1, doc_size_bytes: 1234 },
          }),
        );
      },
      async (baseUrl) => {
        const client = buildMistralOcrClient({ apiKey: 'test-key-123', baseUrl });
        const bytes = new TextEncoder().encode('%PDF-1.4 fake pdf bytes');

        const proposal = await client.extract(bytes, 'application/pdf');

        expect(proposal).toEqual({
          fields: { supplier: 'Fournisseur OCR SARL', supplierVatId: 'FR12345678901', currency: 'EUR' },
        });
        expect(receivedPath).toBe('/v1/ocr');
        expect(receivedAuth).toBe('Bearer test-key-123');
        expect(receivedBody.model).toBe('mistral-ocr-latest');
        const document = receivedBody.document as { type: string; document_url: string };
        expect(document.type).toBe('document_url');
        expect(document.document_url).toBe(
          `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`,
        );
      },
    );
  });

  // The REAL, live-captured Mistral response (this task's own `curl`, no Authorization header AND a
  // garbage bearer token both answered identically — see `client.ts`'s own header) — reproduced
  // verbatim by this stub.
  it('a 401 becomes a NAMED MistralOcrError, carrying the real "Invalid API Key" body', async () => {
    await withStubServer(
      (_req, res) => {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Invalid API Key' }));
      },
      async (baseUrl) => {
        const client = buildMistralOcrClient({ apiKey: 'wrong', baseUrl });

        await expect(client.extract(new Uint8Array([1]), 'application/pdf')).rejects.toThrow(MistralOcrError);
        await expect(client.extract(new Uint8Array([1]), 'application/pdf')).rejects.toMatchObject({
          status: 401,
          message: expect.stringContaining('Invalid API Key'),
        });
      },
    );
  });

  it('a 429 becomes a NAMED MistralOcrError naming quota/rate-limit, not a generic failure', async () => {
    await withStubServer(
      (_req, res) => {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'rate limit exceeded' }));
      },
      async (baseUrl) => {
        const client = buildMistralOcrClient({ apiKey: 'x', baseUrl });

        await expect(client.extract(new Uint8Array([1]), 'application/pdf')).rejects.toMatchObject({
          status: 429,
          message: expect.stringMatching(/quota or rate limit/i),
        });
      },
    );
  });

  it('a request that never answers times out with a NAMED MistralOcrTimeoutError', async () => {
    await withStubServer(
      (_req, _res) => {
        // Deliberately never respond — the client's own timeout must fire, not Node's own socket
        // default (which would hang this test far longer than the suite's own budget).
      },
      async (baseUrl) => {
        const client = buildMistralOcrClient({ apiKey: 'x', baseUrl, timeoutMs: 200 });

        await expect(client.extract(new Uint8Array([1]), 'application/pdf')).rejects.toThrow(
          MistralOcrTimeoutError,
        );
      },
    );
  }, 10000);

  it('a non-JSON 200 response is a NAMED error, never a silent crash reading .document_annotation off nothing', async () => {
    await withStubServer(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('<html>not json</html>');
      },
      async (baseUrl) => {
        const client = buildMistralOcrClient({ apiKey: 'x', baseUrl });

        await expect(client.extract(new Uint8Array([1]), 'application/pdf')).rejects.toThrow(
          /non-JSON response/,
        );
      },
    );
  });
});
