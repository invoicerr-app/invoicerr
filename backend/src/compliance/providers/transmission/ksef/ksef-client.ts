/**
 * KSeF 2.0 client — typed methods for the Polish Krajowy System e-Faktur API.
 *
 * Base URLs (from CIRFMF/ksef-api v2.6.1 OpenAPI spec):
 *   TEST: https://api-test.ksef.mf.gov.pl/v2
 *   PROD: https://api.ksef.mf.gov.pl/v2
 *
 * Authentication flow:
 *   1. POST /auth/challenge  → challenge + timestamp
 *   2. POST /auth/ksef-token → authenticationToken + referenceNumber
 *   3. GET  /auth/{ref}      → poll until status.code === 200
 *   4. POST /auth/token/redeem → accessToken + refreshToken (one-time!)
 *
 * Online session flow:
 *   5. POST /sessions/online → session referenceNumber
 *   6. POST /sessions/online/{ref}/invoices → invoice referenceNumber
 *   7. POST /sessions/online/{ref}/close → triggers UPO generation
 *
 * Status flow:
 *   8. GET /sessions/{sRef}/invoices/{iRef} → invoice status + ksefNumber
 */
import { encryptKsefToken, generateSessionKey, encryptSymmetricKey, encryptXmlContent, sha256base64, SessionKey } from './ksef-crypto';

// ---------------------------------------------------------------------------
// Types (aligned to live OpenAPI spec at api-test.ksef.mf.gov.pl/v2)
// ---------------------------------------------------------------------------

export type KsefEnvironment = 'test' | 'prod';

const BASE_URLS: Record<KsefEnvironment, string> = {
  test: 'https://api-test.ksef.mf.gov.pl/v2',
  prod: 'https://api.ksef.mf.gov.pl/v2',
};

export interface AuthChallengeResponse {
  challenge: string;
  timestamp: string;
  timestampMs: number;
  clientIp: string;
}

export interface AuthKsefTokenResponse {
  referenceNumber: string;
  authenticationToken: { token: string; validUntil: string };
}

export interface AuthStatusResponse {
  startDate: string;
  authenticationMethod: string;
  status: { code: number; description: string; details?: string[] | null };
  isTokenRedeemed?: boolean | null;
  refreshTokenValidUntil?: string | null;
}

export interface AuthRedeemResponse {
  accessToken: { token: string; validUntil: string };
  refreshToken: { token: string; validUntil: string };
}

export interface OpenSessionResponse {
  referenceNumber: string;
  validUntil: string;
}

export interface SendInvoiceResponse {
  referenceNumber: string;
}

export interface InvoiceStatusResponse {
  ordinalNumber: number;
  invoiceNumber?: string | null;
  ksefNumber?: string | null;
  referenceNumber: string;
  invoiceHash: string;
  invoicingDate: string;
  status: { code: number; description: string; details?: string[] | null };
  upoDownloadUrl?: string | null;
}

export interface PublicKeyCertificate {
  certificate: string; // Base64 DER
  certificateId: string;
  publicKeyId: string;
  validFrom: string;
  validTo: string;
  usage: ('KsefTokenEncryption' | 'SymmetricKeyEncryption')[];
}

export interface KsefError {
  status: number;
  body: unknown;
}

// ---------------------------------------------------------------------------
// HTTP port — injectable for testing
// ---------------------------------------------------------------------------

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

/** Minimal HTTP client port. Implementations: fetch-based, test mock, etc. */
export interface KsefHttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface KsefClientConfig {
  environment: KsefEnvironment;
  /** NIP (tax identification number), digits only, no PL prefix. */
  nip: string;
  /** Long-lived KSeF token (stored encrypted in CompanyChannelConfig). */
  ksefToken: string;
  /** PEM-encoded public key for KSeF token encryption (KsefTokenEncryption usage). */
  tokenEncryptionKeyPem: string;
  /** PEM-encoded public key for symmetric key encryption (SymmetricKeyEncryption usage). */
  symmetricKeyPem: string;
}

export class KsefClient {
  private readonly baseUrl: string;
  private readonly nip: string;
  private readonly ksefToken: string;
  private readonly tokenKeyPem: string;
  private readonly symKeyPem: string;
  private readonly http: KsefHttpClient;

  constructor(http: KsefHttpClient, config: KsefClientConfig) {
    this.baseUrl = BASE_URLS[config.environment];
    this.nip = config.nip;
    this.ksefToken = config.ksefToken;
    this.tokenKeyPem = config.tokenEncryptionKeyPem;
    this.symKeyPem = config.symmetricKeyPem;
    this.http = http;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    const res = await this.http.request({ method: 'POST', path: this.baseUrl + path, body, headers });
    if (res.status >= 400) throw ksefError(res);
    return res.body as T;
  }

