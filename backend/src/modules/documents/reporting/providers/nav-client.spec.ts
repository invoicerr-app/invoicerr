/**
 * `nav-client.ts`'s own cryptography, proven against NAV's OWN, OFFICIAL worked example — see that
 * file's own header, "VERIFIED, WITH AN OFFICIAL TEST VECTOR". This is the proof this codebase's own
 * `computeNavRequestSignature` produces NAV's own numbers, not merely internally-consistent ones.
 */
import { createCipheriv } from 'node:crypto';
import * as http from 'node:http';

import {
  buildNavClient,
  computeNavRequestSignature,
  decodeNavExchangeToken,
  NavApiError,
  navCompactTimestamp,
  sha3_512Hex,
  sha512Hex,
} from './nav-client';

/** Captured VERBATIM (2026-09-02) from a real, unauthenticated POST against
 *  `https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3/tokenExchange` — see this file's own
 *  header on `nav-client.ts`'s "LIVE-VERIFIED" section for the full account. This is a REAL response
 *  body, not invented — the whole reason `parseNavFunctionResult` reads `funcCode` from ANYWHERE in
 *  the document rather than requiring a `<result>` wrapper. */
const REAL_NAV_SCHEMA_VIOLATION_RESPONSE =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><GeneralExceptionResponse ' +
  'xmlns="http://schemas.nav.gov.hu/NTCA/1.0/common" xmlns:ns2="http://schemas.nav.gov.hu/EAR/2.0/api" ' +
  'xmlns:ns3="http://schemas.nav.gov.hu/EAR/2.0/data" xmlns:ns4="http://schemas.nav.gov.hu/EAR/2.0/base" ' +
  'xmlns:ns5="http://schemas.nav.gov.hu/SSO/1.0/authentication"><funcCode>ERROR</funcCode>' +
  '<errorCode>INVALID_REQUEST</errorCode><message>Érvénytelen kérés!</message><notifications>' +
  '<notification><notificationCode>SCHEMA_VIOLATION</notificationCode><notificationText>Request body ' +
  'contains on line: [1] and column: [5] error: [cvc-elt.1.a: Cannot find the declaration of element ' +
  "'x'.]</notificationText></notification></notifications></GeneralExceptionResponse>";

