/**
 * Storecove adapter unit tests — mocked HTTP layer.
 *
 * Field names mirror the public API reference (https://www.storecove.com/docs/, fetched
 * 2026-07-11): DocumentSubmission { legalEntityId, routing.eIdentifiers[{scheme,id}],
 * document.rawDocumentData { document: base64, parseStrategy: 'ubl' } } → { guid }.
 *
 * LIVE PROOF: DEFERRED — Storecove's sandbox is a 30-day manual trial (no self-serve
 * signup API); this adapter stays mocked-only until credentials exist. See
 * PEPPOL_AP_RESEARCH.md §D.
 */
import { PEPPOL_BILLING_PROCESS_ID, PEPPOL_DOC_TYPES } from './peppol-client';
import { STORECOVE_API_URL, StorecoveApClient, participantToStorecoveIdentifier } from './storecove-client';

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const CONFIG = { apiKey: 'sc-unit-key', legalEntityId: 4321 };
const UBL = '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>';

function sendRequest() {
  return {
    senderParticipantId: '9957:FR32123456789',
    receiverParticipantId: '9930:DE811907980',
    documentTypeId: PEPPOL_DOC_TYPES.INVOICE_UBL,
    processId: PEPPOL_BILLING_PROCESS_ID,
    documentBytes: Buffer.from(UBL, 'utf-8'),
    idempotencyKey: 'not-a-guid',
  };
}

// ---------------------------------------------------------------------------
// participant → RoutingIdentifier mapping
// ---------------------------------------------------------------------------

describe('participantToStorecoveIdentifier', () => {
  it('maps 99xx national VAT EAS codes to <CC>:VAT', () => {
    expect(participantToStorecoveIdentifier('9930:DE811907980')).toEqual({
      scheme: 'DE:VAT',
      id: 'DE811907980',
    });
    expect(participantToStorecoveIdentifier('9945:PL0101010101')).toEqual({
      scheme: 'PL:VAT',
      id: 'PL0101010101',
    });
  });

  it('maps 0088 to GLN', () => {
    expect(participantToStorecoveIdentifier('0088:7300010000001')).toEqual({
      scheme: 'GLN',
      id: '7300010000001',
    });
  });

  it('falls back to the raw ICD for unmapped schemes', () => {
    expect(participantToStorecoveIdentifier('0192:987654321')).toEqual({
      scheme: '0192',
      id: '987654321',
    });
  });
});

// ---------------------------------------------------------------------------
// send()
// ---------------------------------------------------------------------------

describe('StorecoveApClient.send', () => {
  it('POSTs a DocumentSubmission with base64 raw UBL and routing eIdentifiers', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ guid: 'c65d43d1-4b44-40a9-8926-6743f9fc90b2' }));

    const client = new StorecoveApClient(CONFIG);
    const result = await client.send(sendRequest());

    expect(result).toEqual({
      messageId: 'c65d43d1-4b44-40a9-8926-6743f9fc90b2',
      status: 'QUEUED',
    });

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${STORECOVE_API_URL}/document_submissions`);
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer sc-unit-key');

    const body = JSON.parse(opts.body as string);
    expect(body.legalEntityId).toBe(4321);
    expect(body.routing).toEqual({ eIdentifiers: [{ scheme: 'DE:VAT', id: 'DE811907980' }] });
    expect(body.document.documentType).toBe('invoice');
    expect(body.document.rawDocumentData.parseStrategy).toBe('ubl');
    expect(Buffer.from(body.document.rawDocumentData.document, 'base64').toString('utf-8')).toBe(UBL);
    // Non-GUID idempotency keys are not forwarded (idempotencyGuid must be 36 chars).
    expect(body.idempotencyGuid).toBeUndefined();
  });

  it('forwards GUID-shaped idempotency keys as idempotencyGuid', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ guid: 'g-1' }));

    const client = new StorecoveApClient(CONFIG);
    await client.send({
      ...sendRequest(),
      idempotencyKey: '123e4567-e89b-12d3-a456-426614174000',
    });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.idempotencyGuid).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('throws on non-2xx (consistent with the other channels)', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ errors: [{ source: { pointer: 'routing' }, details: 'invalid' }] }, 422),
    );

    const client = new StorecoveApClient(CONFIG);
    await expect(client.send(sendRequest())).rejects.toThrow(/Storecove send failed: HTTP 422/);
  });
});

// ---------------------------------------------------------------------------
// getStatus() — evidence endpoint
// ---------------------------------------------------------------------------

describe('StorecoveApClient.getStatus', () => {
  it('GETs /document_submissions/{guid}/evidence and maps 200 → DELIVERED', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        guid: 'g-2',
        network: 'peppol',
        evidence: { message_id: 'as4-msg-77' },
        documents: [],
      }),
    );

    const client = new StorecoveApClient(CONFIG);
    const result = await client.getStatus('g-2');

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(`${STORECOVE_API_URL}/document_submissions/g-2/evidence`);
    expect(result.status).toBe('DELIVERED');
    expect(result.mlrDescription).toContain('as4-msg-77');
  });

  it('maps 404 (evidence not yet available) → SENT, not an error', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: 'not found' }, 404));

    const client = new StorecoveApClient(CONFIG);
    const result = await client.getStatus('g-3');

    expect(result).toEqual({ messageId: 'g-3', status: 'SENT' });
  });

  it('throws on other HTTP errors', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: 'nope' }, 500));

    const client = new StorecoveApClient(CONFIG);
    await expect(client.getStatus('g-4')).rejects.toThrow(/Storecove evidence check failed/);
  });
});

// ---------------------------------------------------------------------------
// sendInvoiceResponse()
// ---------------------------------------------------------------------------

describe('StorecoveApClient.sendInvoiceResponse', () => {
  it('POSTs documentType invoice_response with forDocumentGuid + UNCL4343 code', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ guid: 'resp-guid-1' }));

    const client = new StorecoveApClient(CONFIG);
    const result = await client.sendInvoiceResponse({
      senderParticipantId: '9930:DE811907980',
      receiverParticipantId: '9957:FR32123456789',
      originalMessageId: 'orig-guid-9',
      responseCode: 'RE',
      description: 'Wrong amount',
    });

    expect(result).toEqual({ messageId: 'resp-guid-1', status: 'QUEUED' });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.forDocumentGuid).toBe('orig-guid-9');
    expect(body.document.documentType).toBe('invoice_response');
    expect(body.document.invoiceResponse).toEqual({ responseCode: 'RE', note: 'Wrong amount' });
  });
});