  private async get<T>(path: string, bearerToken: string): Promise<T> {
    const res = await this.http.request({
      method: 'GET',
      path: this.baseUrl + path,
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (res.status >= 400) throw ksefError(res);
    return res.body as T;
  }

  // ── auth flow ──────────────────────────────────────────────────────────────

  /** Step 1: Get a challenge (no auth required). */
  async authChallenge(): Promise<AuthChallengeResponse> {
    return this.post<AuthChallengeResponse>('/auth/challenge');
  }

  /**
   * Step 2: Authenticate with KSeF token.
   * The token is encrypted: RSA-OAEP-SHA256("{token}|{timestampMs}", KsefTokenEncryptionKey).
   */
  async authKsefToken(challenge: string, timestampMs: number): Promise<AuthKsefTokenResponse> {
    const encryptedToken = encryptKsefToken(this.ksefToken, timestampMs, this.tokenKeyPem);
    return this.post<AuthKsefTokenResponse>('/auth/ksef-token', {
      challenge,
      contextIdentifier: { type: 'Nip', value: this.nip },
      encryptedToken,
    });
  }

  /** Step 3: Poll auth status. Status code 200 = success. */
  async authStatus(ref: string, authenticationToken: string): Promise<AuthStatusResponse> {
    return this.get<AuthStatusResponse>(`/auth/${ref}`, authenticationToken);
  }

  /** Step 4: Redeem tokens (one-time!). Returns access + refresh tokens. */
  async authRedeem(authenticationToken: string): Promise<AuthRedeemResponse> {
    return this.post<AuthRedeemResponse>(
      '/auth/token/redeem',
      undefined,
      { Authorization: `Bearer ${authenticationToken}` },
    );
  }

  // ── online session ─────────────────────────────────────────────────────────

  /** Open an online session for FA(2) invoice submission. */
  async openOnlineSession(accessToken: string): Promise<OpenSessionResponse> {
    const key = generateSessionKey();
    const encryptedSymmetricKey = encryptSymmetricKey(key.aesKey, this.symKeyPem);

    const session = await this.post<OpenSessionResponse>(
      '/sessions/online',
      {
        formCode: { systemCode: 'FA', schemaVersion: '1-0E', value: 'FA' },
        encryption: {
          encryptedSymmetricKey,
          initializationVector: key.iv.toString('base64'),
        },
      },
      { Authorization: `Bearer ${accessToken}` },
    );

    return session;
  }

  /**
   * Send an invoice within an online session.
   * Returns the invoice reference number.
   */
  async sendInvoice(
    sessionRef: string,
    accessToken: string,
    xmlContent: string,
    sessionKey: SessionKey,
  ): Promise<SendInvoiceResponse> {
    const encryptedContent = encryptXmlContent(xmlContent, sessionKey.aesKey, sessionKey.iv);
    const invoiceHash = sha256base64(xmlContent);
    const encryptedHash = sha256base64(Buffer.from(encryptedContent, 'base64'));

    return this.post<SendInvoiceResponse>(
      `/sessions/online/${sessionRef}/invoices`,
      {
        invoiceHash,
        invoiceSize: Buffer.byteLength(xmlContent, 'utf8'),
        encryptedInvoiceHash: encryptedHash,
        encryptedInvoiceSize: Buffer.byteLength(encryptedContent, 'base64'),
        encryptedInvoiceContent: encryptedContent,
      },
      { Authorization: `Bearer ${accessToken}` },
    );
  }

  /** Close an online session. Triggers UPO generation. */
  async closeSession(sessionRef: string, accessToken: string): Promise<void> {
    const res = await this.http.request({
      method: 'POST',
      path: this.baseUrl + `/sessions/online/${sessionRef}/close`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status >= 400) throw ksefError(res);
  }

  // ── status / UPO ───────────────────────────────────────────────────────────

  /** Get invoice status within a session. */
  async invoiceStatus(sessionRef: string, invoiceRef: string, accessToken: string): Promise<InvoiceStatusResponse> {
    return this.get<InvoiceStatusResponse>(
      `/sessions/${sessionRef}/invoices/${invoiceRef}`,
      accessToken,
    );
  }

  /** Get session status (including UPO pages when available). */
  async sessionStatus(sessionRef: string, accessToken: string): Promise<unknown> {
    return this.get<unknown>(`/sessions/${sessionRef}`, accessToken);
  }

  // ── public keys ────────────────────────────────────────────────────────────

  /** Fetch MF public key certificates (no auth required). */
  async publicKeyCertificates(): Promise<PublicKeyCertificate[]> {
    const res = await this.http.request({ method: 'GET', path: this.baseUrl + '/security/public-key-certificates' });
    if (res.status >= 400) throw ksefError(res);
    return res.body as PublicKeyCertificate[];
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function ksefError(res: HttpResponse): KsefError {
  return Object.assign(new Error(`KSeF API error ${res.status}`), {
    status: res.status,
    body: res.body,
  }) as KsefError;
}
