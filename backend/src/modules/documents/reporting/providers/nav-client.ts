/**
 * The NAV Online Számla 3.0 wire-level client — HTTP + cryptography ONLY, no `DeclaredInvoice`
 * knowledge (that lives in `nav-declaration-provider.ts`). Every fact below is either VERIFIED
 * (cited with the exact source and, for the signature, an OFFICIAL worked example this file's own
 * spec (`nav-client.spec.ts`) reproduces byte-for-byte) or explicitly marked EXTRAPOLATED.
 *
 * ## LIVE-VERIFIED, credential-free (2026-09-02) — see `nav.live.spec.ts`'s own reachability block
 *
 * `https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3/tokenExchange` is REACHABLE from this
 * environment and answers a real (schema-invalid) POST in ~250ms with:
 * `<GeneralExceptionResponse ...><funcCode>ERROR</funcCode><errorCode>INVALID_REQUEST</errorCode>
 * <message>Érvénytelen kérés!</message>...</GeneralExceptionResponse>` — confirming the host, the
 * path, and the `funcCode`/`errorCode`/`message` vocabulary live, not merely from the PDF spec. This
 * ALSO revealed a real gap this task's own reading of the spec alone had missed: a schema-invalid
 * request's `funcCode` is NOT nested under `<result>` the way a well-formed operation response's own
 * `BasicResultType` is (per the spec's own tables) — it rides bare inside a DIFFERENT root element,
 * `GeneralExceptionResponse`. `parseNavFunctionResult` below was fixed to read `funcCode`/`errorCode`/
 * `message` from ANYWHERE in the document for exactly this reason.
 *
 * ## Sources actually read for this file (2026-09-02)
 *
 *  - The OFFICIAL NAV GitHub repository, `nav-gov-hu/Online-Invoice` (docs/API docs/en/ + src/schemas/):
 *    the interface specification PDF ("Online Szamla_Interfesz specifikacio_EN_v3.0.pdf", extracted
 *    with `pdftotext`, since onlineszamla.nav.gov.hu itself renders only an empty JavaScript shell to
 *    a plain HTTP request from this environment) and `src/schemas/nav/gov/hu/OSA/invoiceApi.xsd`.
 *  - The OFFICIAL NAV common-types repository, `nav-gov-hu/Common` (tag `Common-1.0.RC3`,
 *    `src/schemas/nav/gov/hu/NTCA/common.xsd`) — `UserHeaderType`/`BasicHeaderType`/`CryptoType`.
 *
 * ## VERIFIED — base URLs, context root, resources (spec §1.6.1/§1.6.2, and the repo's own README)
 *
 *  - Test: `https://api-test.onlineszamla.nav.gov.hu` ; Production: `https://api.onlineszamla.nav.gov.hu`
 *  - Context root: `/invoiceService/v3` ; resources used here: `/tokenExchange`, `/manageInvoice`,
 *    `/queryTransactionStatus`. `content-type: application/xml`, `accept: application/xml` (spec
 *    §1.6.3). A CORRECTLY FORMATTED request always gets HTTP 200 — business errors are carried
 *    INSIDE the XML body (spec §1.6.4), never a 4xx/5xx, which is why `parseNavResult` below reads
 *    `<result><funcCode>` rather than the HTTP status.
 *
 * ## VERIFIED — authentication header (common.xsd's own `UserHeaderType`/`BasicHeaderType`)
 *
 *  - `header`: `requestId` (`EntityIdType`, `[+a-zA-Z0-9_]{1,30}` — the SAME pattern the schema gives
 *    `transactionId`), `timestamp` (UTC), `requestVersion` = "3.0".
 *  - `user`: `login`, `passwordHash` (`CryptoType cryptoType="SHA-512"` — spec §890/§8150: "The
 *    passwordHash is the SHA-512 hash value, IN CAPITAL LETTERS, of the technical user password"),
 *    `taxNumber` (first 8 digits), `requestSignature` (`CryptoType cryptoType="SHA3-512"`).
 *
 * ## VERIFIED, WITH AN OFFICIAL TEST VECTOR — `requestSignature` (spec §1.5, "Calculating
 * requestSignature")
 *
 * For `/manageInvoice` (and `/manageAnnulment`): SHA3-512, uppercase hex, of
 * `requestId + timestamp(YYYYMMDDhhmmss, UTC, no separators) + signingKey`, followed by ONE
 * SHA3-512 hash per invoice index (`invoiceOperation + base64(invoiceData)`, concatenated in index
 * order), the whole thing hashed AGAIN with SHA3-512. For every OTHER operation (tokenExchange,
 * queryTransactionStatus, …) it is simply that same partial hash, with no index hashes appended
 * (spec §1.5.2). The spec's own worked example (requestId `TSTKFT1222564`, timestamp
 * `2017-12-30T18:25:45.000Z`, signingKey `ce-8f5e-215119fa7dd621DLMRHRLH2S`, two index operations)
 * is reproduced VERBATIM, including its own intermediate hash values, by
 * `nav-client.spec.ts#navRequestSignature` — this file's OWN implementation is checked against NAV's
 * own numbers, not merely against itself. `node:crypto`'s `'sha3-512'` digest was confirmed to exist
 * and to match FIPS 202 by running that exact test vector (this task's own instructions flagged this
 * as needing a check — it does exist, in this Node runtime, and it matches).
 *
 * ## VERIFIED — `/manageInvoice`'s own request shape (spec §1.8.2.1, and invoiceApi.xsd)
 *
 * `exchangeToken` (the DECODED token — see below), `compressedContent` (false — this client never
 * gzips), one `invoiceOperation` per invoice: `index` (1-based, contiguous, spec's own rule — this
 * client only ever submits ONE invoice per call, so `index` is always `1`), `invoiceOperation`
 * ("CREATE" — an original invoice; the only value this task's own trigger ever needs, see
 * `nav-declaration-provider.ts`'s own header on why MODIFY/STORNO are out of scope), `invoiceData`
 * (base64 of the invoice XML), and `electronicInvoiceHash` (OPTIONAL at schema level unless
 * `completenessIndicator` is true — never set by this client, so this field is omitted entirely,
 * exactly matching the schema's own `minOccurs="0"`).
 *
 * ## VERIFIED — `/tokenExchange`'s response and the AES-128-ECB decode step (spec §1.8.10.2, §1514)
 *
 * `encodedExchangeToken` (base64) must be decoded with "the AES-128 ECB encryption algorithm on the
 * technical user's replacement key" before it can be used in `/manageInvoice`'s own `exchangeToken`
 * field — confirmed twice, verbatim, at spec lines 1514-1515 and 1635-1636. AES-128-ECB with PKCS5
 * padding is ALSO independently confirmed by the spec's own external reference list (§9814:
 * "AES-128 ECB online decode: https://8gwifi.org/CipherFunctions.jsp (Select the AES ECB
 * PKCS5PADDING option)").
 *
 * ## EXTRAPOLATED — NOT verified against the primary source in hand
 *
 *  - The EXACT byte encoding of "the technical user's replacement key" as an AES-128 key. AES-128
 *    needs a 16-byte key; nothing in the text extracted from the interface-specification PDF states
 *    how a (typically longer, e.g. 32-character) generated replacement key is turned into exactly 16
 *    key bytes. This client takes the FIRST 16 bytes of the UTF-8 encoding of the exchange key
 *    (`exchangeKeyToAesKey` below) — the convention several independent, widely-used community NAV
 *    client implementations follow — but this was NOT read from an official NAV source, and is
 *    UNTESTED against a real NAV-issued key (no NAV sandbox credentials were available to this task
 *    — see `CREDENTIALS_GUIDE.md`'s own NAV section for why, and for the registration process that
 *    WAS read).
 *  - `invoiceData.xsd`'s own business-content schema (the actual Hungarian invoice XML NAV expects
 *    inside `invoiceData`) was NOT read in full (it is a very large, highly Hungary-specific schema)
 *    — `nav-declaration-provider.ts#buildNavInvoiceXml` builds a DELIBERATELY MINIMAL subset (the
 *    header/parties/lines/summary fields this task's own `DeclaredInvoice` actually carries), marked
 *    as such in that file's own header, not a claim of full `invoiceData.xsd` conformance.
 *  - `queryTransactionStatus`'s own polling cadence/backoff (how long after `/manageInvoice` a
 *    caller should wait before the processing result is actually available) is not specified as a
 *    fixed number anywhere in the text extracted — this client polls it ONCE, immediately, and
 *    reports whatever `invoiceStatus` it gets back (including a non-terminal one, e.g. "RECEIVED" or
 *    "PROCESSING" — see `nav-declaration-provider.ts`'s own header on why that is still an honest,
 *    journalable outcome, not a failure).
 *  - Whether `header`/`user`/`software` (and their own children) must be emitted namespace-QUALIFIED
 *    under the `common`/`api` namespaces on the wire, or bare/unqualified. `BasicHeaderType`/
 *    `UserHeaderType` are DEFINED inside `common.xsd`'s own target namespace
 *    (`http://schemas.nav.gov.hu/NTCA/1.0/common`); whether `common.xsd` itself declares
 *    `elementFormDefault="qualified"` (which would require a `common:` prefix on `header`/`user`
 *    themselves, not merely on the root) was NOT confirmed — the fetched `invoiceApi.xsd` excerpt
 *    covers only the `api` namespace's own top-level types, and `common.xsd` was read for its TYPE
 *    definitions (`UserHeaderType`, `CryptoType`, …) but not re-checked for that one schema-level
 *    attribute. `buildNavEnvelope`/`buildNavClient` below emit them UNPREFIXED, inheriting the root
 *    element's own default namespace — the same shape a schema WITHOUT `elementFormDefault:
 *    "qualified"` on `common.xsd` would expect. This is the single largest "verified the fields, not
 *    the wire bytes" gap in this file, and exactly why `NAV_LIVE=1` (a real sandbox round-trip) is
 *    the only thing that could actually settle it — see `CREDENTIALS_GUIDE.md`.
 */
import { createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { create } from 'xmlbuilder2';

import { firstByLocalName, parseXml, textOf } from '../../transports/sdi/xml-helpers';

export const NAV_TEST_BASE_URL = 'https://api-test.onlineszamla.nav.gov.hu';
export const NAV_PROD_BASE_URL = 'https://api.onlineszamla.nav.gov.hu';
export const NAV_CONTEXT_ROOT = '/invoiceService/v3';
export const NAV_REQUEST_VERSION = '3.0';
export const NAV_HEADER_VERSION = '1.0';

export interface NavCredentials {
  login: string;
  password: string;
  taxNumber: string;
  signingKey: string;
  exchangeKey: string;
  /** OPTIONAL override of the fixed per-environment host (`NAV_TEST_BASE_URL`/`NAV_PROD_BASE_URL`) —
   *  same "a company CAN point this at a mirror/stub, but never has to" escape hatch
   *  `transports/pdp-transport.ts`/`transports/sdi-transport.ts` already offer for their own
   *  platform URL, and precisely what lets `nav-declaration-provider.spec.ts` and the Cypress spec
   *  (41) exercise the REAL flow against a local stub rather than the real NAV sandbox host. Absent
   *  for the overwhelming majority of real connections, which use the fixed host for their chosen
   *  environment. */
  baseUrl?: string;
}

/** SHA3-512, uppercase hex — the ONE hash algorithm `requestSignature`'s own `cryptoType` accepts
 *  (spec §906-907, §8152). */
export function sha3_512Hex(input: string): string {
  return createHash('sha3-512').update(input, 'utf8').digest('hex').toUpperCase();
}

/** SHA-512, uppercase hex — `passwordHash`'s own `cryptoType` (spec §890, §904, §8150) — a
 *  DIFFERENT algorithm from `requestSignature`'s, confirmed by two independent passages naming each
 *  one explicitly. */
export function sha512Hex(input: string): string {
  return createHash('sha512').update(input, 'utf8').digest('hex').toUpperCase();
}

/** `YYYYMMDDhhmmss`, UTC, no separators — spec §1.5.1: "UTC timestamp tag value using a
 *  YYYYMMDDhhmmss mask [...] the date and time separators as well as the time zone must be removed
 *  for timestamp masking." */
export function navCompactTimestamp(date: Date): string {
  const iso = date.toISOString(); // "2017-12-30T18:25:45.000Z"
  return (
    iso.slice(0, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19)
  );
}

/** A plain ISO-8601 timestamp WITH separators — what `header/timestamp` itself carries on the wire
 *  (`GenericTimestampType`, unlike the compact form `requestSignature` hashes over). */
export function navIsoTimestamp(date: Date): string {
  return date.toISOString();
}

/** `EntityIdType`: `[+a-zA-Z0-9_]{1,30}` (common.xsd) — built from the document id (already a cuid,
 *  alnum-only) plus a short random suffix so two declarations for the SAME document (a genuine retry,
 *  after a previous requestId was already consumed server-side) never collide on requestId. */
export function buildNavRequestId(documentId: string): string {
  const sanitized = documentId.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
  const suffix = randomBytes(4).toString('hex'); // 8 hex chars, [0-9a-f] ⊂ [a-zA-Z0-9_]
  return `${sanitized}${suffix}`.slice(0, 30);
}

/** One `invoiceOperation` entry, `index`-ordered — see this file's own header on why this client
 *  only ever submits index 1. */
export interface NavInvoiceOperation {
  index: number;
  invoiceOperation: 'CREATE' | 'MODIFY' | 'STORNO';
  invoiceDataBase64: string;
}

/** Spec §1.5.1's own two-stage algorithm — see this file's header for the FULL worked-example proof
 *  (`nav-client.spec.ts`). Exported directly (not merely used internally) so that spec can assert on
 *  it in isolation, pinned to NAV's own numbers, before ever touching HTTP. */
export function computeNavRequestSignature(
  requestId: string,
  timestamp: string,
  signingKey: string,
  operations: NavInvoiceOperation[] = [],
): string {
  const partial = requestId + timestamp + signingKey;
  const indexHashes = operations
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((op) => sha3_512Hex(op.invoiceOperation + op.invoiceDataBase64))
    .join('');
  return sha3_512Hex(partial + indexHashes);
}

/**
 * AES-128-ECB/PKCS5 decode of `encodedExchangeToken` — see this file's own header, "EXTRAPOLATED",
 * for the one unverified detail (how a longer replacement key is reduced to exactly 16 AES-128 key
 * bytes: the first 16 bytes of its UTF-8 encoding, here).
 */
export function decodeNavExchangeToken(encodedExchangeTokenBase64: string, exchangeKey: string): string {
  const keyBytes = Buffer.from(exchangeKey, 'utf8').subarray(0, 16);
  if (keyBytes.length < 16) {
    throw new Error(
      `NAV exchange key must be at least 16 bytes long once UTF-8 encoded (got ${keyBytes.length}).`,
    );
  }
  const decipher = createDecipheriv('aes-128-ecb', keyBytes, null);
  const decoded = Buffer.concat([
    decipher.update(Buffer.from(encodedExchangeTokenBase64, 'base64')),
    decipher.final(),
  ]);
  return decoded.toString('utf8');
}

export interface NavBasicHeader {
  requestId: string;
  timestamp: Date;
}

/** Builds the full envelope (`header` + `user` + `software`) every `/invoiceService/v3` operation
 *  shares — `BasicOnlineInvoiceRequestType` (invoiceApi.xsd) — as a plain object this client then
 *  serializes to XML. `software` fields are this product's own (never guessed from NAV's own
 *  taxonomy beyond what `SoftwareOperationType`'s own enum requires, `LOCAL_SOFTWARE`). */
export function buildNavEnvelope(
  credentials: NavCredentials,
  header: NavBasicHeader,
  requestSignature: string,
): Record<string, unknown> {
  return {
    header: {
      requestId: header.requestId,
      timestamp: navIsoTimestamp(header.timestamp),
      requestVersion: NAV_REQUEST_VERSION,
      headerVersion: NAV_HEADER_VERSION,
    },
    user: {
      login: credentials.login,
      passwordHash: { '#text': sha512Hex(credentials.password), '@cryptoType': 'SHA-512' },
      taxNumber: credentials.taxNumber,
      requestSignature: { '#text': requestSignature, '@cryptoType': 'SHA3-512' },
    },
    software: {
      softwareId: 'INVOICERR0000000001',
      softwareName: 'Invoicerr',
      softwareOperation: 'LOCAL_SOFTWARE',
      softwareMainVersion: '1',
      softwareDevName: 'Invoicerr',
      softwareDevContact: 'support@invoicerr.app',
    },
  };
}

/** The three responses this client ever parses — deliberately narrow (never the FULL
 *  `BasicOnlineInvoiceResponseType`, most of which this task's own trigger has no use for). */
export interface NavFunctionResult {
  funcCode: string;
  errorCode?: string;
  message?: string;
}

export class NavApiError extends Error {
  constructor(public readonly result: NavFunctionResult) {
    super(
      `NAV returned funcCode="${result.funcCode}"` +
        (result.errorCode ? ` (${result.errorCode})` : '') +
        (result.message ? `: ${result.message}` : ''),
    );
    this.name = 'NavApiError';
  }
}

/** Reads `<result><funcCode>…</funcCode>…</result>` — VERIFIED shape (spec §"General
 *  ResultType"/§1.6.4: a correctly-formatted request always answers HTTP 200, business success/
 *  failure is carried inside this element, never the HTTP status). Namespace-prefix agnostic — the
 *  same defensive stance `sdi/xml-helpers.ts`'s own header holds, reused here rather than
 *  reimplemented. */
/**
 * Reads `funcCode`/`errorCode`/`message` from ANYWHERE in the document — NOT only nested under a
 * `<result>` element, even though every WELL-FORMED operation response (`TokenExchangeResponse`,
 * `ManageInvoiceResponse`, …) nests them there (`BasicResultType`, spec's own tables). LIVE-VERIFIED
 * necessary (2026-09-02, a real, unauthenticated `curl` against `api-test.onlineszamla.nav.gov.hu`,
 * see `nav.live.spec.ts`'s own credential-free reachability block): a request NAV cannot even
 * schema-validate answers with a DIFFERENT root element, `GeneralExceptionResponse`, carrying
 * `funcCode`/`errorCode`/`message` as BARE children with no `<result>` wrapper at all —
 * `firstByLocalName` already searches the whole subtree (`getElementsByTagNameNS('*', …)`), so
 * reading straight off the document handles BOTH shapes without needing to know which one a given
 * response actually used.
 */
function parseNavFunctionResult(xml: string): NavFunctionResult {
  const { doc, errors } = parseXml(xml);
  if (errors.length > 0) {
    throw new Error(`NAV response could not be parsed as XML: ${errors.join('; ')}`);
  }
  const funcCode = textOf(firstByLocalName(doc, 'funcCode'));
  if (!funcCode) {
    throw new Error('NAV response carries no funcCode — cannot tell success from failure.');
  }
  return {
    funcCode,
    errorCode: textOf(firstByLocalName(doc, 'errorCode')),
    message: textOf(firstByLocalName(doc, 'message')),
  };
}

function throwIfNavError(xml: string): NavFunctionResult {
  const result = parseNavFunctionResult(xml);
  if (result.funcCode !== 'OK') throw new NavApiError(result);
  return result;
}

async function postNavXml(url: string, body: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', accept: 'application/xml' },
    body,
  });
  const text = await res.text();
  // Spec §1.6.4 — a well-formed request always gets HTTP 200 (errors ride inside the XML body); a
  // non-200 here means the request itself was malformed/misrouted (e.g. hit the wrong endpoint), not
  // an ordinary business rejection — surfaced with the raw body so it can be diagnosed.
  if (!res.ok) {
    throw new Error(`NAV HTTP ${res.status} calling ${url}: ${text.slice(0, 500)}`);
  }
  return text;
}

