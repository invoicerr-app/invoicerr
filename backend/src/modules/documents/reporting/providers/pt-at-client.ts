/**
 * The Portuguese AT (Autoridade Tributária e Aduaneira) "comunicação de faturas" SOAP webservice
 * client — HTTP + cryptography ONLY, no `DeclaredInvoice` knowledge (that lives in
 * `pt-declaration-provider.ts`, the same split `nav-client.ts`/`nav-declaration-provider.ts` already
 * hold). Status: **implemented to the documented AT contract, awaiting accreditation** — exactly
 * `transports/sdi/sdicoop-client.ts`'s own posture. This has NEVER been run against a real AT
 * endpoint (no "subutilizador" credential or AT public key was available) — every fact
 * below is either VERIFIED against the primary manuals (cited, quoted) or explicitly marked
 * EXTRAPOLATED/⚠ UNVERIFIED. A green `pt-at-client.spec.ts` proves the STRUCTURE this file builds,
 * never that AT accepts it — see `LIVE_TESTING.md`'s own standing warning about mocked-green ≠ live.
 *
 * ## Sources actually read for this file (2026-09-11), both from the OFFICIAL `info.portaldasfinancas.gov.pt` domain
 *
 *  - "Manual de Integração de Software – e-Fatura: Comunicação por webservice - Aspetos genéricos"
 *    (v2.0, Oct. 2025) —
 *    https://info.portaldasfinancas.gov.pt/pt/apoio_ao_contribuinte/Outras_entidades/Suporte_tecnologico/Webservice/e_Fatura/Documents/Comunicacao_dos_elementos_dos_documentos_de_faturacao_aspetos_gerais.pdf
 *    — the SOAP Header / WS-Security scheme (§2.2.1), the implementation phases, the HTTPS
 *    endpoints (§3.7), and the mTLS/CSR client-certificate requirement (§2.3).
 *  - "Manual de Integração de Software – e-Fatura: Comunicação por Webservice - Aspetos Específicos"
 *    (v3.0, Oct. 2025) —
 *    https://info.portaldasfinancas.gov.pt/pt/apoio_ao_contribuinte/Outras_entidades/Suporte_tecnologico/Webservice/e_Fatura/Documents/Comunicacao_dos_elementos_dos_documentos_de_faturacao.pdf
 *    — the `RegisterInvoiceRequest`/`RegisterInvoiceResponse` field tables (§2.1.1.1/§2.1.1.2) and a
 *    FULL worked SOAP example (§2.1.1.3), reproduced structurally by this client and by
 *    `pt-at-client.spec.ts`.
 *  - Both PDFs were fetched directly with `curl` (a plain HTTP GET renders the real, static PDF —
 *    unlike `diariodarepublica.pt`/`onlineszamla.nav.gov.hu`/`aade.gr`, which were already found to
 *    render only an empty JavaScript shell to a plain request) and read
 *    with `pdftotext -layout`.
 *  - `Fatcorews.wsdl` itself (the field-level WSDL both manuals point to,
 *    `info.portaldasfinancas.gov.pt/.../Fatcorews/Documents/Fatcorews.wsdl`) returned HTTP 404 from
 *    this environment — the manuals' own field tables and the ONE full worked SOAP example are what
 *    this file is built from, not the WSDL's own wire-level binding declaration (SOAPAction value,
 *    document/literal vs RPC style — see "EXTRAPOLATED" below).
 *
 * ## VERIFIED — HTTPS endpoints (Aspetos Genéricos §2.1.2/§2.1.3/§3.7, quoted verbatim)
 *
 *  - Test: "https://servicos.portaldasfinancas.gov.pt:723/fatcorews/ws/"
 *  - Production: "https://servicos.portaldasfinancas.gov.pt:423/fatcorews/ws/"
 *  - NOTE the non-standard ports (723 test / 423 production, NEITHER is 443) — easy to get wrong by
 *    assuming a default HTTPS port; both are quoted directly from the manual's own §3.7 "Endereços
 *    Úteis" table, not inferred.
 *
 * ## VERIFIED — the WS-Security `SOAP: Header` scheme (Aspetos Genéricos §2.2.1, quoted/paraphrased
 * field by field; the worked example at §2.2.1.1 is reproduced byte-for-shape by
 * `pt-at-client.spec.ts`)
 *
 * "O SOAP: Header é construído de acordo com o standard WS-Security, definido pela OASIS e
 * recorrendo à definição do Username Token Profile 1.1" — a `wss:UsernameToken` with FOUR fields,
 * every string UTF-8 encoded ("Todas as cadeias de caracteres (strings) aqui referidas devem ser
 * codificadas em UTF-8"):
 *
 *  1. **H.1 Username** — `"<NIF do emitente>/<UserId>"` (e.g. "555555555/1234") — sent IN THE CLEAR,
 *     never encrypted. VERIFIED, no ambiguity.
 *  2. **H.3 Nonce FIRST** (read before H.2/H.4 below — it is the key everything else is encrypted
 *     with): "Chave simétrica gerada a cada pedido... Cada invocação do webservice deverá conter
 *     esta chave gerada aleatoriamente e a qual não pode ser repetida" — a FRESH 128-bit (16-byte)
 *     AES key per request (`crypto.randomBytes(16)` — a CSPRNG, matching this codebase's own
 *     already-established "signature durcie" posture of never using a weaker RNG for anything
 *     security-relevant). The manual's own formula: `Nonce := Base64(C_RSA,KpubSA(Ks))` — the AES key
 *     itself is then RSA-encrypted with the AT public key and base64'd. VERIFIED: RSA algorithm,
 *     base64 encoding, "the AT public key must be obtained per §2.1.1 of this manual" (i.e. a
 *     per-environment credential requested from AT by email, NEVER hardcoded — see
 *     `PtAtCredentials.authPublicKeyPem` below).
 *     ⚠ UNVERIFIED: the exact RSA padding scheme. The manual names the algorithm ("RSA") but no
 *     padding/OAEP parameters anywhere in either PDF. Node's OWN default for `crypto.publicEncrypt`
 *     is OAEP (confirmed empirically: encrypting with the default padding and then
 *     decrypting with `RSA_PKCS1_PADDING` explicitly does NOT reproduce the plaintext — the two are
 *     genuinely different schemes, not interchangeable). This client uses `RSA_PKCS1_PADDING`
 *     (classic PKCS#1 v1.5) — the conventional default for legacy Java/.NET government webservices of
 *     this exact vintage/shape when no OAEP parameters are named — but this is a DOCUMENTED BEST
 *     READING, not a confirmed fact. What would settle it: a real AT public key plus a live round-trip
 *     (`PT_AT_LIVE=1`, `pt-declaration-provider.live.spec.ts`) — a wrong padding choice fails loudly
 *     at AT's own decryption step (`CodigoResposta` 16/17 — "Chave de sessão inválida. Não foi
 *     possível decifrar o campo Created/Password"), it does not silently corrupt data.
 *  3. **H.2 Password**: `Base64(AES_Ks,ECB,PKCS5Padding(SenhaPF))` — the subutilizador's OWN Portal
 *     das Finanças password, AES-encrypted (ECB mode, PKCS5 padding — Node's `createCipheriv` applies
 *     PKCS#7 padding by default, IDENTICAL to PKCS5 for a 16-byte block size, the same equivalence
 *     `nav-client.ts`'s own header already establishes for NAV's AES step) with the Nonce's OWN
 *     symmetric key (`Ks`, NOT the RSA-encrypted form), then base64'd. VERIFIED, formula quoted
 *     directly.
 *  4. **H.4 Created**: `Base64(AES_Ks,ECB,PKCS5Padding(Timestamp))` — same cipher/key as H.2, over the
 *     current UTC timestamp, ISO 8601 ("e.g.: 2013-01-01T19:20:30.45Z" — `Date#toISOString()`
 *     produces the same shape, just with 3 fractional digits instead of the example's 2, which ISO
 *     8601 permits either way). VERIFIED, formula quoted directly. "Sugere-se a sincronização com o
 *     Observatório Astronómico de Lisboa" (H.4's own reason for existing: "é usada para validação
 *     temporal do pedido") — this client trusts the host clock, same as every other channel in this
 *     directory; no NTP sync of its own is attempted.
 *
 * ## VERIFIED — `RegisterInvoiceResponse` (Aspetos Específicos §2.1.1.2, field table quoted)
 *
 * `CodigoResposta` (Int, REQUIRED): "Se a resposta for zero, a operação foi bem sucedida. Se for um
 * número diferente de zero, significa que a operação não foi bem sucedida." Three code FAMILIES,
 * every value transcribed VERBATIM below (`AT_CODIGO_RESPOSTA_MEANINGS`):
 *  - `0` — success.
 *  - `1`-`99` (positive) — AUTHENTICATION-layer rejections (the SOAP Header itself: bad Username,
 *    Base64, RSA/AES decryption failure, expired credential, wrong password, …) — this client throws
 *    `PtAtApiError` for these (see `registerInvoice` below): the request itself could not even be
 *    authenticated, the same "platform/protocol failure, not a business decision about THIS invoice"
 *    posture `nav-client.ts#NavApiError`/`mydata-client.ts#MyDataApiError` already hold for their own
 *    non-OK responses.
 *  - negative — DOCUMENT-level rejections (e.g. `-7` "Documento inválido por valores anómalos") — a
 *    genuine, permanent verdict about THIS invoice's own data, deliberately NOT thrown here — see
 *    `pt-declaration-provider.ts`'s own header for why these are returned as a normal, journalable
 *    `DeclarationResult` instead (retrying an anomalous-values rejection achieves nothing, the same
 *    "honest, non-terminal-but-real outcome" posture `nav-declaration-provider.ts`'s own header holds
 *    for a non-DONE `invoiceStatus`).
 *
 * `Mensagem` (String, REQUIRED) and `DataOperacao` (DateTime, REQUIRED) are also field-table VERIFIED
 * — their exact XML tag name/casing is EXTRAPOLATED by symmetry with the request's own field-name
 * convention (every request field's XML tag is EXACTLY its parenthesized name, e.g. "(InvoiceNo)" →
 * `<doc:InvoiceNo>`) since neither manual includes a worked RESPONSE example (only the request one,
 * §2.1.1.3) — `parsePtAtRegisterInvoiceResponse` below reads them namespace-AGNOSTIC
 * (`firstByLocalName`, the same defensive stance `nav-client.ts`/`mydata-client.ts` already hold for
 * their own response parsing) specifically so a different namespace/prefix choice on AT's real wire
 * response would not break this client.
 *
 * ## EXTRAPOLATED / not wired
 *
 *  - The exact SOAPAction HTTP header (if any) and whether the binding is document/literal or RPC —
 *    the WSDL that would settle this (`Fatcorews.wsdl`) 404's from this environment (see above); no
 *    SOAPAction header is sent at all, rather than a guessed value.
 *  - **mTLS is a REAL, quoted requirement this client does NOT establish over the wire.** Aspetos
 *    Genéricos §2.1: "A comunicação de dados apenas será estabelecida se o programa de faturação
 *    enviar o Certificado Digital correspondente" — an AT-signed X.509 client certificate (§2.3, CSR
 *    process) is mandatory for the HTTPS connection itself, on top of the WS-Security header. This
 *    client uses the plain global `fetch()` (matching `nav-client.ts`/`mydata-client.ts`'s own
 *    transport, neither of which needs mTLS) rather than `node:https` with a `pfx`/`passphrase`
 *    secure context (the pattern `transports/sdi/sdicoop-client.ts#postSoap` already establishes in
 *    this codebase for a channel that DOES need it) — a real production call would fail the TLS
 *    handshake before ever reaching the WS-Security layer this client builds. Named here,
 *    not silently omitted: wiring the certificate is straightforward (same `pfx`/`passphrase` shape
 *    SdI already uses) once a real AT-issued PKCS#12 exists to test it against — building it blind,
 *    with no certificate to hold it against and no way to structurally test it beyond "does
 *    `https.request` accept these options", would trade a named gap for an UNTESTED one, which this
 *    codebase's own standing discipline treats as strictly worse, not better.
 */
