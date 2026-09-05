import * as http from 'node:http';

import {
  buildLocalOcrClient,
  LocalOcrError,
  LocalOcrTimeoutError,
  mapOcrTextToProposal,
} from './local-client';

/** A real `node:http` stub standing in for `apache/tika:latest-full`'s own `PUT /tika` — never a
 *  mocked `fetch`, the same discipline `mistral-client.spec.ts`/`ocr-server.spec.ts` already use
 *  one directory over. The response shape asserted against (`PUT`, `Accept: text/plain` in,
 *  PLAIN TEXT body out, no JSON envelope) is quoted from this task's own real, live round-trip
 *  against `apache/tika:latest-full` (`local-client.ts`'s own header, 2026-09-05) — never invented. */
async function withTikaStub(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('tika stub did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('buildLocalOcrClient', () => {
  it('PUTs the raw bytes to {baseUrl}/tika with the mime as Content-Type and Accept: text/plain', async () => {
    let receivedMethod = '';
    let receivedPath = '';
    let receivedContentType = '';
    let receivedAccept = '';
    let receivedBody = '';

    await withTikaStub(
      (req, res) => {
        receivedMethod = req.method ?? '';
        receivedPath = req.url ?? '';
        receivedContentType = req.headers['content-type'] ?? '';
        receivedAccept = req.headers.accept ?? '';
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          receivedBody = body;
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('ACME FOURNITURES SARL\nTotal TTC: 100.00 EUR\n');
        });
      },
      async (baseUrl) => {
        const client = buildLocalOcrClient({ baseUrl });
        const bytes = new TextEncoder().encode('%PDF fake bytes');

        const proposal = await client.extract(bytes, 'application/pdf');

        expect(receivedMethod).toBe('PUT');
        expect(receivedPath).toBe('/tika');
        expect(receivedContentType).toBe('application/pdf');
        expect(receivedAccept).toBe('text/plain');
        expect(receivedBody).toBe('%PDF fake bytes');
        expect(proposal.fields.grossAmount).toBe(100);
      },
    );
  });

  it('tolerates a trailing slash on baseUrl', async () => {
    let receivedPath = '';
    await withTikaStub(
      (req, res) => {
        receivedPath = req.url ?? '';
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('');
      },
      async (baseUrl) => {
        const client = buildLocalOcrClient({ baseUrl: `${baseUrl}/` });
        await client.extract(new Uint8Array([1]), 'application/pdf');
        expect(receivedPath).toBe('/tika');
      },
    );
  });

  it('a non-2xx response is a NAMED LocalOcrError carrying the real HTTP status', async () => {
    await withTikaStub(
      (_req, res) => {
        res.writeHead(422, { 'content-type': 'text/plain' });
        res.end('Unprocessable Entity');
      },
      async (baseUrl) => {
        const client = buildLocalOcrClient({ baseUrl });
        await expect(client.extract(new Uint8Array([1]), 'application/pdf')).rejects.toMatchObject({
          name: 'LocalOcrError',
          status: 422,
        });
      },
    );
  });

  it('an unreachable engine is a NAMED failure, never a silent hang', async () => {
    const client = buildLocalOcrClient({ baseUrl: 'http://127.0.0.1:1' }); // nothing listens here
    await expect(client.extract(new Uint8Array([1]), 'application/pdf')).rejects.toBeInstanceOf(
      LocalOcrError,
    );
  });

  it('a request that never answers times out with a NAMED LocalOcrTimeoutError', async () => {
    await withTikaStub(
      () => {
        // Never responds — the engine hung.
      },
      async (baseUrl) => {
        const client = buildLocalOcrClient({ baseUrl, timeoutMs: 20 });
        await expect(client.extract(new Uint8Array([1]), 'application/pdf')).rejects.toBeInstanceOf(
          LocalOcrTimeoutError,
        );
      },
    );
  });
});

