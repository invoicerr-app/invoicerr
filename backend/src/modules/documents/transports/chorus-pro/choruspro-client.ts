/**
 * France Chorus Pro B2G transmission client — PISTE gateway.
 *
 * REPRISED, structurally verbatim, from git tag `avant-refonte-documents`
 * (`compliance/providers/transmission/choruspro-client.ts`) — this task's own brief ("le client du
 * repère avait été écrit contre la vraie doc") is honored by keeping every endpoint path, every
 * request/response shape, and every status-mapping table exactly as that file had them. Two
 * deliberate ADAPTATIONS to the CURRENT contract, both documented at their own call site below:
 *
 *  1. `deposerFlux` takes a `Buffer` (`fileBytes`), not a UTF-8 `string` — the repère's own signature
 *     assumed a plain XML string (`Buffer.from(xmlContent, 'utf-8')`), which is safe for pure text but
 *     would CORRUPT this wave's own payload: the B2G FR rule (`b2g-routing/data/fr.json`) names
 *     `formatSyntax: "facturx"`, and Factur-X is a PDF/A-3 BINARY with an embedded XML (see
 *     `formats/facturx-provider.ts`) — round-tripping arbitrary binary bytes through a UTF-8 string
 *     first (`Buffer.from(str, 'utf-8')`) is lossy for any byte sequence that isn't valid UTF-8, which
 *     a PDF's binary body routinely is not. Base64-encoding the Buffer directly (`fileBytes.toString
 *     ('base64')`) is the only correct way to carry it — this is the ONE structural change from the
 *     repère, not a stylistic one.
 *  2. A REAL `FetchChorusProHttpPort` is added at the bottom (the repère's own `choruspro-transmission
 *     .ts` shipped only a `STUB_HTTP` that always threw "not implemented" — this codebase's sibling
 *     clients (`ksef/fetch-http-client.ts`) already ship a real fetch adapter, and
 *     `transports/chorus-pro-transport.ts` needs one to ever actually reach PISTE).
 *
 * Architecture (unchanged from the repère):
 *  - Platform: PISTE (Plateforme d'Intermédiation de Services pour la Transformation de l'État)
 *  - Authority: AIFE / DGFiP — Chorus Pro is the mandatory B2G invoicing portal (see
 *    `b2g-routing/data/fr.json`'s own sourced legal text: Code de la commande publique L.2192-1/-2/-5).
 *  - Scope: invoices FROM suppliers TO public entities (B2G); B2B goes via PDP (a separate channel,
 *    `transports/pdp-transport.ts`).
 *
 * Auth (two-layer, unchanged):
 *  1. PISTE OAuth2 client_credentials → Bearer token for API access.
 *     POST https://[sandbox-]oauth.piste.gouv.fr/api/oauth/token
 *       grant_type=client_credentials&client_id=…&client_secret=…&scope=openid
 *  2. Chorus Pro technical account ("compte technique") → sent in cpro-account header.
 *     cpro-account: base64(login:password)   (always present)
 *
 * API "Factures" v1.0.0 — PISTE base:
 *   Sandbox: https://sandbox-api.piste.gouv.fr
 *   Prod:    https://api.piste.gouv.fr
 *   Base path: /cpro/factures/v1
 *
 * Key operations:
 *  - deposerFlux  : POST /cpro/factures/v1/deposer/flux
 *  - consulterCr  : POST /cpro/factures/v1/consulter/cr
 *
 * VERIFIED LIVE, THIS TASK (2026-09-02), from this checkout's own network: the OAuth endpoint at
 * `https://sandbox-oauth.piste.gouv.fr/api/oauth/token` (the repère's own hostname) resolves and
 * answers a REAL `HTTP 400 {"error":"invalid_client", ...}` for a garbage client_id/secret — a real,
 * deterministic rejection, not a network-level guess. `CREDENTIALS_GUIDE.md` §3 names a DIFFERENT
 * sandbox OAuth hostname (`sandbox-oauth.aife.economie.gouv.fr`), which does NOT resolve from here at
 * all (`curl`: "Could not resolve host") — the repère's own hostname is the one this file keeps, being
 * the one actually reachable and answering the expected OAuth error shape; `CREDENTIALS_GUIDE.md`'s
 * name is flagged, not silently trusted or silently overwritten (a real PISTE account is still needed
 * to know for certain which one a production application should target).
 *
 * NOT independently re-verified: `deposerFlux`/`consulterCr` themselves (both need a real PISTE
 * application + a Chorus Pro compte technique — neither obtained, see `CREDENTIALS_GUIDE.md` §3 and
 * `choruspro-live.spec.ts`'s own header for the honest gap this leaves).
 *
 * References:
 *  - https://piste.gouv.fr — PISTE developer portal (requires account)
 *  - Chorus Pro EDI integration guide (AIFE)
 *  - "API Dépôt flux G2B" v5.2.0 on PISTE (RFA: g2b.apidepotfluxg2b)
 */