import { createCipheriv, publicEncrypt, randomBytes, constants as cryptoConstants } from 'node:crypto';

import { create } from 'xmlbuilder2';

import { firstByLocalName, parseXml, textOf } from '../../transports/sdi/xml-helpers';

export const PT_AT_TEST_BASE_URL = 'https://servicos.portaldasfinancas.gov.pt:723/fatcorews/ws/';
export const PT_AT_PROD_BASE_URL = 'https://servicos.portaldasfinancas.gov.pt:423/fatcorews/ws/';

const SOAP_ENVELOPE_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const WSSE_NS = 'http://schemas.xmlsoap.org/ws/2002/12/secext';
/** The request/response body namespace, read verbatim off the worked SOAP example's own
 *  `xmlns:doc="..."` declaration (Aspetos Específicos §2.1.1.3). */
export const PT_AT_DOC_NS = 'http://factemi.at.min_financas.pt/documents';

export interface PtAtCredentials {
  /** WS-Security H.1 — `"<NIF do emitente>/<UserId>"`, e.g. "555555555/1234". Sent IN THE CLEAR (see
   *  this file's own header) — never itself encrypted, only the password/timestamp fields are. */
  username: string;
  /** WS-Security H.2's own plaintext input ("SenhaPF") — the subutilizador's real Portal das
   *  Finanças password. AES-encrypted by this client before ever leaving the process; never sent, or
   *  logged, as-is. */
  password: string;
  /** The AT Sistema de Autenticação's own RSA public key (PEM), obtained per-environment by emailing
   *  AT directly (Aspetos Genéricos §2.1.1) — a per-environment CREDENTIAL, never hardcoded (this
   *  task's own brief is explicit on this point). Used to encrypt the Nonce's own AES key. */
  authPublicKeyPem: string;
  /** The AT-signed X.509 client certificate (PKCS#12/.pfx, base64) issued during "adesão ao envio de
   *  dados" (§2.3) — read but, per this file's own header, NOT wired into an actual mTLS connection
   *  yet. Kept on the credential shape now so the eventual wiring is a client-internals change only,
   *  never a channel-config/schema one. */
  clientCertificateBase64?: string;
  clientCertificatePassword?: string;
  /** OPTIONAL override of the fixed per-environment host — same escape hatch
   *  `nav-client.ts#NavCredentials.baseUrl`/`mydata-client.ts#MyDataCredentials.baseUrl` already
   *  offer, for the identical reason (a local stub in jest, never touching the real AT host). */
  baseUrl?: string;
}

