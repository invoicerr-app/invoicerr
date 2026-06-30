/**
 * France Chorus Pro B2G transmission client — PISTE gateway, real implementation.
 *
 * Architecture:
 *  - Platform: PISTE (Plateforme d'Intermédiation de Services pour la Transformation de l'État)
 *  - Authority: AIFE / DGFiP — Chorus Pro is the mandatory B2G invoicing portal.
 *  - Scope: invoices FROM suppliers TO public entities (B2G); B2B goes via PDP (separate channel).
 *
 * Auth (two-layer):
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
 * TODO (exact paths to verify once PISTE sandbox creds are available):
 *  The Swagger is at https://piste.gouv.fr (auth-gated). Paths above match the official
 *  Chorus Pro EDI integration guide and known community implementations.
 *  If paths differ, update CHORUSPRO_PATHS below — the rest of the client is untouched.
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
/** Map from artifact.syntax to Chorus Pro syntaxeFlux code. */
const SYNTAX_MAP: Record<string, string> = {
  EN16931_UBL: 'IN_DP_E1_UBL_201',
  EN16931_CII: 'IN_DP_E2_CII_16B',
  FACTURX:     'IN_DP_E3_FACTUR_X_10',
  // Fallback to UBL 2.1 for generic UBL
  UBL:         'IN_DP_E1_UBL_201',
};

export function resolveChorusProSyntax(artifactSyntax: string): string {
  return SYNTAX_MAP[artifactSyntax] ?? 'IN_DP_E1_UBL_201';
}

// ---------------------------------------------------------------------------
// Exact path table — update here if the swagger shows different paths
// ---------------------------------------------------------------------------
/** @internal — exported for test assertions */
export const CHORUSPRO_PATHS = {
  token:        '/api/oauth/token',                // on oauthBaseUrl
  deposerFlux:  '/cpro/factures/v1/deposer/flux',  // on apiBaseUrl
  consulterCr:  '/cpro/factures/v1/consulter/cr',  // on apiBaseUrl
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
   *   { syntaxeFlux: string, nomFichier: string, fichierFlux: base64(xml) }
   *
   * Returns: { numeroFluxDepot, statut, dateDepot, nbFacturesDepot }
   */
  async deposerFlux(
    xmlContent: string,
    fileName: string,
    syntaxeFlux: string = 'IN_DP_E1_UBL_201',
  ): Promise<ChorusProDepositResult> {
    const token = await this._getToken();
    const fichierFlux = Buffer.from(xmlContent, 'utf-8').toString('base64');
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
    const numeroFluxDepot = String(data['numeroFluxDepot'] ?? data['numero_flux_depot'] ?? '');
    const statut = String(data['statut'] ?? 'DEPOSE');
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
    const statutFlux = String(
      data['statutFlux'] ?? data['statut_flux'] ?? data['statut'] ?? 'EN_COURS_DE_TRAITEMENT',
    );
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
    const token = String(data['access_token'] ?? '');
    const expiresIn = Number(data['expires_in'] ?? 3600);
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
export function mapChorusProStatus(
  statutFlux: string,
): 'CLEARED' | 'REJECTED' | 'PENDING' {
  const s = statutFlux.toUpperCase();
  if (
    s === 'VALIDE' ||
    s === 'MISE_EN_PAIEMENT' ||
    s === 'MANDATEE' ||
    s === 'COMPTABILISEE'
  ) {
    return 'CLEARED';
  }
  if (s === 'REJETE') return 'REJECTED';
  // DEPOSE | EN_COURS_DE_TRAITEMENT | SUSPENDU | unknown → PENDING
  return 'PENDING';
}