describe('mapOcrTextToProposal — the heuristic text -> proposal mapping', () => {
  /** A realistic multi-field OCR transcript — the EXACT text this task's own real
   *  `apache/tika:latest-full` round-trip returned for a genuinely rasterized (image-only, no
   *  text layer) invoice PNG, minor OCR noise ("PrixU." glued together) included on purpose: this
   *  pins the mapping against what the real engine actually outputs, not an idealized transcript. */
  const REALISTIC_INVOICE_TEXT = `ACME FOURNITURES SARL
12 rue de la Paix, 75002 Paris
TVA: FR12345678901

FACTURE N. INV-2026-0042
Date d'emission: 2026-08-15

Description Qte PrixU. TVA
Prestation consell 1 1000.00 20%
Total HT: 1000.00 EUR

Total TVA: 200.00 EUR

Total TTC: 1200.00 EUR

IBAN: FR7630006000011234567890189
`;

  it('finds all three totals (HT/TVA/TTC), the invoice number, the date, the VAT id, and the supplier', () => {
    const proposal = mapOcrTextToProposal(REALISTIC_INVOICE_TEXT);

    expect(proposal.fields).toEqual({
      supplier: 'ACME FOURNITURES SARL',
      supplierVatId: 'FR12345678901',
      supplierNumber: 'INV-2026-0042',
      issueDate: '2026-08-15',
      netAmount: 1000,
      vatAmount: 200,
      grossAmount: 1200,
    });
  });

  it('never picks up the IBAN as if it were the supplier VAT id, in either field order', () => {
    const ibanFirst = REALISTIC_INVOICE_TEXT.replace('IBAN: FR7630006000011234567890189\n', '').replace(
      'TVA: FR12345678901',
      'IBAN: FR7630006000011234567890189\nTVA: FR12345678901',
    );

    expect(mapOcrTextToProposal(ibanFirst).fields.supplierVatId).toBe('FR12345678901');
  });

  // Mandataire tripwire (validation OCR-local, 2026-09-05): the test above passes even WITHOUT the
  // IBAN line-filter, because the keyword-anchored first pass already wins on its fixture — the
  // filter only ever decides the KEYWORD-LESS fallback path. A compact IBAN body (FR + 25 digits)
  // can never match VAT_ID_SHAPE_RE (12-char cap + \b), so the realistic way the filter earns its
  // keep is an OCR transcript that broke the IBAN's digit run with spaces (a classic OCR artifact):
  // the first fragment (FR + 10 digits) IS VAT-shaped. Proven to bite: with the filter replaced by
  // `lines` this returns 'FR7630006000' instead of absent.
  it('a space-broken IBAN in a keyword-less document never becomes the VAT id — the IBAN line-filter alone stands', () => {
    const text =
      'Dupont SARL\n12 rue de la Paix\nIBAN: FR7630006000 0112 3456 7890 189\nMerci de votre confiance\n';
    expect(mapOcrTextToProposal(text).fields.supplierVatId).toBeUndefined();
  });

  it('a field genuinely absent from the text is ABSENT from the proposal, never invented', () => {
    const noVatNoDate = REALISTIC_INVOICE_TEXT.replace('TVA: FR12345678901\n', '').replace(
      "Date d'emission: 2026-08-15\n",
      '',
    );

    const proposal = mapOcrTextToProposal(noVatNoDate);

    expect(proposal.fields.supplierVatId).toBeUndefined();
    expect(proposal.fields.issueDate).toBeUndefined();
    expect(proposal.fields).not.toHaveProperty('supplierVatId');
    expect(proposal.fields).not.toHaveProperty('issueDate');
    // Everything else on the same document is still found — one missing field never sinks the rest.
    expect(proposal.fields.grossAmount).toBe(1200);
  });

  it('a blank document yields an entirely empty proposal, never a thrown error', () => {
    expect(mapOcrTextToProposal('')).toEqual({ fields: {} });
    expect(mapOcrTextToProposal('   \n  \n')).toEqual({ fields: {} });
  });

  it('plain prose with none of the target keywords finds no amounts/date/VAT id/number — only the', () => {
    // weakest heuristic (`supplier` — "first non-blank line", see this file's own header) still
    // fires: it has no notion of "does this even look like an invoice", by design.
    const text = 'the quick brown fox jumps over the lazy dog';

    const proposal = mapOcrTextToProposal(text);
    expect(proposal.fields).toEqual({ supplier: text });
  });

  it('handles European thousand-separator amounts (dot=thousands, comma=decimal)', () => {
    const text = 'Total TTC: 1.234,56 EUR';
    expect(mapOcrTextToProposal(text).fields.grossAmount).toBe(1234.56);
  });

  it('handles US-style amounts (comma=thousands, dot=decimal)', () => {
    const text = 'Total TTC: 1,234.56 EUR';
    expect(mapOcrTextToProposal(text).fields.grossAmount).toBe(1234.56);
  });

  it('recognizes a German invoice (MwSt / Netto / Gesamtbetrag)', () => {
    const text = `Musterfirma GmbH
Netto: 500.00 EUR
MwSt: 95.00 EUR
Gesamtbetrag: 595.00 EUR`;

    const proposal = mapOcrTextToProposal(text);
    expect(proposal.fields.netAmount).toBe(500);
    expect(proposal.fields.vatAmount).toBe(95);
    expect(proposal.fields.grossAmount).toBe(595);
  });

  it('recognizes a Polish invoice (Netto / VAT / Razem) — the VAT keyword IS covered even though', () => {
    // the mandant's own required languages include Polish; Poland's own tax name IS the borrowed
    // acronym "VAT", already covered by `VAT_RE` with no extra keyword needed.
    const text = `Netto: 500,00
VAT: 115,00
Razem: 615,00`;

    const proposal = mapOcrTextToProposal(text);
    expect(proposal.fields.netAmount).toBe(500);
    expect(proposal.fields.vatAmount).toBe(115);
    expect(proposal.fields.grossAmount).toBe(615);
  });

  it('prefers the LAST matching total line — a per-line subtotal earlier in the document never wins', () => {
    const text = `Line 1 subtotal HT: 10.00 EUR
Line 2 subtotal HT: 20.00 EUR
Total HT: 1000.00 EUR`;

    expect(mapOcrTextToProposal(text).fields.netAmount).toBe(1000);
  });
});