/** `AT_CODIGO_RESPOSTA_MEANINGS` — every value transcribed VERBATIM from Aspetos Específicos
 *  §2.1.1.2's own `RegisterInvoiceResponse` field table (the "Código do resultado (CodigoResposta)"
 *  row), the same "meanings copied straight from the spec's own table" discipline
 *  `transports/sdi/sdicoop-client.ts#SDI_ERRORE_MEANINGS` already holds. */
export const AT_CODIGO_RESPOSTA_MEANINGS: Record<string, string> = {
  '0': 'Operação efetuada com sucesso.',
  // Authentication-layer (SOAP Header) rejections — thrown as PtAtApiError, never journaled as a
  // per-invoice business outcome (see this file's own header).
  '1': 'Utilizador não preenchido.',
  '2': 'Tamanho do utilizador incorreto.',
  '3': 'NIF inválido.',
  '4': 'Utilizador com formato inválido.',
  '5': 'Subutilizador com formato inválido.',
  '6': 'Senha não preenchida.',
  '7': 'Codificação Base64 inválida.',
  '8': 'Cifra da chave pública inválida.',
  '9': 'Formato do campo Created inválido.',
  '10': 'Validade da credencial expirada.',
  '11': 'Chave simétrica inválida.',
  '12': 'Chave simétrica repetida.',
  '13': 'Estrutura da senha inválida.',
  '16': 'Chave de sessão inválida. Não foi possível decifrar o campo Created.',
  '17': 'Chave de sessão inválida. Não foi possível decifrar o campo Password.',
  '18': 'Chave de sessão inválida. Não foi possível decifrar o campo Digest.',
  '19': 'Data de criação do pedido não preenchida.',
  '20': 'Chave do pedido não preenchida.',
  '33': 'Pedido SOAP inválido.',
  '99': 'Erro na validação da senha (Senha errada, acesso suspenso, etc.).',
  // Document-level (business) rejections — returned as a REJECTED DeclarationResult, never thrown.
  '-1': 'Documento inválido.',
  '-2': 'Anulação de documento registado.',
  '-3': 'Documento registado com valores diferentes.',
  '-4': 'Data de emissão inválida.',
  '-5': 'Tipo de documento inválido.',
  '-6': 'Estado de documento inválido.',
  '-7': 'Documento inválido por valores anómalos.',
  '-8': 'Código de motivo de isenção inválido.',
  '-9': 'Documento integrado (Rejeição retificada).',
  '-10': 'O documento já foi registado pelo emitente.',
  '-16': 'Utilizador não tem permissões para registar documentos com o NIF de emitente indicado.',
  '-17': 'NIF inválido.',
  '-28': 'Valores de entrada inválidos.',
  '-39': 'Número de certificado inválido.',
  '-50': 'Parâmetros de entrada obrigatórios em falta.',
  '-97': 'Erro interno. Por favor tente mais tarde.',
  '-99': 'Erro de sistema. Por favor volte a tentar mais tarde.',
};