// ---------------------------------------------------------------------------
// Seam / Port
// ---------------------------------------------------------------------------

export interface ChorusProHttpPort {
  post(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<{ status: number; data: unknown }>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ChorusProClientConfig {
  /** OAuth token base URL — e.g. https://sandbox-oauth.piste.gouv.fr */
  oauthBaseUrl: string;
  /** API base URL — e.g. https://sandbox-api.piste.gouv.fr */
  apiBaseUrl: string;
  /** PISTE OAuth2 client_id */
  clientId: string;
  /** PISTE OAuth2 client_secret (encrypted at rest) */
  clientSecret: string;
  /** Chorus Pro technical account login */
  technicalAccountLogin: string;
  /** Chorus Pro technical account password (encrypted at rest) */
  technicalAccountPassword: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ChorusProDepositResult {
  /** Flux deposit ID (numeroFluxDepot) — used as ref for polling. */
  numeroFluxDepot: string;
  /** Immediate status returned by Chorus Pro (DEPOSE = accepted for processing). */
  statut: string;
  httpStatus: number;
  raw: unknown;
}

export interface ChorusProCrResult {
  /** Same numeroFluxDepot as at deposit time. */
  numeroFluxDepot: string;
  /** Overall flux status (VALIDE | REJETE | EN_COURS_DE_TRAITEMENT | DEPOSE | SUSPENDU | …). */
  statutFlux: string;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Chorus Pro flux syntax codes (UBL / CII / Factur-X)
// ---------------------------------------------------------------------------
/** Map from a `formats/format-registry.ts` syntax (`DocumentFormatProvider.syntax` — e.g. "FACTURX",
 *  the SAME string `facturx-provider.ts` exports) to the Chorus Pro `syntaxeFlux` code. */
const SYNTAX_MAP: Record<string, string> = {
  EN16931_UBL: 'IN_DP_E1_UBL_201',
  EN16931_CII: 'IN_DP_E2_CII_16B',
  FACTURX: 'IN_DP_E3_FACTUR_X_10',
  // Fallback to UBL 2.1 for generic UBL
  UBL: 'IN_DP_E1_UBL_201',
};

export function resolveChorusProSyntax(artifactSyntax: string): string {
  return SYNTAX_MAP[artifactSyntax] ?? 'IN_DP_E1_UBL_201';
}

// ---------------------------------------------------------------------------
// Exact path table — update here if the swagger shows different paths
// ---------------------------------------------------------------------------
/** @internal — exported for test assertions */
export const CHORUSPRO_PATHS = {
  token: '/api/oauth/token', // on oauthBaseUrl
  deposerFlux: '/cpro/factures/v1/deposer/flux', // on apiBaseUrl
  consulterCr: '/cpro/factures/v1/consulter/cr', // on apiBaseUrl
} as const;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ChorusProClient {
  private _cachedToken?: { token: string; expiresAt: number };

  constructor(
    private readonly config: ChorusProClientConfig,
    private readonly http: ChorusProHttpPort,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Deposit an invoice flux to Chorus Pro.
   *
   * POST /cpro/factures/v1/deposer/flux
   * Headers:
   *   Authorization: Bearer <piste_token>
   *   cpro-account:  base64(<login>:<password>)
   *   Content-Type:  application/json;charset=utf-8
   * Body:
   *   { syntaxeFlux: string, nomFichier: string, fichierFlux: base64(fileBytes) }
   *
   * Returns: { numeroFluxDepot, statut, dateDepot, nbFacturesDepot }
   *
   * `fileBytes` is a `Buffer` — see this file's own header, adaptation §1, for why this is NOT a
   * `string` the way the repère had it: this wave's payload is Factur-X (a PDF/A-3 binary), and
   * base64-encoding the raw bytes directly is the only lossless way to carry it.
   */
  async deposerFlux(
    fileBytes: Buffer,
    fileName: string,
    syntaxeFlux: string = 'IN_DP_E1_UBL_201',
  ): Promise<ChorusProDepositResult> {
    const token = await this._getToken();
    const fichierFlux = fileBytes.toString('base64');
    const body = { syntaxeFlux, nomFichier: fileName, fichierFlux };
    const resp = await this.http.post(
      `${this.config.apiBaseUrl}${CHORUSPRO_PATHS.deposerFlux}`,
      body,
      this._buildHeaders(token),
    );
    if (resp.status >= 400) {
      throw new Error(`Chorus Pro deposerFlux failed (HTTP ${resp.status})`);
    }
    const data = resp.data as Record<string, unknown>;
    const numeroFluxDepot = String(data.numeroFluxDepot ?? data.numero_flux_depot ?? '');
    const statut = String(data.statut ?? 'DEPOSE');
    return { numeroFluxDepot, statut, httpStatus: resp.status, raw: data };
  }

  /**
   * Consult the compte rendu (processing report) for a deposited flux.
   *
   * POST /cpro/factures/v1/consulter/cr
   * Body: { numeroFluxDepot: string }
   *
   * Returns: { numeroFluxDepot, statutFlux, ... }
   * statutFlux values: DEPOSE | EN_COURS_DE_TRAITEMENT | VALIDE | REJETE | SUSPENDU |
   *                    MISE_EN_PAIEMENT | MANDATEE | COMPTABILISEE | ...
   */
  async consulterCr(numeroFluxDepot: string): Promise<ChorusProCrResult> {
    const token = await this._getToken();
    const body = { numeroFluxDepot };
    const resp = await this.http.post(
      `${this.config.apiBaseUrl}${CHORUSPRO_PATHS.consulterCr}`,
      body,
      this._buildHeaders(token),
    );
    if (resp.status >= 400) {
      throw new Error(`Chorus Pro consulterCr failed (HTTP ${resp.status})`);
    }
    const data = resp.data as Record<string, unknown>;
    const statutFlux = String(data.statutFlux ?? data.statut_flux ?? data.statut ?? 'EN_COURS_DE_TRAITEMENT');
    return { numeroFluxDepot, statutFlux, raw: data };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Obtain a PISTE OAuth2 bearer token (client_credentials flow).
   * Token is cached until ~60 s before expiry.
   *
   * POST https://[sandbox-]oauth.piste.gouv.fr/api/oauth/token
   *   grant_type=client_credentials&client_id=…&client_secret=…&scope=openid
   */
  async _getToken(): Promise<string> {
    if (this._cachedToken && Date.now() < this._cachedToken.expiresAt) {
      return this._cachedToken.token;
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'openid',
    });
    const resp = await this.http.post(
      `${this.config.oauthBaseUrl}${CHORUSPRO_PATHS.token}`,
      body.toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    );
    if (resp.status >= 400) {
      throw new Error(`Chorus Pro PISTE authentication failed (HTTP ${resp.status})`);
    }
    const data = resp.data as Record<string, unknown>;
    const token = String(data.access_token ?? '');
    const expiresIn = Number(data.expires_in ?? 3600);
    // Cache with 60 s safety margin; never log the token value.
    this._cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 - 60_000 };
    return token;
  }

  /**
   * Build the standard header set for Chorus Pro API calls.
   *  - Authorization: Bearer <token>        — PISTE gateway auth
   *  - cpro-account: base64(<login>:<pwd>)  — Chorus Pro technical account
   *  - Content-Type: application/json;charset=utf-8
   *
   * SECURITY: cpro-account is logged nowhere. The base64 is not encryption —
   * the value is treated as a credential (stored encrypted at rest, sent only over HTTPS).
   */
  private _buildHeaders(token: string): Record<string, string> {
    const cproAccount = Buffer.from(
      `${this.config.technicalAccountLogin}:${this.config.technicalAccountPassword}`,
      'utf-8',
    ).toString('base64');
    return {
      Authorization: `Bearer ${token}`,
      'cpro-account': cproAccount,
      'Content-Type': 'application/json;charset=utf-8',
    };
  }
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Map a Chorus Pro statutFlux to canonical TransmissionStatus.
 *
 * Terminal clearance: VALIDE, MISE_EN_PAIEMENT, MANDATEE, COMPTABILISEE → CLEARED
 * Terminal rejection: REJETE → REJECTED
 * In-flight: DEPOSE, EN_COURS_DE_TRAITEMENT, SUSPENDU → PENDING
 */
export function mapChorusProStatus(statutFlux: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
  const s = statutFlux.toUpperCase();
  if (s === 'VALIDE' || s === 'MISE_EN_PAIEMENT' || s === 'MANDATEE' || s === 'COMPTABILISEE') {
    return 'CLEARED';
  }
  if (s === 'REJETE') return 'REJECTED';
  // DEPOSE | EN_COURS_DE_TRAITEMENT | SUSPENDU | unknown → PENDING
  return 'PENDING';
}

// ---------------------------------------------------------------------------
// Real HTTP port — adaptation §2 (see this file's own header): the repère only ever shipped a
// STUB that threw; `transports/chorus-pro-transport.ts` needs a working one to reach PISTE at all,
// and `conformity/pollers/chorus-pro-status-poller.ts` needs the same for `consulterCr`. Mirrors
// `transports/ksef/fetch-http-client.ts`'s own shape (fetch + AbortController timeout), simplified:
// unlike KSeF's own port, `ChorusProHttpPort` has exactly one verb (`post`), and Chorus Pro's own
// 4xx responses are NEVER retried here (`ChorusProClient` itself decides pass/fail from `resp.status`)
// — retrying belongs to BullMQ's own job-level backoff (`async-send.ts`), not this transport-level
// HTTP leaf, the same division `pdp-transport.ts`/`sdi-transport.ts` already hold for their own ports.
// ---------------------------------------------------------------------------

export interface FetchChorusProHttpPortOpts {
  /** Request timeout in ms (default: 20_000) — PISTE is a remote gateway, not a local stub; a real
   *  network attempt (or its absence) must not hang a BullMQ job indefinitely. */
  timeoutMs?: number;
}

export class FetchChorusProHttpPort implements ChorusProHttpPort {
  private readonly timeoutMs: number;

  constructor(opts: FetchChorusProHttpPortOpts = {}) {
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  async post(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<{ status: number; data: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // The token call sends an already-encoded `application/x-www-form-urlencoded` STRING
      // (`ChorusProClient._getToken`'s own `body.toString()`); every other call sends a plain object
      // that this port itself must serialize — same "read the Content-Type this caller already set"
      // convention the repère's own live spec used for its ad hoc `realHttp` (`choruspro-live.spec.ts`).
      const isForm = headers['Content-Type']?.includes('x-www-form-urlencoded') ?? false;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: isForm ? String(body) : JSON.stringify(body),
        signal: controller.signal,
      });
      const contentType = res.headers.get('content-type') ?? '';
      let data: unknown;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        // Kept as a Record so `ChorusProClient`'s own `data.numeroFluxDepot ?? ...` reads never throw
        // on a non-JSON error body (an HTML gateway error page, a plain-text 502, etc.).
        data = text ? { message: text } : {};
      }
      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }
}