describe('parseNavFunctionResult — against a REAL, captured NAV error response (no <result> wrapper)', () => {
  it('a GeneralExceptionResponse (bare funcCode/errorCode/message, no <result>) surfaces as a named NavApiError', async () => {
    const server = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(REAL_NAV_SCHEMA_VIOLATION_RESPONSE);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('stub did not bind');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const client = buildNavClient(
        {
          login: 'x',
          password: 'y',
          taxNumber: '12345678',
          signingKey: 'z',
          exchangeKey: 'ABCDEFGH12345678',
        },
        baseUrl,
      );

      await expect(client.tokenExchange()).rejects.toThrow(NavApiError);
      await expect(client.tokenExchange()).rejects.toThrow(/INVALID_REQUEST/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('NAV request signature — official worked example (interface spec §1.5.1)', () => {
  const REQUEST_ID = 'TSTKFT1222564';
  const TIMESTAMP = new Date('2017-12-30T18:25:45.000Z');
  const SIGNING_KEY = 'ce-8f5e-215119fa7dd621DLMRHRLH2S';

  it('navCompactTimestamp strips separators and the timezone, per §1.5.1', () => {
    expect(navCompactTimestamp(TIMESTAMP)).toBe('20171230182545');
  });

  it("reproduces the spec's own intermediate index hashes, byte for byte", () => {
    expect(sha3_512Hex('CREATE' + 'QWJjZDEyMzQ=')).toBe(
      '4317798460962869BC67F07C48EA7E4A3AFA301513CEB87B8EB94ECF92BC220A89C480F87F0860E85E29A3B6C0463D4F29712C5AD48104A6486CE839DC2F24CB',
    );
    expect(sha3_512Hex('MODIFY' + 'RGNiYTQzMjE=')).toBe(
      'A881218238933F6FFB9E167445CB4DAA9749BCF484FDE48AB7649FD25E8B634A4736A65A7C4A8E2831119F739837E006566F97370415AAD55E268605206F2A6C',
    );
  });

  // THE test vector: requestId + compact timestamp + signing key + the two index hashes above,
  // hashed once more with SHA3-512 and uppercased — the spec's OWN final requestSignature value.
  it("computeNavRequestSignature matches the spec's own final requestSignature value EXACTLY", () => {
    const signature = computeNavRequestSignature(REQUEST_ID, navCompactTimestamp(TIMESTAMP), SIGNING_KEY, [
      { index: 1, invoiceOperation: 'CREATE', invoiceDataBase64: 'QWJjZDEyMzQ=' },
      { index: 2, invoiceOperation: 'MODIFY', invoiceDataBase64: 'RGNiYTQzMjE=' },
    ]);

    expect(signature).toBe(
      '60BC80609EE3B8F42FE904200A49A1921A1DADA08D55319ACD40C59F626514B74EEA49011D372600A10DBCF8199D590DA9C2841D987308F2D83DAE17C2470C42',
    );
  });

  it('index order is normalized — a shuffled input array still hashes in ascending index order', () => {
    const inOrder = computeNavRequestSignature(REQUEST_ID, navCompactTimestamp(TIMESTAMP), SIGNING_KEY, [
      { index: 1, invoiceOperation: 'CREATE', invoiceDataBase64: 'QWJjZDEyMzQ=' },
      { index: 2, invoiceOperation: 'MODIFY', invoiceDataBase64: 'RGNiYTQzMjE=' },
    ]);
    const shuffled = computeNavRequestSignature(REQUEST_ID, navCompactTimestamp(TIMESTAMP), SIGNING_KEY, [
      { index: 2, invoiceOperation: 'MODIFY', invoiceDataBase64: 'RGNiYTQzMjE=' },
      { index: 1, invoiceOperation: 'CREATE', invoiceDataBase64: 'QWJjZDEyMzQ=' },
    ]);
    expect(shuffled).toBe(inOrder);
  });

  // §1.5.2 — outside manageInvoice/manageAnnulment, requestSignature is JUST the partial hash, no
  // index hashes appended at all.
  it('with no operations at all (tokenExchange/queryTransactionStatus), the signature is the bare partial hash', () => {
    const signature = computeNavRequestSignature(REQUEST_ID, navCompactTimestamp(TIMESTAMP), SIGNING_KEY);
    const expectedPartial = sha3_512Hex(REQUEST_ID + navCompactTimestamp(TIMESTAMP) + SIGNING_KEY);
    expect(signature).toBe(expectedPartial);
  });
});

describe('NAV passwordHash — SHA-512, NOT SHA3-512 (spec §890/§8150, a DIFFERENT algorithm)', () => {
  it('is 128 hex chars, uppercase, and differs from the SHA3-512 digest of the same input', () => {
    const password = 'correct horse battery staple';
    const hash512 = sha512Hex(password);
    const hash3_512 = sha3_512Hex(password);
    expect(hash512).toMatch(/^[0-9A-F]{128}$/);
    expect(hash3_512).toMatch(/^[0-9A-F]{128}$/);
    expect(hash512).not.toBe(hash3_512);
  });
});

describe('NAV exchange-token AES-128-ECB/PKCS5 decode (spec §1514-1515, §9814)', () => {
  it('round-trips a token this test itself encrypts with the same key/algorithm', () => {
    // Simulates what NAV's own server would do — encrypt a plaintext token with the technical
    // user's replacement key, AES-128-ECB, PKCS5 (== PKCS7 for a 16-byte block) padding, the SAME
    // primitive `decodeNavExchangeToken` uses in reverse — proving the ROUND TRIP is internally
    // consistent, never that NAV's own key-derivation convention (untested against a real key — see
    // this file's own header) is right.
    const exchangeKey = 'ABCDEFGH12345678'; // 16 ASCII bytes = a valid AES-128 key as-is
    const plaintext = 'SGVsbG9Ub2tlbg=='; // a fictitious "decoded token" value
    const cipher = createCipheriv('aes-128-ecb', Buffer.from(exchangeKey, 'utf8').subarray(0, 16), null);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');

    expect(decodeNavExchangeToken(encrypted, exchangeKey)).toBe(plaintext);
  });

  it('a longer key (the realistic case) still decodes — only its first 16 bytes are used as the AES key', () => {
    const longerKey = 'ABCDEFGH12345678-EXTRA-TAIL-BYTES';
    const plaintext = 'token-value';
    const cipher = createCipheriv('aes-128-ecb', Buffer.from(longerKey, 'utf8').subarray(0, 16), null);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');

    expect(decodeNavExchangeToken(encrypted, longerKey)).toBe(plaintext);
  });

  it('a key shorter than 16 bytes is refused, named, rather than silently padded/truncated wrong', () => {
    expect(() => decodeNavExchangeToken('AAAA', 'short')).toThrow(/at least 16 bytes/);
  });
});