export interface NavClient {
  /** POST /tokenExchange — returns the DECODED (AES-128-ECB) exchange token, ready to use in
   *  `manageInvoice`'s own `exchangeToken` field. */
  tokenExchange(): Promise<string>;
  /** POST /manageInvoice — submits exactly ONE original ("CREATE") invoice and returns the
   *  server-issued `transactionId` (spec §1.8.2.2). */
  manageInvoice(exchangeToken: string, invoiceDataBase64: string): Promise<string>;
  /** POST /queryTransactionStatus — the invoice's own `invoiceStatus` for `transactionId`'s index 1
   *  (spec §1.8.8.2), and the raw XML the response was parsed from. */
  queryTransactionStatus(transactionId: string): Promise<{ invoiceStatus: string; rawXml: string }>;
}

export function buildNavClient(credentials: NavCredentials, baseUrl: string): NavClient {
  function endpoint(resource: string): string {
    return `${baseUrl}${NAV_CONTEXT_ROOT}${resource}`;
  }

  function envelopeFor(operationRoot: string, requestId: string, timestamp: Date, requestSignature: string) {
    return {
      [operationRoot]: {
        '@xmlns': 'http://schemas.nav.gov.hu/OSA/3.0/api',
        '@xmlns:common': 'http://schemas.nav.gov.hu/NTCA/1.0/common',
        ...buildNavEnvelope(credentials, { requestId, timestamp }, requestSignature),
      },
    };
  }

  return {
    async tokenExchange() {
      const requestId = buildNavRequestId('tokenxch');
      const timestamp = new Date();
      const signature = computeNavRequestSignature(
        requestId,
        navCompactTimestamp(timestamp),
        credentials.signingKey,
      );
      const body = create(envelopeFor('TokenExchangeRequest', requestId, timestamp, signature)).end({
        headless: true,
      });
      const xml = await postNavXml(endpoint('/tokenExchange'), body);
      throwIfNavError(xml);
      const { doc } = parseXml(xml);
      const encoded = textOf(firstByLocalName(doc, 'encodedExchangeToken'));
      if (!encoded) throw new Error('NAV /tokenExchange response carries no encodedExchangeToken.');
      return decodeNavExchangeToken(encoded, credentials.exchangeKey);
    },

    async manageInvoice(exchangeToken: string, invoiceDataBase64: string) {
      const requestId = buildNavRequestId('mnginv');
      const timestamp = new Date();
      const operations: NavInvoiceOperation[] = [{ index: 1, invoiceOperation: 'CREATE', invoiceDataBase64 }];
      const signature = computeNavRequestSignature(
        requestId,
        navCompactTimestamp(timestamp),
        credentials.signingKey,
        operations,
      );
      const envelope = envelopeFor('ManageInvoiceRequest', requestId, timestamp, signature) as Record<
        string,
        Record<string, unknown>
      >;
      envelope.ManageInvoiceRequest.exchangeToken = exchangeToken;
      envelope.ManageInvoiceRequest.compressedContent = false;
      envelope.ManageInvoiceRequest.invoiceOperations = {
        invoiceOperation: operations.map((op) => ({
          index: op.index,
          invoiceOperation: op.invoiceOperation,
          invoiceData: op.invoiceDataBase64,
        })),
      };
      const body = create(envelope).end({ headless: true });
      const xml = await postNavXml(endpoint('/manageInvoice'), body);
      throwIfNavError(xml);
      const { doc } = parseXml(xml);
      const transactionId = textOf(firstByLocalName(doc, 'transactionId'));
      if (!transactionId) throw new Error('NAV /manageInvoice response carries no transactionId.');
      return transactionId;
    },

    async queryTransactionStatus(transactionId: string) {
      const requestId = buildNavRequestId('qrytxn');
      const timestamp = new Date();
      const signature = computeNavRequestSignature(
        requestId,
        navCompactTimestamp(timestamp),
        credentials.signingKey,
      );
      const envelope = envelopeFor(
        'QueryTransactionStatusRequest',
        requestId,
        timestamp,
        signature,
      ) as Record<string, Record<string, unknown>>;
      envelope.QueryTransactionStatusRequest.transactionId = transactionId;
      const body = create(envelope).end({ headless: true });
      const rawXml = await postNavXml(endpoint('/queryTransactionStatus'), body);
      throwIfNavError(rawXml);
      const { doc } = parseXml(rawXml);
      // `processingResults/processingResult/invoiceStatus` (spec §1.8.8.2) — this client only ever
      // submits ONE invoice per transaction (index 1), so the FIRST `invoiceStatus` in document order
      // is unambiguous.
      const invoiceStatus = textOf(firstByLocalName(doc, 'invoiceStatus'));
      if (!invoiceStatus) throw new Error('NAV /queryTransactionStatus response carries no invoiceStatus.');
      return { invoiceStatus, rawXml };
    },
  };
}