export function describePtAtCodigoResposta(codigoResposta: number): string {
  return AT_CODIGO_RESPOSTA_MEANINGS[String(codigoResposta)] ?? 'código de resposta AT não reconhecido';
}

/** Thrown for a POSITIVE `CodigoResposta` (1-99) — an authentication/protocol-layer rejection of the
 *  SOAP Header itself, never a verdict about the invoice's own data (see this file's own header). */
export class PtAtApiError extends Error {
  constructor(
    public readonly codigoResposta: number,
    public readonly mensagem?: string,
  ) {
    super(
      `AT rejected the request at the authentication layer: CodigoResposta=${codigoResposta}` +
        (mensagem ? ` — ${mensagem}` : '') +
        ` (${describePtAtCodigoResposta(codigoResposta)})`,
    );
    this.name = 'PtAtApiError';
  }
}

export function resolvePtAtBaseUrl(environment: 'TEST' | 'PROD', override?: string): string {
  if (override) return override;
  return environment === 'PROD' ? PT_AT_PROD_BASE_URL : PT_AT_TEST_BASE_URL;
}

// ---------------------------------------------------------------------------
// WS-Security header construction — see this file's own header for the full, field-by-field
// VERIFIED/⚠ UNVERIFIED breakdown. Every function below is pure and independently exported so
// `pt-at-client.spec.ts` can assert on each step in isolation, the same discipline
// `nav-client.ts#computeNavRequestSignature` already established for its own signature algorithm.
// ---------------------------------------------------------------------------

