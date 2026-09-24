/**
 * `BillitClient` against a stubbed `fetch`. The REAL round-trip is `billit.live.spec.ts`'s job
 * (gated on sandbox credentials - see that file's own header). What this proves instead is the wire
 * contract the live run cannot re-check on every CI run: that BOTH headers are sent on every call,
 * that the UBL travels inside the JSON `XML` field, and that every "Billit did not really accept
 * this" shape becomes a loud failure rather than a quiet empty identifier.
 *
 * The response bodies asserted against here are the shapes actually observed against the sandbox on
 * 2026-09-24 (a business refusal comes back as `{"errors":[{"Code":..,"Description":..}]}`, a bare
 * integer is what `POST /orders` answers with), not invented ones.
 */
import { vi } from 'vitest';

import { BillitApiError, BillitClient, extractInboxItemId } from './billit-client';

const CREDENTIALS = {
  baseUrl: 'https://api.sandbox.billit.be/v1',
  apiKey: 'key-1',
  partyId: '1234567',
};

function stubFetch(status: number, body: string) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('extractInboxItemId', () => {
  it('reads the documented `InboxItemID` key, whatever its casing and whether it is a number', () => {
    expect(extractInboxItemId({ InboxItemID: 3327952 })).toBe('3327952');
    expect(extractInboxItemId({ inboxItemId: '3327952' })).toBe('3327952');
  });

  it('accepts a bare identifier, which is how Billit answers some of its own POST endpoints', () => {
    expect(extractInboxItemId(3327952)).toBe('3327952');
    expect(extractInboxItemId('3327952')).toBe('3327952');
  });

  it('yields an EMPTY string for anything it cannot honestly read as an identifier', () => {
    expect(extractInboxItemId(null)).toBe('');
    expect(extractInboxItemId({})).toBe('');
    expect(extractInboxItemId({ SomethingElse: 1 })).toBe('');
    expect(extractInboxItemId({ InboxItemID: null })).toBe('');
  });
});

describe('BillitClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('sendPeppolXml', () => {
    it('posts the UBL in the JSON `XML` field, with BOTH the apikey and partyID headers', async () => {
      const fetchMock = stubFetch(200, '{"InboxItemID":3327952}');
      const result = await new BillitClient(CREDENTIALS).sendPeppolXml('<Invoice>x</Invoice>');

      expect(result.inboxItemId).toBe('3327952');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.sandbox.billit.be/v1/peppol/sendxml');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({ apikey: 'key-1', partyID: '1234567' });
      expect(JSON.parse(init.body)).toEqual({ XML: '<Invoice>x</Invoice>' });
    });

    it('turns a business refusal into a BillitApiError carrying the status and, when present, the code', async () => {
      stubFetch(
        400,
        '{"errors":[{"Code":"TheCustomerDoesNotSupportPeppolForType_0_","Description":"The customer does not support Peppol for type Invoice"}]}',
      );
      await expect(new BillitClient(CREDENTIALS).sendPeppolXml('<Invoice/>')).rejects.toThrow(BillitApiError);
      await expect(new BillitClient(CREDENTIALS).sendPeppolXml('<Invoice/>')).rejects.toThrow(
        /HTTP 400 \(TheCustomerDoesNotSupportPeppolForType_0_\): The customer does not support Peppol/,
      );
    });

    // A document breaking the same Peppol rule in two places comes back with ONE ENTRY PER XML
    // LOCATION - observed live 2026-09-24. Keeping only the first would hide half the reason the
    // deposit was refused, which is exactly what the seller needs in order to fix it.
    it('keeps EVERY entry of a multi-error refusal, never just the first', async () => {
      stubFetch(
        400,
        '{"errors":[' +
          '{"Code":"GenericError","Description":"Validation error: [PEPPOL-COMMON-R043] at Party.EndpointID"},' +
          '{"Code":"GenericError","Description":"Validation error: [PEPPOL-COMMON-R043] at PartyLegalEntity.CompanyID"}]}',
      );
      await expect(new BillitClient(CREDENTIALS).sendPeppolXml('<Invoice/>')).rejects.toThrow(
        /Party\.EndpointID \| .*PartyLegalEntity\.CompanyID/,
      );
    });

    // A gateway-level failure answers with an HTML error page, not JSON - observed live against an
    // unknown path. Parsing must never turn "Billit refused this" into an opaque JSON parse error.
    it('survives a non-JSON error body and still fails loudly', async () => {
      stubFetch(404, '<html><body>404 - File or directory not found.</body></html>');
      await expect(new BillitClient(CREDENTIALS).sendPeppolXml('<Invoice/>')).rejects.toThrow(/HTTP 404/);
    });

    // Never a silent success: the transport turns an empty identifier into a failed deposit, and it
    // can only do that if the client reports it honestly rather than inventing one.
    it('reports an EMPTY identifier rather than inventing one when the body carries none', async () => {
      stubFetch(200, '{"Something":"else"}');
      const result = await new BillitClient(CREDENTIALS).sendPeppolXml('<Invoice/>');
      expect(result.inboxItemId).toBe('');
    });
  });

  describe('getParticipantInformation', () => {
    it('reads the registration verdict and the document types back', async () => {
      const fetchMock = stubFetch(
        200,
        '{"Registered":true,"Identifier":"0208:0563846944","DocumentTypes":["BISv3Invoice","MLR"],"ServiceDetails":[]}',
      );
      const info = await new BillitClient(CREDENTIALS).getParticipantInformation('0208:0563846944');

      expect(info.registered).toBe(true);
      expect(info.documentTypes).toContain('BISv3Invoice');
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.sandbox.billit.be/v1/peppol/participantInformation/0208%3A0563846944',
      );
    });

    it('reports an unregistered participant as such, never as an error', async () => {
      stubFetch(200, '{"Registered":false,"Identifier":"0208:0437295999","DocumentTypes":[]}');
      const info = await new BillitClient(CREDENTIALS).getParticipantInformation('0208:0437295999');
      expect(info.registered).toBe(false);
      expect(info.documentTypes).toEqual([]);
    });
  });
});