/** H.3's own `Ks` — a fresh, random 128-bit AES key. Exported (rather than only used internally) so a
 *  test can pin it and assert the REST of the header deterministically — see this file's own header,
 *  "a green mocked spec proves structure, not that AT accepts it". */
export function generatePtAtSymmetricKey(): Buffer {
  return randomBytes(16);
}

/** `CRSA,KpubSA(Ks)` then Base64 — H.3 Nonce. ⚠ UNVERIFIED padding, see this file's own header. */
export function encryptPtAtNonce(symmetricKey: Buffer, authPublicKeyPem: string): string {
  const encrypted = publicEncrypt(
    { key: authPublicKeyPem, padding: cryptoConstants.RSA_PKCS1_PADDING },
    symmetricKey,
  );
  return encrypted.toString('base64');
}

/** `C_Ks,ECB,PKCS5Padding(plaintext)` then Base64 — shared by H.2 (Password) and H.4 (Created), the
 *  only difference between them being WHAT plaintext string is encrypted (Aspetos Genéricos §2.2.1).
 *  AES-128-ECB with Node's default (PKCS#7 == PKCS5 for a 16-byte block) padding — VERIFIED, see this
 *  file's own header. */
export function encryptPtAtAesField(symmetricKey: Buffer, plaintextUtf8: string): string {
  const cipher = createCipheriv('aes-128-ecb', symmetricKey, null);
  const encrypted = Buffer.concat([cipher.update(plaintextUtf8, 'utf8'), cipher.final()]);
  return encrypted.toString('base64');
}

export interface PtAtSecurityFields {
  username: string;
  password: string;
  nonce: string;
  created: string;
}

/** Builds the four `wss:UsernameToken` fields — `symmetricKey`/`now` are OPTIONAL, injectable
 *  overrides purely so `pt-at-client.spec.ts` can assert deterministically (see this file's own
 *  header on why the wire-level cryptography itself is otherwise never mocked, only its INPUTS
 *  pinned) — production code never passes them, always taking the real random key/current time. */
export function buildPtAtSecurityFields(
  credentials: PtAtCredentials,
  now: Date = new Date(),
  symmetricKey: Buffer = generatePtAtSymmetricKey(),
): PtAtSecurityFields {
  return {
    username: credentials.username,
    password: encryptPtAtAesField(symmetricKey, credentials.password),
    nonce: encryptPtAtNonce(symmetricKey, credentials.authPublicKeyPem),
    created: encryptPtAtAesField(symmetricKey, now.toISOString()),
  };
}

/**
 * Wraps one `RegisterInvoiceRequest` field object (built by
 * `pt-declaration-provider.ts#buildPtAtInvoiceRequestFields` — this file has no `DeclaredInvoice`
 * knowledge of its own) in the FULL SOAP envelope — Header (WS-Security) + Body — matching Aspetos
 * Específicos §2.1.1.3's own worked example element-for-element (`S:Envelope` → `S:Header`/`S:Body`,
 * `wss:Security` → `wss:UsernameToken`, `doc:RegisterInvoiceRequest`).
 */
export function buildPtAtEnvelope(
  credentials: PtAtCredentials,
  requestFields: Record<string, unknown>,
  now: Date = new Date(),
  symmetricKey: Buffer = generatePtAtSymmetricKey(),
): string {
  const security = buildPtAtSecurityFields(credentials, now, symmetricKey);
  const envelope = {
    'S:Envelope': {
      '@xmlns:S': SOAP_ENVELOPE_NS,
      'S:Header': {
        'wss:Security': {
          '@xmlns:wss': WSSE_NS,
          'wss:UsernameToken': {
            'wss:Username': security.username,
            'wss:Password': security.password,
            'wss:Nonce': security.nonce,
            'wss:Created': security.created,
          },
        },
      },
      'S:Body': {
        'doc:RegisterInvoiceRequest': {
          '@xmlns:doc': PT_AT_DOC_NS,
          ...requestFields,
        },
      },
    },
  };
  return create(envelope).end({ headless: true });
}

// ---------------------------------------------------------------------------
// Response parsing — pure, exported for direct unit testing (same convention as
// `nav-client.ts#parseNavFunctionResult`/`mydata-client.ts#parseMyDataResponse`).
// ---------------------------------------------------------------------------

export interface PtAtRegisterInvoiceResult {
  codigoResposta: number;
  mensagem?: string;
  dataOperacao?: string;
}

/** Reads `CodigoResposta`/`Mensagem`/`DataOperacao` from ANYWHERE in the document
 *  (namespace-agnostic — see this file's own header on why the response's exact tag
 *  namespace/casing is EXTRAPOLATED, not confirmed by a worked example). */
export function parsePtAtRegisterInvoiceResponse(xml: string): PtAtRegisterInvoiceResult {
  const { doc, errors } = parseXml(xml);
  if (errors.length > 0) {
    throw new Error(`AT response could not be parsed as XML: ${errors.join('; ')}`);
  }
  const codigoText = textOf(firstByLocalName(doc, 'CodigoResposta'));
  if (codigoText === undefined) {
    throw new Error(
      'AT RegisterInvoiceResponse carries no CodigoResposta — cannot tell success from failure.',
    );
  }
  const codigoResposta = Number(codigoText);
  if (!Number.isFinite(codigoResposta)) {
    throw new Error(`AT RegisterInvoiceResponse CodigoResposta "${codigoText}" is not a number.`);
  }
  return {
    codigoResposta,
    mensagem: textOf(firstByLocalName(doc, 'Mensagem')),
    dataOperacao: textOf(firstByLocalName(doc, 'DataOperacao')),
  };
}

// ---------------------------------------------------------------------------
// HTTP transport — plain `fetch()`, matching `nav-client.ts`/`mydata-client.ts` (NEITHER of which
// needs mTLS); see this file's own header for why the REAL endpoint's mTLS requirement is
// deliberately NOT wired here yet.
// ---------------------------------------------------------------------------

export interface PtAtClient {
  /** POSTs one `RegisterInvoiceRequest` and returns the parsed result. Throws `PtAtApiError` for a
   *  POSITIVE `CodigoResposta` (an authentication/protocol-layer rejection) — see this file's own
   *  header; `0` (success) and a NEGATIVE `CodigoResposta` (a document-level rejection) both return
   *  normally, left to `pt-declaration-provider.ts` to shape into a `DeclarationResult`. */
  registerInvoice(requestFields: Record<string, unknown>): Promise<PtAtRegisterInvoiceResult>;
}

export function buildPtAtClient(credentials: PtAtCredentials, baseUrl: string): PtAtClient {
  return {
    async registerInvoice(requestFields) {
      const body = buildPtAtEnvelope(credentials, requestFields);
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8' },
        body,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`AT returned HTTP ${res.status} calling ${baseUrl}: ${text.slice(0, 500)}`);
      }
      const result = parsePtAtRegisterInvoiceResponse(text);
      if (result.codigoResposta > 0) {
        throw new PtAtApiError(result.codigoResposta, result.mensagem);
      }
      return result;
    },
  };
}
